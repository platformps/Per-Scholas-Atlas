// Standard button. Six variants cover the entire app's button surface:
//   primary    — Royal fill (Save, Activate, Sign in). Default.
//   action     — Orange fill (Manual Fetch only — brand reserves orange).
//   secondary  — Royal outline (per-row Fetch buttons).
//   neutral    — Gray outline (Deactivate, Cancel inline).
//   ghost      — No bg, gray text + underline (Reset, Cancel).
//   danger     — Orange text + underline (Remove industry).
//
// Two sizes: sm (px-3 py-1 text-xs uppercase) for inline row actions,
// md (px-4 py-2 text-sm) for primary CTAs.

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './spinner';

type Variant = 'primary' | 'action' | 'secondary' | 'neutral' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:   'bg-royal text-white hover:bg-navy active:bg-navy/90 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed shadow-sm',
  action:    'bg-orange text-white hover:bg-orange/90 active:bg-orange/80 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed shadow-sm',
  secondary: 'border border-royal text-royal hover:bg-royal/5 active:bg-royal/10 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed',
  neutral:   'border border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed',
  ghost:     'text-gray-600 hover:text-night underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed',
  danger:    'text-orange hover:text-orange/80 underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3 py-1 text-xs font-semibold uppercase tracking-wider',
  md: 'px-4 py-2 text-sm font-semibold',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-sm transition-colors duration-150',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" label="" />}
      {children}
    </button>
  );
}
