import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const CONCURRENCY = 5000; // nombre max d'items à récupérer en une requête
const MAX_ITEMS_PER_REQUEST = 100; // limite par appel pour éviter les timeouts

// Retry exponentiel sur les erreurs de rate-limit OCR
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 20,
  initialDelay = 500
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (error.message && (error.message.includes('Rate limit') || error.message.includes('429'))) {
        let waitTime = initialDelay;
        const match = error.message.match(/try again in (\d+)ms/i);
        if (match) {
          waitTime = parseInt(match[1]) + 100;
        }

        console.log(`Rate limit hit in OCR call. Retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function processOne(uploadId: string, baseUrl: string, emetteurContext: string[] = []) {
  // Wrapper qui ne lève jamais d'exception : on remet l'item en PENDING en cas de crash inattendu
  try {
    return await processOneInternal(uploadId, baseUrl, emetteurContext);
  } catch (error: any) {
    console.error(`Fatal error processing ${uploadId}:`, error);
    try {
      await prisma.ocrUpload.update({
        where: { id: uploadId },
        data: { status: 'PENDING', error: String(error?.message || 'Fatal processing error'), startedAt: null },
      });
    } catch (finalError) {
      console.error(`Could not update error status for ${uploadId}:`, finalError);
    }
  }
}

async function processOneInternal(uploadId: string, baseUrl: string, emetteurContext: string[] = []) {
  let upload: any;
  try {
    upload = await prisma.ocrUpload.update({
      where: { id: uploadId },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });
  } catch (dbError: any) {
    if (dbError.code === 'P2022' && dbError.message.includes('confidence')) {
      console.warn('Confidence column not found in processOne, using raw SQL fallback.');
      await prisma.$queryRawUnsafe(
        'UPDATE "ocr_uploads" SET "status" = $1, "startedAt" = $2, "attempts" = "attempts" + 1 WHERE "id" = $3',
        'RUNNING',
        new Date(),
        uploadId
      );
      const result = await prisma.$queryRawUnsafe('SELECT * FROM "ocr_uploads" WHERE "id" = $1', uploadId);
      upload = Array.isArray(result) ? result[0] : result;
    } else {
      throw dbError;
    }
  }

  try {
    // Re-télécharge le blob et l'envoie à l'endpoint OCR-GPT interne
    const res = await fetch(upload.blobUrl);
    const arrayBuffer = await res.arrayBuffer();
    const file = new File([arrayBuffer], upload.fileName, {
      type: res.headers.get('content-type') || 'image/jpeg',
    });

    const form = new FormData();
    form.append('image', file);

    if (emetteurContext && emetteurContext.length > 0) {
      form.append('emetteurContext', JSON.stringify(emetteurContext));
    }

    const data = await retryWithBackoff(async () => {
      const ocrRes = await fetch(`${baseUrl}/api/ocr-gpt`, {
        method: 'POST',
        body: form,
      });
      if (!ocrRes.ok) {
        const err = await ocrRes.json().catch(() => ({}));
        throw new Error(err.error || 'OCR failed');
      }
      return await ocrRes.json();
    });

    const updateData: any = {
      status: 'COMPLETED',
      completedAt: new Date(),
      model: String(data.model || 'gpt-5'),
      rawText: String(data?.data?.rawText || ''),
      parsedJson: data?.data || {},
      error: null,
    };

    if (data?.data?.confidence) {
      updateData.confidence = parseInt(data.data.confidence);
    }

    try {
      await prisma.ocrUpload.update({
        where: { id: uploadId },
        data: updateData,
      });
    } catch (dbError: any) {
      if (dbError.code === 'P2022' && dbError.message.includes('confidence')) {
        console.warn('Confidence column not found in process-pending, using raw SQL fallback. Please run database migration.');

        const { confidence, ...fieldsToUpdate } = updateData;
        const setParts: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(fieldsToUpdate)) {
          if (value !== undefined) {
            setParts.push(`"${key}" = $${paramIndex++}`);
            values.push(value);
          }
        }

        if (setParts.length > 0) {
          const query = `UPDATE "ocr_uploads" SET ${setParts.join(', ')} WHERE "id" = $${paramIndex}`;
          values.push(uploadId);
          await prisma.$queryRawUnsafe(query, ...values);
        }
      } else {
        throw dbError;
      }
    }
  } catch (error: any) {
    // En cas d'erreur, on remet en PENDING pour que l'item soit retraitable
    try {
      await prisma.ocrUpload.update({
        where: { id: uploadId },
        data: { status: 'PENDING', error: String(error?.message || 'Failed'), startedAt: null },
      });
    } catch (dbError: any) {
      if (dbError.code === 'P2022' && dbError.message.includes('confidence')) {
        console.warn('Confidence column not found in error handling, using raw SQL fallback.');
        await prisma.$queryRawUnsafe(
          'UPDATE "ocr_uploads" SET "status" = $1, "error" = $2, "startedAt" = $3 WHERE "id" = $4',
          'PENDING',
          String(error?.message || 'Failed'),
          null,
          uploadId
        );
      } else {
        console.error('Failed to update error status:', dbError);
      }
    }
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.success) {
    return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const limit = Math.min(Number(url.searchParams.get('limit') || CONCURRENCY), CONCURRENCY);
  const itemId = url.searchParams.get('itemId');
  const itemIds = url.searchParams.get('itemIds');

  // Lecture optionnelle du contexte émetteur depuis le body
  let emetteurContext: string[] = [];
  try {
    const body = await request.json().catch(() => ({}));
    emetteurContext = Array.isArray(body.emetteurContext) ? body.emetteurContext : [];
  } catch (error) {
    emetteurContext = [];
  }

  let pendings: any[] = [];

  try {
    if (itemId) {
      const item = await prisma.ocrUpload.findUnique({
        where: { id: itemId, status: 'PENDING' },
      });
      if (item) pendings = [item];
    } else if (itemIds) {
      const ids = itemIds.split(',');
      pendings = await prisma.ocrUpload.findMany({
        where: { id: { in: ids }, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      });
    } else {
      pendings = await prisma.ocrUpload.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    }
  } catch (dbError: any) {
    if (dbError.code === 'P2022' && dbError.message.includes('confidence')) {
      console.warn('Confidence column not found in process-pending queries, using raw SQL fallback.');

      if (itemId) {
        const result = await prisma.$queryRawUnsafe(
          'SELECT * FROM "ocr_uploads" WHERE "id" = $1 AND "status" = $2',
          itemId,
          'PENDING'
        );
        pendings = Array.isArray(result) ? result : [];
      } else if (itemIds) {
        const ids = itemIds.split(',');
        const placeholders = ids.map((_, index) => `$${index + 2}`).join(',');
        const result = await prisma.$queryRawUnsafe(
          `SELECT * FROM "ocr_uploads" WHERE "id" IN (${placeholders}) AND "status" = $1 ORDER BY "createdAt" ASC`,
          'PENDING',
          ...ids
        );
        pendings = Array.isArray(result) ? result : [];
      } else {
        const result = await prisma.$queryRawUnsafe(
          'SELECT * FROM "ocr_uploads" WHERE "status" = $1 ORDER BY "createdAt" ASC LIMIT $2',
          'PENDING',
          limit
        );
        pendings = Array.isArray(result) ? result : [];
      }
    } else {
      throw dbError;
    }
  }

  if (pendings.length === 0) return NextResponse.json({ success: true, processed: 0 });

  const itemsToProcess = pendings.slice(0, MAX_ITEMS_PER_REQUEST);
  const remainingCount = pendings.length - itemsToProcess.length;

  // Traitement par batch parallèle pour gérer les rate-limits OpenAI
  const BATCH_SIZE = 50;
  const results: PromiseSettledResult<any>[] = [];

  console.log(
    `Processing ${itemsToProcess.length} items in batches of ${BATCH_SIZE}${
      remainingCount > 0 ? ` (${remainingCount} remaining for next request)` : ''
    }...`
  );

  for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
    const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
    console.log(
      `Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(itemsToProcess.length / BATCH_SIZE)}: Processing ${batch.length} items`
    );

    const batchResults = await Promise.allSettled(
      batch.map((p) => processOne(p.id, baseUrl, emetteurContext))
    );

    results.push(...batchResults);
  }

  const successful = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(`All batches complete: ${successful} successful, ${failed} failed out of ${itemsToProcess.length} total`);

  return NextResponse.json({
    success: true,
    processed: itemsToProcess.length,
    successful,
    failed,
    remaining: remainingCount,
    hasMore: remainingCount > 0,
  });
}
