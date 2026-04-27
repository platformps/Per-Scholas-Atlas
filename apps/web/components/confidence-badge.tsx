// Small reusable confidence badge. Single source of truth for the color
// mapping so the dashboard, jobs table, and any future surfaces agree.

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT';

const STYLES: Record<Confidence, string> = {
  HIGH:   'border-emerald-700 text-emerald-300 bg-emerald-950/30',
  MEDIUM: 'border-amber-700 text-amber-300 bg-amber-950/30',
  LOW:    'border-orange-700 text-orange-300 bg-orange-950/30',
  REJECT: 'border-zinc-800 text-zinc-500 bg-zinc-950/40',
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <span
      className={`inline-block border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest ${STYLES[value]}`}
    >
      {value}
    </span>
  );
}

export type { Confidence };
