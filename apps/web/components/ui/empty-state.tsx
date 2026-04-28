// Standard empty state for cards/sections with no data. Promotes the
// inline EmptyState that previously lived inside insights-panels.tsx and
// jobs-table.tsx into a shared primitive.
//
// Use inside a Card body, or as a standalone card via the `framed` prop.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Optional small-caps label above the message. */
  title?: string;
  /** The main empty-state message. */
  message: ReactNode;
  /** Optional action button slot. */
  action?: ReactNode;
  /** When true, wraps in a card-like surface. */
  framed?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  message,
  action,
  framed = false,
  className = '',
}: EmptyStateProps) {
  const inner = (
    <div className={`text-center py-8 px-4 ${className}`}>
      {title && (
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          {title}
        </div>
      )}
      <p className="text-sm text-gray-600 max-w-md mx-auto leading-relaxed">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
  if (framed) {
    return (
      <div className="bg-white border border-gray-200 rounded-md shadow-sm">{inner}</div>
    );
  }
  return inner;
}
