import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor') || undefined;
    const limit = Math.min(Number(url.searchParams.get('limit') || 1000), 2000);

    // Récupération avec tous les champs (y compris confidence)
    let items;
    try {
      items = await prisma.ocrUpload.findMany({
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { fileName: 'asc' },
      });
    } catch (dbError: any) {
      // Fallback : si la colonne `confidence` n'existe pas (ancien schéma sans migration),
      // on récupère sans cette colonne et on l'ajoute à null pour la rétro-compatibilité.
      if (dbError.code === 'P2022' && dbError.message.includes('confidence')) {
        console.warn('Confidence column not found, fetching without it. Please run database migration.');
        items = await prisma.ocrUpload.findMany({
          take: limit,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { fileName: 'asc' },
          select: {
            id: true,
            blobUrl: true,
            fileName: true,
            sizeBytes: true,
            status: true,
            model: true,
            attempts: true,
            error: true,
            rawText: true,
            parsedJson: true,
            createdAt: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
          },
        });
        items = items.map((item) => ({ ...item, confidence: null }));
      } else {
        throw dbError;
      }
    }

    const nextCursor = items.length === limit ? items[items.length - 1].id : null;

    return NextResponse.json({ items, nextCursor });
  } catch (error: any) {
    console.error('Error fetching OCR uploads:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch uploads', items: [] }, { status: 500 });
  }
}
