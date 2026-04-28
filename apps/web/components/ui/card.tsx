// Standard card surface — the foundational layout primitive used across
// the dashboard and admin pages. Replaces the bg-white border rounded-md
// shadow-sm pattern that was duplicated in 12 files prior to extraction.
//
// Composition:
//   <Card>                       — surface only, padding via children
//     <CardHeader>...</CardHeader>
//     <CardBody>...</CardBody>
//     <CardFooter>...</CardFooter>
//   </Card>
//
// Or for simple uses, just <Card><div className="p-6">...</div></Card>.

import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-6 py-4 border-b border-gray-200 bg-gray-50 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`p-6 ${className}`}>{children}</div>;
}

export function CardFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-6 py-4 border-t border-gray-100 ${className}`}>{children}</div>;
}
