import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import JSZip from 'jszip';
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

    // Vérifie qu'il s'agit bien d'une archive ZIP
    if (!file.type.includes('zip') && !file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: 'File must be a ZIP archive' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const zip = new JSZip();

    let zipContent;
    try {
      zipContent = await zip.loadAsync(arrayBuffer);
    } catch (error) {
      return NextResponse.json({ error: 'Invalid ZIP file' }, { status: 400 });
    }

    const uploadResults: Array<{ filename: string; url: string; size: number }> = [];
    const errors: string[] = [];

    // Extensions d'image acceptées
    const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.tiff', '.tif'];

    for (const filename in zipContent.files) {
      const zipEntry = zipContent.files[filename];

      if (zipEntry.dir) continue;

      const filenameLower = filename.toLowerCase();
      const isSupported = supportedExtensions.some((ext) => filenameLower.endsWith(ext));

      if (!isSupported) {
        continue;
      }

      try {
        const fileData = await zipEntry.async('arraybuffer');

        let processedData: ArrayBuffer | Buffer = fileData;
        let finalFilename = filename;
        let mimeType = 'image/jpeg';

        // Conversion TIFF → JPEG (les TIFF sont rarement bien rendus en HTML)
        if (filenameLower.endsWith('.tiff') || filenameLower.endsWith('.tif')) {
          console.log(`Converting TIFF to JPEG: ${filename}`);
          processedData = await sharp(Buffer.from(fileData))
            .jpeg({ quality: 85 })
            .toBuffer();

          finalFilename = filename.replace(/\.(tiff?|TIF{1,2})$/i, '.jpg');
          mimeType = 'image/jpeg';
        } else {
          if (filenameLower.endsWith('.png')) mimeType = 'image/png';
          else if (filenameLower.endsWith('.gif')) mimeType = 'image/gif';
        }

        // Nom unique pour éviter les collisions sur le blob storage
        const blobFilename = `ocr-uploads/${Date.now()}-${Math.random().toString(36).substring(2)}-${finalFilename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

        const blob = await put(blobFilename, processedData, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN!,
          contentType: mimeType,
        });

        uploadResults.push({
          filename: finalFilename,
          url: blob.url,
          size: processedData instanceof Buffer ? processedData.length : processedData.byteLength,
        });
      } catch (error) {
        console.error(`Error processing ${filename}:`, error);
        errors.push(`Failed to process ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (uploadResults.length === 0) {
      return NextResponse.json(
        {
          error: 'No supported image files found in ZIP archive',
          details: 'ZIP must contain JPG, PNG, GIF, or TIFF files',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      files: uploadResults,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        total: uploadResults.length,
        errors: errors.length,
      },
    });
  } catch (error: any) {
    console.error('ZIP upload error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process ZIP file',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
