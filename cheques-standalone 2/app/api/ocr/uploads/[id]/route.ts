import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // On ne met à jour que les champs explicitement fournis dans la requête
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (body.parsedJson !== undefined) updateData.parsedJson = body.parsedJson;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.error !== undefined) updateData.error = body.error;
    if (body.rawText !== undefined) updateData.rawText = body.rawText;
    if (body.startedAt !== undefined) updateData.startedAt = body.startedAt;
    if (body.completedAt !== undefined) updateData.completedAt = body.completedAt;
    if (body.confidence !== undefined) updateData.confidence = body.confidence;

    let updated;
    try {
      updated = await prisma.ocrUpload.update({
        where: { id },
        data: updateData,
      });
    } catch (dbError: any) {
      // Fallback raw SQL si la colonne `confidence` n'existe pas dans la BD
      if (dbError.code === 'P2022' && dbError.message.includes('confidence')) {
        console.warn('Confidence column not found, using raw SQL fallback. Please run database migration.');

        const { confidence, updatedAt, ...fieldsToUpdate } = updateData;
        const setParts: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        setParts.push(`"updatedAt" = $${paramIndex++}`);
        values.push(new Date());

        for (const [key, value] of Object.entries(fieldsToUpdate)) {
          if (value !== undefined) {
            setParts.push(`"${key}" = $${paramIndex++}`);
            values.push(value);
          }
        }

        if (setParts.length > 0) {
          const query = `UPDATE "ocr_uploads" SET ${setParts.join(', ')} WHERE "id" = $${paramIndex} RETURNING *`;
          values.push(id);

          const result = await prisma.$queryRawUnsafe(query, ...values);
          updated = Array.isArray(result) ? result[0] : result;
        } else {
          const fallback = await prisma.$queryRawUnsafe('SELECT * FROM "ocr_uploads" WHERE "id" = $1', id);
          updated = Array.isArray(fallback) ? fallback[0] : fallback;
        }
      } else {
        throw dbError;
      }
    }

    return NextResponse.json({ success: true, item: updated });
  } catch (error: any) {
    console.error('PATCH /api/ocr/uploads/[id] error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    try {
      await prisma.ocrUpload.delete({
        where: { id },
      });
    } catch (dbError: any) {
      if (dbError.code === 'P2022' && dbError.message.includes('confidence')) {
        console.warn('Confidence column not found, using raw SQL fallback for delete. Please run database migration.');
        await prisma.$queryRawUnsafe('DELETE FROM "ocr_uploads" WHERE "id" = $1', id);
      } else {
        throw dbError;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/ocr/uploads/[id] error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete' }, { status: 500 });
  }
}
