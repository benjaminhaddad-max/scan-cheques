import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Traitement des chèques',
  description: 'Module standalone de traitement OCR de chèques (GPT-5 vision)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
