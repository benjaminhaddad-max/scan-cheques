import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return auth.errorResponse ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Récupère tous les uploads dont le traitement OCR est terminé
    const uploads = await prisma.ocrUpload.findMany({
      where: {
        status: 'COMPLETED',
      },
      orderBy: {
        fileName: 'asc',
      },
    });

    if (uploads.length === 0) {
      return new NextResponse('Aucune donnée traitée disponible', { status: 404 });
    }

    // En-têtes du CSV
    const headers = [
      'Fichier',
      'Date de traitement',
      'Numéro de chèque',
      'Numéro de chèque (code)',
      'Montant',
      'Date',
      'Lieu',
      'Banque',
      'Numéro de compte',
      'Émetteur',
      'Bénéficiaire',
      'Mémo',
      'Daté',
      'Signé',
      'Confiance (%)',
      'Texte brut',
    ];

    // Échappement CSV
    const escapeCSV = (value: any) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Préserve les zéros initiaux pour les nombres dans Excel/Sheets
    const preserveLeadingZeros = (value: any) => {
      if (value === null || value === undefined) return '';
      const str = String(value).trim();
      if (str.length > 0 && str.startsWith('0') && /^\d+$/.test(str)) {
        return `'${str}`;
      }
      return str;
    };

    // Totaux
    const totalCount = uploads.length;
    const totalAmount = uploads.reduce((sum, upload) => {
      const data = (upload.parsedJson as any) || {};
      const amount = parseFloat(data.amount?.toString().replace(',', '.') || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);

    // Génération du contenu CSV
    const csvRows = [
      headers.join(','),
      ...uploads.map((upload) => {
        const data = (upload.parsedJson as any) || {};

        return [
          escapeCSV(upload.fileName),
          escapeCSV(upload.completedAt?.toISOString().split('T')[0] || ''),
          escapeCSV(preserveLeadingZeros(data.checkNumber || '')),
          escapeCSV(preserveLeadingZeros(data.checkNumberMICR || '')),
          escapeCSV(data.amount || ''),
          escapeCSV(data.date || ''),
          escapeCSV(data.location || ''),
          escapeCSV(data.bank || ''),
          escapeCSV(preserveLeadingZeros(data.accountNumber || '')),
          escapeCSV(data.emetteur || ''),
          escapeCSV(data.payTo || ''),
          escapeCSV(data.memo || ''),
          escapeCSV(data.isDated ? 'Oui' : 'Non'),
          escapeCSV(data.isSigned ? 'Oui' : 'Non'),
          escapeCSV(upload.confidence || ''),
          escapeCSV(data.rawText || ''),
        ].join(',');
      }),
      '',
      '',
      `"TOTAL",,"","","",,,,,,,,,,`,
      `"Nombre de chèques",${totalCount}`,
      `"Montant total","${totalAmount.toFixed(2).replace('.', ',')} €"`,
    ];

    const csvContent = csvRows.join('\n');

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ocr-exports-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('Error generating CSV export:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération du CSV', details: error.message },
      { status: 500 }
    );
  }
}
