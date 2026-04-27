import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Per Scholas Job Intelligence',
  description: 'Live job-market mapping for Per Scholas curriculum',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-200">{children}</body>
    </html>
  );
}
