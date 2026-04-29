import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Remet tous les éléments en cours de traitement (RUNNING) à PENDING
    const result = await prisma.ocrUpload.updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'PENDING',
        startedAt: null,
        error: 'Processing cancelled by user',
      },
    });

    console.log(`Cancelled ${result.count} items in processing`);

    return NextResponse.json({
      success: true,
      count: result.count,
      message: `${result.count} item(s) cancelled and reset to pending`,
    });
  } catch (error) {
    console.error('Error cancelling processing:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel processing' },
      { status: 500 }
    );
  }
}
