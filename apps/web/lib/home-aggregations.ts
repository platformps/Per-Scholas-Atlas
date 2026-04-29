// Aggregation helpers for the homepage.
//
// All helpers take a flat array of "score-with-context" rows (the latest
// score per (job, campus) within the window, joined to job + role metadata)
// and return shapes ready for the home components. Server-side only — no
// React, no `use client`.
//
// Why a single shape: the four homepage modes all slice the same underlying
// dataset. Doing the slicing here keeps the page component purely about
// dispatch + rendering.

import type { ComparisonRow } from '@/components/home/comparison-table';
import type { Confidence } from '@/components/confidence-badge';

// ─── input row ──────────────────────────────────────────────────────────────
export interface ScoreWithContext {
  job_id: string;
  campus_id: string;
  role_id: string | null;
  confidence: Confidence;
  score: number;
  scored_at: string;
  job_title: string | null;
  organization: string | null;
  still_active: boolean | null;
  /** Joined for the focused view; not used at the aggregate level. */
  raw: unknown;
}

// ─── small util: confidence buckets ────────────────────────────────────────
export function emptyBuckets(): { HIGH: number; MEDIUM: number; LOW: number; REJECT: number } {
  return { HIGH: 0, MEDIUM: 0, LOW: 0, REJECT: 0 };
}

export function bumpBucket(
  buckets: ReturnType<typeof emptyBuckets>,
  conf: Confidence,
): void {
  buckets[conf] += 1;
}

// ─── totals (overview tile values) ──────────────────────────────────────────
export interface OverviewTotals {
  /** Unique (job, campus) pairs in the 30-day window — "Seen". */
  totalRecords: number;
  /** Subset of totalRecords whose underlying job is still_active != false.
   *  The "Still Active" tile (also includes still_active === null, i.e.
   *  pre-reconciliation rows on a fresh fetch). */
  liveRecords: number;
  /** Unique (job, campus) pairs that are non-REJECT AND still_active.
   *  Mirrors pipeline-stats.tsx `qualifying` definition exactly. */
  qualifyingRecords: number;
  campusCount: number;
  roleCount: number;
  /** Distinct employers across qualifying-and-still-active postings. */
  employerCount: number;
}

/**
 * Compute the overview-strip metrics. The input `rows` is the per-(job,
 * campus, role) deduped set, so a single posting that matched two roles
 * appears as two rows.
 *
 * For tile-level "unique postings" semantics we collapse those duplicates
 * by (job_id, campus_id) — a posting is a posting, regardless of how
 * many role taxonomies happened to score it. A posting counts as
 * "qualifying" if ANY active role marked it HIGH/MEDIUM/LOW.
 *
 * `roleCount` and `campusCount` come from the un-collapsed set so they
 * reflect "how many roles / campuses have any data," which is the right
 * "X of Y active" semantic for those tiles.
 *
 * Vocabulary alignment with pipeline-stats.tsx (campus drilldown):
 *   Seen          = totalRecords          (all deduped pairs)
 *   Still Active  = liveRecords           (still_active !== false)
 *   Qualifying    = qualifyingRecords     (still_active !== false AND non-REJECT)
 */
export function computeOverview(rows: ScoreWithContext[]): OverviewTotals {
  const campusSet = new Set<string>();
  const roleSet = new Set<string>();
  const employerSet = new Set<string>();
  const allPairs = new Set<string>();
  const livePairs = new Set<string>();
  const qualifyingPairs = new Set<string>();
  for (const r of rows) {
    campusSet.add(r.campus_id);
    if (r.role_id) roleSet.add(r.role_id);
    const pairKey = `${r.job_id}|${r.campus_id}`;
    allPairs.add(pairKey);
    const isLive = r.still_active !== false;
    if (isLive) {
      livePairs.add(pairKey);
      if (r.confidence !== 'REJECT') {
        qualifyingPairs.add(pairKey);
        if (r.organization) employerSet.add(r.organization);
      }
    }
  }
  return {
    totalRecords: allPairs.size,
    liveRecords: livePairs.size,
    qualifyingRecords: qualifyingPairs.size,
    campusCount: campusSet.size,
    roleCount: roleSet.size,
    employerCount: employerSet.size,
  };
}

// ─── role-agnostic collapse for "unique postings" semantics ───────────────
//
// At the AGGREGATE landing the user thinks in terms of unique postings —
// "Atlanta has 50 unique postings near the campus." A posting that scored
// under both CFT and LVFT is still one posting. We use this collapse for
// the campus leaderboard at the aggregate level. For role-filtered views
// the rows are already scoped to a single role so this isn't needed; the
// role leaderboard wants the un-collapsed count (each role's perspective
// counted independently).
//
// Tie-break: keep the highest-confidence row so the buckets reflect the
// "best" read across the active roles. A posting that's HIGH for LVFT
// and REJECT for CFT counts as a HIGH posting on the leaderboard.
const CONFIDENCE_RANK: Record<ScoreWithContext['confidence'], number> = {
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  REJECT: 1,
};

export function dedupByJobCampus(rows: ScoreWithContext[]): ScoreWithContext[] {
  const byKey = new Map<string, ScoreWithContext>();
  for (const r of rows) {
    const key = `${r.job_id}|${r.campus_id}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      CONFIDENCE_RANK[r.confidence] > CONFIDENCE_RANK[existing.confidence]
    ) {
      byKey.set(key, r);
    }
  }
  return Array.from(byKey.values());
}

// ─── group rows by an arbitrary key ─────────────────────────────────────────
function groupBy<K extends string>(
  rows: ScoreWithContext[],
  keyOf: (r: ScoreWithContext) => K | null,
): Map<K, ScoreWithContext[]> {
  const out = new Map<K, ScoreWithContext[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const existing = out.get(k);
    if (existing) existing.push(r);
    else out.set(k, [r]);
  }
  return out;
}

// ─── derive a comparison row from a group ───────────────────────────────────
//
// Vocabulary mirror of pipeline-stats.tsx:
//   total      = "Seen"          (every row in the group, regardless of still_active)
//   live       = "Still Active"  (rows where still_active !== false)
//   qualifying = "Qualifying"    (live AND non-REJECT)
//   employers  = distinct orgs across qualifying postings
//   buckets    = HIGH/MEDIUM/LOW/REJECT counts among live rows only — so the
//                "market signal" mini-bar reflects the current opportunity
//                shape, not a 30-day historical mix that includes ghost jobs.
function deriveComparisonRow(
  id: string,
  name: string,
  subtitle: string | undefined,
  group: ScoreWithContext[],
  href: string | undefined,
  highlight: boolean,
): ComparisonRow {
  const buckets = emptyBuckets();
  const employerSet = new Set<string>();
  const titleCount = new Map<string, number>();
  let live = 0;
  let qualifying = 0;
  for (const r of group) {
    const isLive = r.still_active !== false;
    if (!isLive) continue;
    live += 1;
    bumpBucket(buckets, r.confidence);
    if (r.confidence !== 'REJECT') {
      qualifying += 1;
      if (r.organization) employerSet.add(r.organization);
      if (r.job_title) {
        const norm = r.job_title.trim();
        titleCount.set(norm, (titleCount.get(norm) ?? 0) + 1);
      }
    }
  }
  const topTitles = Array.from(titleCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);
  return {
    id,
    name,
    subtitle,
    total: group.length,
    live,
    qualifying,
    employers: employerSet.size,
    topTitles,
    buckets,
    href,
    highlight,
  };
}

// ─── leaderboard: campuses ──────────────────────────────────────────────────
export function buildCampusLeaderboard(
  rows: ScoreWithContext[],
  campuses: { id: string; name: string; state?: string | null }[],
  highlightCampusId: string | null,
  hrefBuilder: (campusId: string) => string,
): ComparisonRow[] {
  const groups = groupBy(rows, r => r.campus_id);
  const out: ComparisonRow[] = [];
  for (const c of campuses) {
    const group = groups.get(c.id) ?? [];
    out.push(
      deriveComparisonRow(
        c.id,
        c.name,
        c.state ?? undefined,
        group,
        hrefBuilder(c.id),
        c.id === highlightCampusId,
      ),
    );
  }
  // Sort: total desc, then alpha
  out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return out;
}

// ─── leaderboard: roles ─────────────────────────────────────────────────────
export function buildRoleLeaderboard(
  rows: ScoreWithContext[],
  roles: { id: string; name: string }[],
  hrefBuilder: (roleId: string) => string,
): ComparisonRow[] {
  const groups = groupBy(rows, r => r.role_id);
  const out: ComparisonRow[] = [];
  for (const role of roles) {
    const group = groups.get(role.id) ?? [];
    out.push(
      deriveComparisonRow(
        role.id,
        role.name,
        undefined,
        group,
        hrefBuilder(role.id),
        false,
      ),
    );
  }
  out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return out;
}
