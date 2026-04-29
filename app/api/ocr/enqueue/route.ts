import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

// Enregistre des Blob URLs déjà uploadées en file d'attente OCR
// Body: { files: [{ url: string, fileName: string, sizeBytes: number, folderId?, folderName?, folderOrder? }] }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const files = Array.isArray(body?.files) ? body.files : [];
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files' }, { status: 400 });
    }

    const created = await prisma.$transaction(
      files.map((f: any) =>
        prisma.ocrUpload.create({
          data: {
            blobUrl: String(f.url),
            fileName: String(f.fileName || 'upload'),
            sizeBytes: Number(f.sizeBytes || 0),
            folderId: f.folderId ? String(f.folderId) : null,
            folderName: f.folderName ? String(f.folderName) : null,
            folderOrder: f.folderOrder ? Number(f.folderOrder) : null,
          },
        })
      )
    );

    return NextResponse.json({ success: true, ids: created.map((r) => r.id) });
  } catch (error: any) {
    console.error('Enqueue error:', error);
    return NextResponse.json({ error: error.message || 'Failed to enqueue' }, { status: 500 });
  }
}
