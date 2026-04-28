// Confidence badge — single source of truth for HIGH/MEDIUM/LOW/REJECT
// styling. Wraps the shared <Badge> primitive with a confidence-specific
// tone mapping. Per the brand book, orange is reserved for the Manual
// Fetch CTA so it doesn't appear here.

import { Badge } from './ui/badge';

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT';

const TONE: Record<Confidence, Parameters<typeof Badge>[0]['tone']> = {
  HIGH:   'royal',
  MEDIUM: 'ocean',
  LOW:    'yellow',
  REJECT: 'gray',
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return <Badge tone={TONE[value]}>{value}</Badge>;
}

export type { Confidence };
