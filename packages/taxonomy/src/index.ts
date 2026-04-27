import cftSchema from '../schemas/cft.json' assert { type: 'json' };
import type { Taxonomy } from '@per-scholas/scoring/src/types';

export const TAXONOMIES: Record<string, Taxonomy> = {
  cft: cftSchema as unknown as Taxonomy,
};

const VALIDATED = new WeakSet<Taxonomy>();

/**
 * §A6 — surface canonical names that appear in BOTH `core_skills.skills`
 * and `certifications.certs`. Per Imran 2026-04-27 this overlap is
 * unintentional — a single description mention currently scores in both
 * buckets (8 + 5 = 13 pts). Fix is queued for post-fetch tuning (§C).
 *
 * Also a hook for future invariant checks (Zod-shaped) when we wire those in.
 *
 * No behavior change in this pass — this only emits a console.warn so an
 * operator running the seed (or any caller of getTaxonomy()) sees it.
 */
export function validateTaxonomy(t: Taxonomy, label = ''): void {
  if (VALIDATED.has(t)) return;
  VALIDATED.add(t);

  const coreCanonicals = new Set((t.core_skills?.skills ?? []).map(s => s.canonical));
  const certCanonicals = new Set((t.certifications?.certs ?? []).map(s => s.canonical));
  const dupes: string[] = [];
  for (const c of certCanonicals) if (coreCanonicals.has(c)) dupes.push(c);

  if (dupes.length > 0) {
    const tag = label ? `[${label}] ` : '';
    // eslint-disable-next-line no-console
    console.warn(
      `${tag}taxonomy: ${dupes.join(', ')} appear in BOTH core_skills and certifications. ` +
        `Single mention currently double-counts (core ${t.core_skills?.weight_per_match ?? '?'} + cert ` +
        `${t.certifications?.weight_per_match ?? '?'} pts). Per Imran 2026-04-27 this is unintended; ` +
        `fix queued for post-fetch tuning. See SCORING_ADDENDUM.md §A6.`,
    );
  }
}

export function getTaxonomy(roleId: string): Taxonomy {
  const t = TAXONOMIES[roleId];
  if (!t) throw new Error(`No taxonomy found for role: ${roleId}`);
  validateTaxonomy(t, roleId);
  return t;
}

export type { Taxonomy };
