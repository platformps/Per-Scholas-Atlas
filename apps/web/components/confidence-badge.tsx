// Confidence badge — single source of truth for the brand-aligned
// HIGH/MEDIUM/LOW/REJECT visual treatment. Color choices follow the brand
// book's restraint principle: HIGH/MEDIUM use the blue brand spectrum
// (the strongest organizational signal), LOW gets warm yellow (caution),
// REJECT is muted in cloud-gray. Orange is intentionally NOT used here —
// it's reserved for the admin Manual Fetch CTA so the brand's primary
// accent isn't diluted across every dashboard row.

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT';

const STYLES: Record<Confidence, string> = {
  HIGH:   'bg-royal text-white',
  MEDIUM: 'bg-ocean text-white',
  LOW:    'bg-yellow text-night',
  REJECT: 'bg-cloud text-gray-600',
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded-sm ${STYLES[value]}`}
    >
      {value}
    </span>
  );
}

export type { Confidence };
