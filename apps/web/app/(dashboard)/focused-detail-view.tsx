// Focused detail view — rendered when BOTH campus and role are selected.
//
// This is the original Atlas dashboard layout: pipeline stats, fetch trend,
// rejection breakdown, confidence distribution, top skills, top employers,
// and the deduped jobs table. Behavior is preserved; only the page chrome
// changed (now wrapped by AppShell + the homepage filter bar).
//
// Lives next to the homepage page.tsx because it owns its own data-fetching
// — the homepage uses a lightweight aggregate query, but this view needs
// the full per-pair shape with all the score-breakdown fields.

import { createClient } from '@/lib/supabase-server';
import { JobsTable } from '@/components/jobs-table';
import { CsvExportButton, type CsvRow } from '@/components/csv-export-button';
import { PipelineStats } from '@/components/pipeline-stats';
import { FetchTrend, type TrendPoint } from '@/components/fetch-trend';
import {
  RejectionBreakdown,
  type RawReason,
} from '@/components/rejection-breakdown';
import {
  TopSkillsPanel,
  TopEmployersPanel,
  ConfidenceDistributionPanel,
} from '@/components/insights-panels';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface FocusedDetailViewProps {
  campusId: string;
  campusName: string;
  campusAddress: string | null;
  roleId: string;
  roleName: string;
  windowDays: number;
  confidenceFilter: string | null;
  /** When set, the jobs table is filtered to rows where job.organization
   *  case-insensitively equals this value. Driven by clicking an employer
   *  in the Top Employers panel. */
  employerFilter: string | null;
}

export async function FocusedDetailView({
  campusId,
  campusName,
  campusAddress,
  roleId,
  roleName,
  windowDays,
  confidenceFilter,
  employerFilter,
}: FocusedDetailViewProps) {
  const supabase = createClient();
  const sinceISO = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Latest fetch for this exact pair (header timestamp)
  const { data: latestRun } = await supabase
    .from('fetch_runs')
    .select('id, completed_at, jobs_returned, trigger_type')
    .eq('campus_id', campusId)
    .eq('role_id', roleId)
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Score rows for this campus in the window. We dedup to latest per job_id
  // in JS — the SQL surface for DISTINCT ON is awkward through Supabase JS.
  const { data: scoresWindow } = await supabase
    .from('job_scores')
    .select(
      `
        *,
        jobs:job_id (
          id, source_id, title, organization, url, date_posted,
          cities_derived, regions_derived, ai_salary_min, ai_salary_max,
          description_text, ai_key_skills, ai_experience_level, still_active,
          first_seen_at
        ),
        taxonomies:taxonomy_id ( role_id )
      `,
    )
    .eq('campus_id', campusId)
    .gte('scored_at', sinceISO)
    .order('scored_at', { ascending: false });

  type ScoreRow = NonNullable<typeof scoresWindow>[number];
  type TaxJoin = { role_id: string } | { role_id: string }[] | null;
  function getRoleId(s: ScoreRow): string | null {
    const t = (s as { taxonomies?: TaxJoin }).taxonomies ?? null;
    if (!t) return null;
    if (Array.isArray(t)) return t[0]?.role_id ?? null;
    return t.role_id ?? null;
  }

  // Filter to scores belonging to the active role's taxonomy
  const scoresForRole = ((scoresWindow ?? []) as ScoreRow[]).filter(
    s => getRoleId(s) === roleId,
  );

  const seenJobIds = new Set<string>();
  const latestPerJob: ScoreRow[] = [];
  for (const s of scoresForRole) {
    const jid = (s as { job_id: string }).job_id;
    if (seenJobIds.has(jid)) continue;
    seenJobIds.add(jid);
    latestPerJob.push(s);
  }

  // Apply confidence + employer filters in series. Employer match is
  // case-insensitive trimmed equality — looser than substring (avoids
  // 'A' matching 'AT&T') and tighter than fuzzy (we don't want surprises
  // when an MD clicked a specific row).
  const employerNorm = employerFilter?.trim().toLowerCase() ?? null;
  let tableScoresFiltered = latestPerJob;
  if (confidenceFilter) {
    tableScoresFiltered = tableScoresFiltered.filter(
      s => (s as { confidence: string }).confidence === confidenceFilter,
    );
  }
  if (employerNorm) {
    tableScoresFiltered = tableScoresFiltered.filter(s => {
      const org = (s as { jobs?: { organization?: string | null } | null }).jobs?.organization;
      return org ? org.trim().toLowerCase() === employerNorm : false;
    });
  }
  const tableScores = [...tableScoresFiltered].sort(
    (a, b) =>
      ((b as { score?: number }).score ?? 0) - ((a as { score?: number }).score ?? 0),
  );

  // Pipeline counts.
  //
  // H/M/L/REJECT buckets and the qualifying tile are scoped to
  // still_active=true (or null = pre-reconciliation) so the focused view's
  // numbers stay consistent with the campus-first leaderboard, where each
  // role row's "qualifying" is also live-only.
  //
  // Without this scoping the focused view double-counted ghost postings:
  // a job whose listing has been pulled by the source ATS but was once
  // scored MEDIUM still showed up under "Medium 1", inflating qualifying.
  // Discovered 2026-04-28 when Chicago × CFT showed Qualifying=2 at the
  // focused level but Qualifying=1 on the Chicago campus-first row —
  // same job had a Medium under taxonomy v1.1.3 and a Low under v1.1.4
  // and only one of them was on a still-active posting.
  const isLive = (s: ScoreRow): boolean =>
    (s as { jobs?: { still_active?: boolean | null } }).jobs?.still_active !== false;
  const liveLatest = latestPerJob.filter(isLive);
  const counts = {
    HIGH: liveLatest.filter(s => (s as { confidence: string }).confidence === 'HIGH').length,
    MEDIUM: liveLatest.filter(s => (s as { confidence: string }).confidence === 'MEDIUM').length,
    LOW: liveLatest.filter(s => (s as { confidence: string }).confidence === 'LOW').length,
    REJECT: liveLatest.filter(s => (s as { confidence: string }).confidence === 'REJECT').length,
  };
  const totalSeen = latestPerJob.length;
  const stillActive = liveLatest.length;
  const qualifying = counts.HIGH + counts.MEDIUM + counts.LOW;

  // Rejection breakdown — scoped to live so the bars match the H/M/L/REJECT
  // bucket counts above. Past rejections on now-inactive postings are
  // historical noise that doesn't help a Managing Director scope a cohort.
  const reasonCounts = new Map<string, number>();
  for (const s of liveLatest) {
    const sr = s as { confidence: string; rejection_reason?: string | null };
    if (sr.confidence !== 'REJECT') continue;
    const key = sr.rejection_reason ?? '__below_score_threshold__';
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const rejectionReasons: RawReason[] = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // Trend chart — successful fetches in the window
  const { data: runsWindow } = await supabase
    .from('fetch_runs')
    .select('id, completed_at, trigger_type')
    .eq('campus_id', campusId)
    .eq('role_id', roleId)
    .eq('status', 'success')
    .gte('completed_at', sinceISO)
    .order('completed_at', { ascending: true });

  const trendByRun = new Map<string, { high: number; medium: number; low: number; reject: number }>();
  for (const s of scoresForRole) {
    const fri = (s as { fetch_run_id?: string | null }).fetch_run_id;
    if (!fri) continue;
    if (!trendByRun.has(fri)) trendByRun.set(fri, { high: 0, medium: 0, low: 0, reject: 0 });
    const c = trendByRun.get(fri)!;
    const conf = ((s as { confidence: string }).confidence ?? '').toLowerCase() as
      | 'high'
      | 'medium'
      | 'low'
      | 'reject';
    if (conf in c) c[conf]++;
  }
  const trend: TrendPoint[] = (
    (runsWindow as Array<{
      id: string;
      completed_at: string;
      trigger_type: 'scheduled' | 'manual' | 'rescore';
    }> | null) ?? []
  ).map(r => ({
    fetchRunId: r.id,
    date: r.completed_at,
    triggerType: r.trigger_type,
    ...(trendByRun.get(r.id) ?? { high: 0, medium: 0, low: 0, reject: 0 }),
  }));

  // Insight panels — top skills + employers (qualifying only)
  const skillFreq: Record<string, number> = {};
  latestPerJob
    .filter(s => (s as { confidence: string }).confidence !== 'REJECT')
    .forEach(s => {
      const sr = s as {
        core_matched?: string[] | null;
        specialized_matched?: string[] | null;
      };
      [...(sr.core_matched ?? []), ...(sr.specialized_matched ?? [])].forEach(skill => {
        skillFreq[skill] = (skillFreq[skill] ?? 0) + 1;
      });
    });
  const topSkills = Object.entries(skillFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const empFreq: Record<string, number> = {};
  latestPerJob
    .filter(s => {
      const sr = s as { confidence: string; jobs?: { organization?: string | null } | null };
      return sr.confidence !== 'REJECT' && sr.jobs?.organization;
    })
    .forEach(s => {
      const org = (s as { jobs?: { organization?: string | null } | null }).jobs!.organization!;
      empFreq[org] = (empFreq[org] ?? 0) + 1;
    });
  const topEmployers = Object.entries(empFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <Card>
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row gap-5 lg:items-center">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge tone="navy" variant="soft" size="sm">
                Focused detail
              </Badge>
              <span className="text-[11px] text-gray-400 font-mono">
                {campusId} · {roleId}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-night tracking-tight leading-tight">
              {roleName} <span className="text-gray-400 font-normal">·</span> {campusName}
            </h2>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              {campusAddress ? <>{campusAddress} · </> : null}
              {latestRun
                ? `Last fetch ${new Date(
                    (latestRun as { completed_at: string }).completed_at,
                  ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${
                    (latestRun as { jobs_returned?: number }).jobs_returned ?? 0
                  } jobs`
                : 'No fetches yet — cron runs Mon/Wed/Fri 9am ET'}
            </p>
          </div>
        </div>
      </Card>

      <PipelineStats
        windowDays={windowDays}
        totalSeen={totalSeen}
        stillActive={stillActive}
        qualifying={qualifying}
        counts={counts}
      />

      <FetchTrend data={trend} windowDays={windowDays} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RejectionBreakdown reasons={rejectionReasons} windowDays={windowDays} />
        <ConfidenceDistributionPanel
          counts={counts}
          total={totalSeen}
          scores={latestPerJob}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopSkillsPanel skills={topSkills} />
        <TopEmployersPanel
          employers={topEmployers}
          selectedEmployer={employerFilter}
          hrefForEmployer={org => buildFilterHref({ campusId, roleId, confidenceFilter, employer: org })}
          clearFilterHref={buildFilterHref({ campusId, roleId, confidenceFilter, employer: null })}
        />
      </div>

      {employerFilter && (
        <div className="flex items-center gap-2 text-sm bg-royal/[0.06] border border-royal/20 rounded-sm px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-royal">
            Filtering
          </span>
          <span className="text-night">Employer = <strong>{employerFilter}</strong></span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-600">
            {tableScores.length} job{tableScores.length === 1 ? '' : 's'}
          </span>
          <a
            href={buildFilterHref({ campusId, roleId, confidenceFilter, employer: null })}
            className="ml-auto text-xs text-royal hover:text-navy underline-offset-2 hover:underline"
          >
            Clear filter
          </a>
        </div>
      )}

      {/* CSV export sits above the jobs table, right-aligned. The export
          uses the SAME tableScores the table renders so any active filter
          (confidence + employer) is reflected — "Download these 8 LOW
          jobs at TEKsystems" is the use case the employer-filter unlocks. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-gray-500">
          {tableScores.length} job{tableScores.length === 1 ? '' : 's'} in table
          {confidenceFilter ? <> · {confidenceFilter} only</> : null}
          {employerFilter ? <> · {employerFilter} only</> : null}
        </span>
        <CsvExportButton
          rows={buildCsvRows(tableScores)}
          filename={`atlas_${campusId}_${roleId}_${formatDateForFilename()}.csv`}
          label={`Download CSV (${tableScores.length.toLocaleString()})`}
        />
      </div>

      <JobsTable scores={tableScores as never} />
    </div>
  );
}

// ─── CSV projection ─────────────────────────────────────────────────────────
// `scores` is the deduped tableScores set; the schema is the
// joined job_scores+jobs+taxonomies row. We accept unknown[] because
// the precise ScoreRow type is local to the component scope and we don't
// want to leak the join shape across the helper boundary — the indexing
// here is only used to surface fields users would see in a CSV export.
function buildCsvRows(scores: unknown[]): CsvRow[] {
  return scores.map(s => {
    const r = s as {
      jobs?: {
        title?: string | null;
        organization?: string | null;
        url?: string | null;
        cities_derived?: string[] | null;
        regions_derived?: string[] | null;
        date_posted?: string | null;
        ai_experience_level?: string | null;
      } | null;
      score?: number | null;
      confidence?: string | null;
      title_tier?: string | null;
      title_matched?: string | null;
      scored_at?: string | null;
      rejection_reason?: string | null;
    };
    const j = r.jobs ?? null;
    return {
      confidence: r.confidence ?? '',
      score: r.score ?? 0,
      title_tier: r.title_tier ?? null,
      title_matched: r.title_matched ?? null,
      title: j?.title ?? '',
      organization: j?.organization ?? '',
      url: j?.url ?? '',
      city: j?.cities_derived?.[0] ?? '',
      region: j?.regions_derived?.[0] ?? '',
      date_posted: j?.date_posted ?? '',
      experience_level: j?.ai_experience_level ?? '',
      scored_at: r.scored_at ?? '',
      rejection_reason: r.rejection_reason ?? '',
    };
  });
}

function formatDateForFilename(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Build a /?campus=&role=… URL preserving confidence + employer selections.
// Pass `employer: null` to clear the employer filter while keeping campus,
// role, and confidence intact.
function buildFilterHref(opts: {
  campusId: string;
  roleId: string;
  confidenceFilter: string | null;
  employer: string | null;
}): string {
  const qs = new URLSearchParams();
  qs.set('campus', opts.campusId);
  qs.set('role', opts.roleId);
  if (opts.confidenceFilter) qs.set('confidence', opts.confidenceFilter);
  if (opts.employer) qs.set('employer', opts.employer);
  return `/?${qs.toString()}`;
}
