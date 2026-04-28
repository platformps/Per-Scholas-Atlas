// Inline animated spinner. Used by <Button loading> and any async UI states.
// Sized via className (default h-4 w-4) so callers can scale to their context.

interface SpinnerProps {
  className?: string;
  /** Accessible label, announced to screen readers. */
  label?: string;
}

export function Spinner({ className = 'h-4 w-4', label = 'Loading' }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
