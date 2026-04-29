import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { del } from '@vercel/blob';
import { requireAuth } from '@/lib/auth';

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Récupère tous les uploads traités (ou en échec) pour les supprimer
    const processedUploads = await prisma.ocrUpload.findMany({
      where: {
        status: {
          in: ['COMPLETED', 'FAILED'],
        },
      },
      select: {
        id: true,
        blobUrl: true,
        fileName: true,
      },
    });

    if (processedUploads.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No processed files to delete',
        deletedCount: 0,
      });
    }

    // Supprime les blobs de Vercel Blob
    const blobDeletions = processedUploads.map(async (upload) => {
      try {
        if (upload.blobUrl) {
          await del(upload.blobUrl);
        }
      } catch (error) {
        console.warn(`Failed to delete blob for ${upload.fileName}:`, error);
        // On continue la suppression DB même si le blob a échoué
      }
    });

    await Promise.allSettled(blobDeletions);

    // Supprime les enregistrements en BD
    const result = await prisma.ocrUpload.deleteMany({
      where: {
        status: {
          in: ['COMPLETED', 'FAILED'],
        },
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
      message: `${result.count} processed files deleted successfully`,
    });
  } catch (error: any) {
    console.error('Error deleting processed files:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to delete processed files',
      },
      { status: 500 }
    );
  }
}
