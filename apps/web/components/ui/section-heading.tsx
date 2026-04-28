// Standard section heading. Three sizes:
//   sm — small caps label, used inside cards (e.g. "Score breakdown").
//   md — default section title (e.g. "Recent fetch runs").
//   lg — page-level heading.
//
// Accepts an optional count and trailing slot for actions/hints on the right.

import type { ReactNode } from 'react';

type Level = 'sm' | 'md' | 'lg';

interface SectionHeadingProps {
  title: string;
  hint?: string;
  count?: number | string;
  trailing?: ReactNode;
  level?: Level;
  /** Margin-bottom; defaults to mb-4 on md, mb-3 on sm, mb-6 on lg. */
  className?: string;
}

const TITLE_CLASSES: Record<Level, string> = {
  sm: 'text-xs font-semibold uppercase tracking-wider text-gray-500',
  md: 'text-base font-semibold text-night',
  lg: 'text-2xl font-bold tracking-tight text-night',
};

const DEFAULT_MB: Record<Level, string> = {
  sm: 'mb-3',
  md: 'mb-4',
  lg: 'mb-6',
};

export function SectionHeading({
  title,
  hint,
  count,
  trailing,
  level = 'md',
  className,
}: SectionHeadingProps) {
  const mb = className ?? DEFAULT_MB[level];
  return (
    <div className={`flex items-baseline justify-between gap-3 ${mb}`}>
      <div className="flex items-baseline gap-3 min-w-0">
        <h2 className={TITLE_CLASSES[level]}>{title}</h2>
        {count !== undefined && (
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">{count}</span>
        )}
      </div>
      {trailing ?? (hint && <span className="text-xs text-gray-400 shrink-0">{hint}</span>)}
    </div>
  );
}
