import './globals.css';
import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';

// Roboto is the brand book's documented free alternative to Nitti Grotesk
// (Per Scholas brand guide, May 2025, p.33). Loaded as a CSS variable so
// Tailwind's `font-sans` can chain it with system fallbacks.
const roboto = Roboto({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Atlas · Per Scholas',
  description:
    'Workforce intelligence for Per Scholas — live job-market mapping aligned to curriculum.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body className="min-h-screen bg-white text-gray-900 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
