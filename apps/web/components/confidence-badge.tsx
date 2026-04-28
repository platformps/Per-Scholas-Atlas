// Confidence badge — single source of truth for HIGH/MEDIUM/LOW/REJECT
// styling. Wraps the shared <Badge> primitive with a confidence-specific
// tone mapping. Per the brand book, orange is reserved for the Manual
// Fetch CTA so it doesn't appear here.
//
// Display vs. data: the DB enum stays HIGH/MEDIUM/LOW/REJECT, but the
// user-facing label for REJECT is rendered as 'ADJACENT' — softer and
// more accurate for an executive audience. The postings aren't "bad",
// they're outside the curriculum's exact target. Keeping the underlying
// enum unchanged avoids a migration and keeps rescore logic intact.

import { Badge } from './ui/badge';

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT';

const TONE: Record<Confidence, Parameters<typeof Badge>[0]['tone']> = {
  HIGH:   'royal',
  MEDIUM: 'ocean',
  LOW:    'yellow',
  REJECT: 'gray',
};

const LABEL: Record<Confidence, string> = {
  HIGH:   'HIGH',
  MEDIUM: 'MEDIUM',
  LOW:    'LOW',
  REJECT: 'ADJACENT',
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return <Badge tone={TONE[value]}>{LABEL[value]}</Badge>;
}

/** Display label for a confidence value, sentence case. Use this in body
 *  copy, panel titles, and tooltips so we have a single source of truth. */
export function confidenceLabel(value: Confidence): string {
  if (value === 'REJECT') return 'Adjacent';
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export type { Confidence };
