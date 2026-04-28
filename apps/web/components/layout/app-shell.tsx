// AppShell — the outer chrome for every authenticated page.
// Wraps the page in:
//   • full-bleed brand-accent supergraphic strip
//   • <Header> (slot)
//   • centered max-w-[1400px] content column with consistent padding
//   • <Footer> (slot)
//
// Standard width: max-w-[1400px]. Previously the dashboard used 1600 and the
// admin page used 1400. Standardizing on 1400 keeps reading-line lengths
// reasonable on ultra-wide displays without crowding the 30-day pipeline
// row at typical 1440-1680px laptop widths.

import type { ReactNode } from 'react';

interface AppShellProps {
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function AppShell({ header, footer, children }: AppShellProps) {
  return (
    <main className="min-h-screen bg-white flex flex-col">
      <div className="brand-accent-bar" aria-hidden />
      {header}
      <div className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {children}
        {footer}
      </div>
    </main>
  );
}
