// App footer — small caption + brand attribution. The dashboard uses a
// richer "Data source" block above this; the admin page uses just the
// attribution. Take both as props to keep one concern (footer chrome) here.

import type { ReactNode } from 'react';

interface FooterProps {
  /** Optional explanatory block above the attribution. */
  children?: ReactNode;
}

export function Footer({ children }: FooterProps) {
  return (
    <footer className="pt-8 mt-8 border-t border-gray-200 text-xs text-gray-500 leading-relaxed">
      {children}
      <p className={`text-gray-400 ${children ? 'mt-3' : ''}`}>
        Atlas is a Per Scholas internal tool · v1
      </p>
    </footer>
  );
}
