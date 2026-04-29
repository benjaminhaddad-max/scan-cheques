import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const filename = `ocr-uploads/${Date.now()}-${Math.random().toString(36).substring(2)}-${file.name}`;

    const blob = await put(filename, file, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN!,
    });

    return NextResponse.json({ url: blob.url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to upload file' }, { status: 500 });
  }
}
