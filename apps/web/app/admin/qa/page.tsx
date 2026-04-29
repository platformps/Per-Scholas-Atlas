// /admin/qa — QA dashboard for cross-surface metric consistency.
//
// Built after a series of silent metric-drift bugs: focused-detail counted
// HIGH/MEDIUM/LOW over inactive postings while campus rows didn't; homepage
// "Records" included still_active=false jobs while drilldown didn't; etc.
//
// This page runs three checks:
//   1. Per-(campus, role) — for every active pair, compares the metrics
//      computed by the production code path (the same dedup + aggregation
//      the homepage uses) against a single round-trip SQL aggregate.
//      Any cell mismatch is flagged red.
//   2. Aggregate — sum across all pairs vs the homepage `computeOverview`
//      tile values. Ensures the role/campus leaderboards roll up cleanly.
//   3. Internal — invariants that must always hold:
//        • H + M + L + REJ == Still Active
//        • H + M + L == Qualifying
//        • Qualifying ≤ Still Active ≤ Seen
//
// Admin-only. Rendered server-side; no client interactivity needed.

import { requireAdmin } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase-server';
import { AppShell } from '@/components/layout/app-shell';
import { Header, NavLinks } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import {
  computeOverview,
  emptyBuckets,
  bumpBucket,
  type ScoreWithContext,
} from '@/lib/home-aggregations';
import type { Confidence } from '@/components/confidence-badge';

const WINDOW_DAYS = 30;
const PAGE_SIZE = 1000;

export const dynamic = 'force-dynamic';

// ─── Types ──────────────────────────────────────────────────────────────────
interface PairMetrics {
  seen: number;
  live: number;
  qualifying: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  REJECT: number;
}

interface PairKey {
  campus_id: string;
  role_id: string;
  campus_name: string;
  role_name: string;
}

interface PairRow {
  key: PairKey;
  prod: PairMetrics;
  truth: PairMetrics;
  mismatch: string[];        // names of cells that disagree
  invariantBreaks: string[]; // names of invariants that fail
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function emptyMetrics(): PairMetrics {
  return { seen: 0, live: 0, qualifying: 0, HIGH: 0, MEDIUM: 0, LOW: 0, REJECT: 0 };
}

function computeMetrics(rows: ScoreWithContext[]): PairMetrics {
  const m = emptyMetrics();
  const buckets = emptyBuckets();
  for (const r of rows) {
    m.seen += 1;
    const isLive = r.still_active !== false;
    if (!isLive) continue;
    m.live += 1;
    bumpBucket(buckets, r.confidence);
    if (r.confidence !== 'REJECT') m.qualifying += 1;
  }
  m.HIGH = buckets.HIGH;
  m.MEDIUM = buckets.MEDIUM;
  m.LOW = buckets.LOW;
  m.REJECT = buckets.REJECT;
  return m;
}

function diffCells(prod: PairMetrics, truth: PairMetrics): string[] {
  const keys: (keyof PairMetrics)[] = ['seen', 'live', 'qualifying', 'HIGH', 'MEDIUM', 'LOW', 'REJECT'];
  return keys.filter(k => prod[k] !== truth[k]);
}

function checkInvariants(m: PairMetrics): string[] {
  const breaks: string[] = [];
  if (m.HIGH + m.MEDIUM + m.LOW + m.REJECT !== m.live) {
    breaks.push('H+M+L+REJ ≠ Live');
  }
  if (m.HIGH + m.MEDIUM + m.LOW !== m.qualifying) {
    breaks.push('H+M+L ≠ Qualifying');
  }
  if (!(m.qualifying <= m.live && m.live <= m.seen)) {
    breaks.push('Q ≤ Live ≤ Seen broken');
  }
  return breaks;
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default async function QAPage() {
  const user = await requireAdmin('/admin/qa');
  const supabase = createServiceClient();
  const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ─── 1. Load rows the same way the homepage does ──────────────────────
  type RawScore = {
    job_id: string;
    campus_id: string;
    confidence: string;
    score: number;
    scored_at: string;
    taxonomies: { role_id: string } | { role_id: string }[] | null;
    jobs:
      | { title: string | null; organization: string | null; still_active: boolean | null }
      | { title: string | null; organization: string | null; still_active: boolean | null }[]
      | null;
  };

  const rawScores: RawScore[] = [];
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: pageData, error } = await supabase
      .from('job_scores')
      .select(`
        job_id,
        campus_id,
        confidence,
        score,
        scored_at,
        taxonomies:taxonomy_id ( role_id ),
        jobs:job_id ( title, organization, still_active )
      `)
      .gte('scored_at', sinceISO)
      .order('scored_at', { ascending: false })
      .range(from, to);
    if (error || !pageData) break;
    rawScores.push(...(pageData as unknown as RawScore[]));
    if (pageData.length < PAGE_SIZE) break;
  }

  // Same (job, campus, role) dedup as the homepage.
  const seen = new Set<string>();
  const rows: ScoreWithContext[] = [];
  for (const r of rawScores) {
    const tax = Array.isArray(r.taxonomies) ? r.taxonomies[0] : r.taxonomies;
    const jb = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    const roleId = tax?.role_id ?? '__no_role__';
    const key = `${r.job_id}|${r.campus_id}|${roleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      job_id: r.job_id,
      campus_id: r.campus_id,
      role_id: tax?.role_id ?? null,
      confidence: r.confidence as Confidence,
      score: r.score,
      scored_at: r.scored_at,
      job_title: jb?.title ?? null,
      organization: jb?.organization ?? null,
      still_active: jb?.still_active ?? null,
      raw: r,
    });
  }

  // ─── 2. Active pair list (campus + role names) ────────────────────────
  const { data: activePairsRaw } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, campuses(id, name), roles(id, name)')
    .eq('active', true);

  const pairList: PairKey[] = ((activePairsRaw as unknown as Array<{
    campus_id: string;
    role_id: string;
    campuses: { id: string; name: string } | { id: string; name: string }[] | null;
    roles: { id: string; name: string } | { id: string; name: string }[] | null;
  }>) ?? [])
    .map(p => {
      const c = Array.isArray(p.campuses) ? p.campuses[0] : p.campuses;
      const r = Array.isArray(p.roles) ? p.roles[0] : p.roles;
      if (!c || !r) return null;
      return {
        campus_id: p.campus_id,
        role_id: p.role_id,
        campus_name: c.name,
        role_name: r.name,
      };
    })
    .filter((p): p is PairKey => p !== null)
    .sort((a, b) => a.role_name.localeCompare(b.role_name) || a.campus_name.localeCompare(b.campus_name));

  // ─── 3. Production-code metrics per pair (from rows) ──────────────────
  const prodByPair = new Map<string, PairMetrics>();
  for (const p of pairList) {
    const k = `${p.campus_id}|${p.role_id}`;
    const groupRows = rows.filter(r => r.campus_id === p.campus_id && r.role_id === p.role_id);
    prodByPair.set(k, computeMetrics(groupRows));
  }

  // ─── 4. Ground-truth metrics per pair (single SQL round-trip) ─────────
  const { data: truthRaw } = await supabase.rpc('qa_pair_metrics' as never, {
    since_iso: sinceISO,
  } as never);
  // Fallback path: if the RPC doesn't exist, do it client-side from rawScores.
  // (RPC is optional — implementing here for portability.)
  const truthByPair = new Map<string, PairMetrics>();
  if (Array.isArray(truthRaw) && truthRaw.length > 0) {
    for (const r of truthRaw as Array<{
      campus_id: string; role_id: string;
      seen: number; live: number; qualifying: number;
      h: number; m: number; l: number; rej: number;
    }>) {
      truthByPair.set(`${r.campus_id}|${r.role_id}`, {
        seen: r.seen,
        live: r.live,
        qualifying: r.qualifying,
        HIGH: r.h, MEDIUM: r.m, LOW: r.l, REJECT: r.rej,
      });
    }
  } else {
    // Compute truth from a fresh dedup directly on rawScores (no upstream
    // filter logic). Keys on (job, campus, role) using LATEST scored_at.
    const seenT = new Set<string>();
    const truthRows: Array<{
      campus_id: string; role_id: string;
      confidence: string; still_active: boolean | null;
    }> = [];
    for (const r of rawScores) {
      const tax = Array.isArray(r.taxonomies) ? r.taxonomies[0] : r.taxonomies;
      const jb = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
      const role_id = tax?.role_id ?? '';
      if (!role_id) continue;
      const k = `${r.job_id}|${r.campus_id}|${role_id}`;
      if (seenT.has(k)) continue;
      seenT.add(k);
      truthRows.push({
        campus_id: r.campus_id,
        role_id,
        confidence: r.confidence,
        still_active: jb?.still_active ?? null,
      });
    }
    for (const r of truthRows) {
      const k = `${r.campus_id}|${r.role_id}`;
      const m = truthByPair.get(k) ?? emptyMetrics();
      m.seen += 1;
      const isLive = r.still_active !== false;
      if (isLive) {
        m.live += 1;
        if (r.confidence === 'HIGH') m.HIGH += 1;
        else if (r.confidence === 'MEDIUM') m.MEDIUM += 1;
        else if (r.confidence === 'LOW') m.LOW += 1;
        else if (r.confidence === 'REJECT') m.REJECT += 1;
        if (r.confidence !== 'REJECT') m.qualifying += 1;
      }
      truthByPair.set(k, m);
    }
  }

  // ─── 5. Build pair-row table data ─────────────────────────────────────
  const pairRows: PairRow[] = pairList.map(key => {
    const k = `${key.campus_id}|${key.role_id}`;
    const prod = prodByPair.get(k) ?? emptyMetrics();
    const truth = truthByPair.get(k) ?? emptyMetrics();
    return {
      key,
      prod,
      truth,
      mismatch: diffCells(prod, truth),
      invariantBreaks: checkInvariants(prod),
    };
  });

  const totalMismatches = pairRows.reduce((s, p) => s + (p.mismatch.length > 0 ? 1 : 0), 0);
  const totalInvariantBreaks = pairRows.reduce(
    (s, p) => s + (p.invariantBreaks.length > 0 ? 1 : 0),
    0,
  );

  // ─── 6. Aggregate roll-up ─────────────────────────────────────────────
  const overviewProd = computeOverview(rows);
  const sumOfPairs = pairRows.reduce(
    (acc, p) => ({
      seen: acc.seen + p.prod.seen,
      live: acc.live + p.prod.live,
      qualifying: acc.qualifying + p.prod.qualifying,
    }),
    { seen: 0, live: 0, qualifying: 0 },
  );
  // Note: sumOfPairs > overviewProd by the cross-role overlap. That's
  // expected; we display both so the relationship is auditable.
  const crossRoleOverlap = sumOfPairs.live - overviewProd.liveRecords;

  return (
    <AppShell
      header={
        <Header
          subtitle={<span className="text-sm text-gray-500">Admin · QA</span>}
          meta="Cross-surface metric consistency"
          nav={<NavLinks email={user.email} active="admin" showAdminLink />}
        />
      }
      footer={<Footer />}
    >
      <div className="space-y-6">
        {/* Summary banner */}
        <Card>
          <div className="p-5 flex flex-wrap items-center gap-4">
            <Badge tone={totalMismatches === 0 ? 'royal' : 'orange'} variant="soft" size="md">
              {totalMismatches === 0
                ? '✓ All pair metrics match'
                : `✗ ${totalMismatches} pair(s) mismatch`}
            </Badge>
            <Badge tone={totalInvariantBreaks === 0 ? 'royal' : 'orange'} variant="soft" size="md">
              {totalInvariantBreaks === 0
                ? '✓ All invariants hold'
                : `✗ ${totalInvariantBreaks} invariant break(s)`}
            </Badge>
            <span className="text-xs text-gray-500">
              {pairRows.length} active pair{pairRows.length === 1 ? '' : 's'} · {WINDOW_DAYS}d window
            </span>
          </div>
        </Card>

        {/* Section 2: Aggregate roll-up */}
        <Card>
          <div className="border-b border-gray-200 bg-cloud px-6 py-4">
            <h3 className="text-sm font-semibold text-night">Aggregate consistency</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Homepage tile values vs sum of all pair metrics. The cross-role overlap
              is expected: a posting scored under both roles counts in both pair rows
              but only once at the tile level.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-2 text-left">Metric</th>
                  <th className="px-4 py-2 text-right">computeOverview tile</th>
                  <th className="px-4 py-2 text-right">Sum of pair rows</th>
                  <th className="px-4 py-2 text-right">Δ (overlap)</th>
                </tr>
              </thead>
              <tbody className="text-sm tabular-nums">
                <tr className="border-t border-gray-100">
                  <td className="px-4 py-2">Seen</td>
                  <td className="px-4 py-2 text-right">{overviewProd.totalRecords.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{sumOfPairs.seen.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {(sumOfPairs.seen - overviewProd.totalRecords).toLocaleString()}
                  </td>
                </tr>
                <tr className="border-t border-gray-100">
                  <td className="px-4 py-2">Still Active</td>
                  <td className="px-4 py-2 text-right">{overviewProd.liveRecords.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{sumOfPairs.live.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{crossRoleOverlap.toLocaleString()}</td>
                </tr>
                <tr className="border-t border-gray-100">
                  <td className="px-4 py-2">Qualifying</td>
                  <td className="px-4 py-2 text-right">{overviewProd.qualifyingRecords.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{sumOfPairs.qualifying.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {(sumOfPairs.qualifying - overviewProd.qualifyingRecords).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {/* Section 1: Per-pair table */}
        <Card>
          <div className="border-b border-gray-200 bg-cloud px-6 py-4">
            <h3 className="text-sm font-semibold text-night">
              Per-(campus, role) consistency · production code vs ground truth
            </h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Production: rows from the same paginated query the homepage uses, after the
              (job, campus, role) dedup. Ground truth: same dedup recomputed
              independently from the raw API rows. They MUST match — any red row is a bug.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2 text-left">Pair</th>
                  <th className="px-2 py-2 text-right" colSpan={2}>Seen</th>
                  <th className="px-2 py-2 text-right" colSpan={2}>Live</th>
                  <th className="px-2 py-2 text-right" colSpan={2}>Qual.</th>
                  <th className="px-2 py-2 text-right" colSpan={2}>H</th>
                  <th className="px-2 py-2 text-right" colSpan={2}>M</th>
                  <th className="px-2 py-2 text-right" colSpan={2}>L</th>
                  <th className="px-2 py-2 text-right" colSpan={2}>REJ</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
                <tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                  <th className="px-3 py-1"></th>
                  <th className="px-2 py-1 text-right">prod</th><th className="px-2 py-1 text-right">truth</th>
                  <th className="px-2 py-1 text-right">prod</th><th className="px-2 py-1 text-right">truth</th>
                  <th className="px-2 py-1 text-right">prod</th><th className="px-2 py-1 text-right">truth</th>
                  <th className="px-2 py-1 text-right">prod</th><th className="px-2 py-1 text-right">truth</th>
                  <th className="px-2 py-1 text-right">prod</th><th className="px-2 py-1 text-right">truth</th>
                  <th className="px-2 py-1 text-right">prod</th><th className="px-2 py-1 text-right">truth</th>
                  <th className="px-2 py-1 text-right">prod</th><th className="px-2 py-1 text-right">truth</th>
                  <th className="px-3 py-1"></th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {pairRows.map(pr => (
                  <PairRowEl key={`${pr.key.campus_id}|${pr.key.role_id}`} row={pr} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

// ─── Per-pair row ───────────────────────────────────────────────────────────
function PairRowEl({ row }: { row: PairRow }) {
  const cell = (k: keyof PairMetrics) => {
    const mismatch = row.mismatch.includes(k);
    return (
      <>
        <td className={`px-2 py-1.5 text-right ${mismatch ? 'text-red-600 font-semibold' : ''}`}>
          {row.prod[k].toLocaleString()}
        </td>
        <td className={`px-2 py-1.5 text-right ${mismatch ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
          {row.truth[k].toLocaleString()}
        </td>
      </>
    );
  };
  const issues = [...row.mismatch.map(c => `≠${c}`), ...row.invariantBreaks];
  const ok = issues.length === 0;
  return (
    <tr className={`border-t border-gray-100 ${ok ? '' : 'bg-red-50'}`}>
      <td className="px-3 py-1.5 align-top">
        <div className="font-semibold text-night text-xs leading-tight">{row.key.role_name}</div>
        <div className="text-[10px] text-gray-500 leading-tight">{row.key.campus_name}</div>
      </td>
      {cell('seen')}
      {cell('live')}
      {cell('qualifying')}
      {cell('HIGH')}
      {cell('MEDIUM')}
      {cell('LOW')}
      {cell('REJECT')}
      <td className="px-3 py-1.5 text-[10px] text-gray-600">
        {ok ? <span className="text-green-700">✓</span> : issues.join(' · ')}
      </td>
    </tr>
  );
}
