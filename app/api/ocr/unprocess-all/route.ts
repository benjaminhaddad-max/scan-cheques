import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Remet TOUS les fichiers traités (COMPLETED ou FAILED) en attente de retraitement
    const result = await prisma.ocrUpload.updateMany({
      where: {
        status: {
          in: ['COMPLETED', 'FAILED'],
        },
      },
      data: {
        status: 'PENDING',
        rawText: null,
        parsedJson: {},
        error: null,
        startedAt: null,
        completedAt: null,
        attempts: 0,
        // Réinitialise confidence si le champ existe
        ...((await checkConfidenceFieldExists()) ? { confidence: null } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      unprocessedCount: result.count,
      message:
        result.count > 0
          ? `${result.count} fichier(s) remis en attente de traitement`
          : 'Aucun fichier traité à remettre en attente',
    });
  } catch (error: any) {
    console.error('Error unprocessing files:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to unprocess files',
      },
      { status: 500 }
    );
  }
}

// Détecte si le champ `confidence` existe (rétro-compat avec un schéma sans la migration)
async function checkConfidenceFieldExists(): Promise<boolean> {
  try {
    await prisma.ocrUpload.findFirst({
      select: { confidence: true },
    });
    return true;
  } catch (error: any) {
    if (error.code === 'P2022' && error.message.includes('confidence')) {
      return false;
    }
    throw error;
  }
}
