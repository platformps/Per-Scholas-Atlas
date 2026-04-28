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
}

export async function FocusedDetailView({
  campusId,
  campusName,
  campusAddress,
  roleId,
  roleName,
  windowDays,
  confidenceFilter,
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

  const tableScoresFiltered = confidenceFilter
    ? latestPerJob.filter(s => (s as { confidence: string }).confidence === confidenceFilter)
    : latestPerJob;
  const tableScores = [...tableScoresFiltered].sort(
    (a, b) =>
      ((b as { score?: number }).score ?? 0) - ((a as { score?: number }).score ?? 0),
  );

  // Pipeline counts
  const counts = {
    HIGH: latestPerJob.filter(s => (s as { confidence: string }).confidence === 'HIGH').length,
    MEDIUM: latestPerJob.filter(s => (s as { confidence: string }).confidence === 'MEDIUM').length,
    LOW: latestPerJob.filter(s => (s as { confidence: string }).confidence === 'LOW').length,
    REJECT: latestPerJob.filter(s => (s as { confidence: string }).confidence === 'REJECT').length,
  };
  const totalSeen = latestPerJob.length;
  const stillActive = latestPerJob.filter(
    s => (s as { jobs?: { still_active?: boolean | null } }).jobs?.still_active !== false,
  ).length;
  const qualifying = counts.HIGH + counts.MEDIUM + counts.LOW;

  // Rejection breakdown
  const reasonCounts = new Map<string, number>();
  for (const s of latestPerJob) {
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
        <TopEmployersPanel employers={topEmployers} />
      </div>

      <JobsTable scores={tableScores as never} />
    </div>
  );
}
