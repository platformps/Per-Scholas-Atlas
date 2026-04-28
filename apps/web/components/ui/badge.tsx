// Badge / status pill. Replaces the inline span pattern used for confidence
// levels, status indicators, watchlist healthcare flags, etc.
//
// Tones map to the brand palette + a neutral gray.

import type { ReactNode } from 'react';

type Tone = 'royal' | 'navy' | 'ocean' | 'yellow' | 'orange' | 'cloud' | 'gray';
type Variant = 'solid' | 'soft';
type Size = 'sm' | 'md';

interface BadgeProps {
  tone: Tone;
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
}

const SOLID_CLASSES: Record<Tone, string> = {
  royal:  'bg-royal text-white',
  navy:   'bg-navy text-white',
  ocean:  'bg-ocean text-white',
  yellow: 'bg-yellow text-night',
  orange: 'bg-orange text-white',
  cloud:  'bg-cloud text-gray-700',
  gray:   'bg-gray-200 text-gray-700',
};

const SOFT_CLASSES: Record<Tone, string> = {
  royal:  'bg-royal/10 text-royal border border-royal/20',
  navy:   'bg-navy/10 text-navy border border-navy/20',
  ocean:  'bg-ocean/10 text-ocean border border-ocean/20',
  yellow: 'bg-yellow/15 text-night border border-yellow/30',
  orange: 'bg-orange/10 text-orange border border-orange/20',
  cloud:  'bg-cloud text-gray-700 border border-gray-200',
  gray:   'bg-gray-100 text-gray-700 border border-gray-200',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-1.5 py-0.5 text-[10px] leading-4',
  md: 'px-2 py-0.5 text-xs leading-5',
};

export function Badge({
  tone,
  variant = 'solid',
  size = 'md',
  children,
  className = '',
}: BadgeProps) {
  const palette = variant === 'soft' ? SOFT_CLASSES[tone] : SOLID_CLASSES[tone];
  return (
    <span
      className={`inline-block font-semibold uppercase tracking-wider rounded-sm ${SIZE_CLASSES[size]} ${palette} ${className}`}
    >
      {children}
    </span>
  );
}
