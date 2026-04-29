import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import sharp from 'sharp';
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

    let processedFile: Buffer | File = file;
    let finalFilename = file.name;
    let contentType = file.type;

    // Conversion TIFF → JPEG (les TIFF s'affichent mal en HTML)
    const filenameLower = file.name.toLowerCase();
    if (filenameLower.endsWith('.tiff') || filenameLower.endsWith('.tif')) {
      console.log(`Converting TIFF to JPEG: ${file.name}`);
      const arrayBuffer = await file.arrayBuffer();
      processedFile = await sharp(Buffer.from(arrayBuffer))
        .jpeg({ quality: 85 })
        .toBuffer();

      finalFilename = file.name.replace(/\.(tiff?|TIF{1,2})$/i, '.jpg');
      contentType = 'image/jpeg';
    }

    const blobFilename = `ocr-uploads/${Date.now()}-${Math.random().toString(36).substring(2)}-${finalFilename}`;

    const blob = await put(blobFilename, processedFile, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      contentType: contentType,
    });

    return NextResponse.json({ url: blob.url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to upload file' }, { status: 500 });
  }
}
