// Atlas dashboard — Per Scholas brand redesign with 30-day cumulative view.
//
// Layout (top to bottom):
//   1. Header (Atlas wordmark + Per Scholas logo + role/campus/last-fetch)
//   2. Pipeline overview — 30-day cumulative stat cards (the new headline)
//   3. Detection trend — fetch-by-fetch confidence breakdown (full width)
//   4. Two-col: Why-jobs-were-filtered | Confidence distribution (30d)
//   5. Two-col: Top Skills (30d) | Top Employers (30d)
//   6. Jobs table — 30d deduped, sorted by score desc
//   7. Footer
//
// Why 30-day cumulative as headline: the latest fetch is sparse (Atlanta CFT
// in any 7-day window has 1–3 entry-level fits). Showing cumulative pipeline
// over 30 days is the correct narrative for stakeholders — "X jobs scanned,
// Y still active, Z passed the qualifying gate" — instead of the misleading
// "0 HIGH, 0 MEDIUM" you'd see on a sparse day.

import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { JobsTable } from '@/components/jobs-table';
import { PipelineStats } from '@/components/pipeline-stats';
import { FetchTrend, type TrendPoint } from '@/components/fetch-trend';
import { RejectionBreakdown, type RawReason } from '@/components/rejection-breakdown';
import {
  TopSkillsPanel,
  TopEmployersPanel,
  ConfidenceDistributionPanel,
} from '@/components/insights-panels';
import { CampusRolePicker, type PairOption } from '@/components/campus-role-picker';
import { AppShell } from '@/components/layout/app-shell';
import { Header, NavLinks } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

const WINDOW_DAYS = 30;

interface DashboardPageProps {
  searchParams: { campus?: string; role?: string; confidence?: string };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const user = await requireUser();
  const supabase = createClient();

  // ─── Active campus_role pair (defaults to first active row) ─────────────
  const { data: campusRoles } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, campuses(*), roles(*)')
    .eq('active', true);

  const activeCampusId = searchParams.campus ?? campusRoles?.[0]?.campus_id ?? 'atlanta';
  const activeRoleId = searchParams.role ?? campusRoles?.[0]?.role_id ?? 'cft';
  const activeCampus = campusRoles?.find(cr => cr.campus_id === activeCampusId)?.campuses as any;
  const activeRole = campusRoles?.find(cr => cr.role_id === activeRoleId)?.roles as any;

  // Picker options — handle both Supabase shapes (single object or array)
  const pairOptions: PairOption[] = ((campusRoles as any[]) ?? [])
    .map(cr => {
      const campus = Array.isArray(cr.campuses) ? cr.campuses[0] : cr.campuses;
      const role = Array.isArray(cr.roles) ? cr.roles[0] : cr.roles;
      if (!campus || !role) return null;
      return {
        campus_id: cr.campus_id as string,
        campus_name: campus.name as string,
        role_id: cr.role_id as string,
        role_name: role.name as string,
      };
    })
    .filter((p): p is PairOption => p !== null);

  // ─── Latest successful fetch (for header timestamp + trend reference) ──
  const { data: latestRun } = await supabase
    .from('fetch_runs')
    .select('id, completed_at, jobs_returned, trigger_type')
    .eq('campus_id', activeCampusId)
    .eq('role_id', activeRoleId)
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ─── 30-day window cutoff ──────────────────────────────────────────────
  const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ─── All score rows in the window for this campus, joined to jobs ──────
  // We dedupe to "latest score per job" in JS below. Doing it here keeps us
  // off raw SQL and tolerates the existing Supabase JS query surface.
  const { data: scoresWindow } = await supabase
    .from('job_scores')
    .select(`
      *,
      jobs:job_id (
        id, source_id, title, organization, url, date_posted,
        cities_derived, regions_derived, ai_salary_min, ai_salary_max,
        description_text, ai_key_skills, ai_experience_level, still_active,
        first_seen_at
      )
    `)
    .eq('campus_id', activeCampusId)
    .gte('scored_at', sinceISO)
    .order('scored_at', { ascending: false });

  type ScoreRow = NonNullable<typeof scoresWindow>[number];

  // Latest score per job_id, ignoring inactive jobs in the window
  const seenJobIds = new Set<string>();
  const latestPerJob: ScoreRow[] = [];
  for (const s of (scoresWindow ?? []) as ScoreRow[]) {
    const jid = (s as any).job_id as string;
    if (seenJobIds.has(jid)) continue;
    seenJobIds.add(jid);
    latestPerJob.push(s);
  }

  // Optional confidence filter (from URL)
  const confidenceFilter = searchParams.confidence?.toUpperCase();
  const tableScoresFiltered = confidenceFilter
    ? latestPerJob.filter(s => (s as any).confidence === confidenceFilter)
    : latestPerJob;
  // JobsTable expects descending score order. We deduped by scored_at, so
  // re-sort by score for display.
  const tableScores = [...tableScoresFiltered].sort(
    (a, b) => ((b as any).score ?? 0) - ((a as any).score ?? 0),
  );

  // ─── Pipeline stats over the window (deduped) ───────────────────────────
  const counts = {
    HIGH: latestPerJob.filter(s => (s as any).confidence === 'HIGH').length,
    MEDIUM: latestPerJob.filter(s => (s as any).confidence === 'MEDIUM').length,
    LOW: latestPerJob.filter(s => (s as any).confidence === 'LOW').length,
    REJECT: latestPerJob.filter(s => (s as any).confidence === 'REJECT').length,
  };
  const totalSeen = latestPerJob.length;
  const stillActive = latestPerJob.filter(s => (s as any).jobs?.still_active !== false).length;
  const qualifying = counts.HIGH + counts.MEDIUM + counts.LOW;

  // ─── Rejection breakdown (deduped over window) ──────────────────────────
  const reasonCounts = new Map<string, number>();
  for (const s of latestPerJob) {
    const sr = s as any;
    if (sr.confidence !== 'REJECT') continue;
    const key = sr.rejection_reason ?? '__below_score_threshold__';
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const rejectionReasons: RawReason[] = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // ─── Trend chart data (per fetch_run; rescores filtered out in component) ─
  const { data: runsWindow } = await supabase
    .from('fetch_runs')
    .select('id, completed_at, trigger_type')
    .eq('campus_id', activeCampusId)
    .eq('role_id', activeRoleId)
    .eq('status', 'success')
    .gte('completed_at', sinceISO)
    .order('completed_at', { ascending: true });

  const trendByRun = new Map<string, { high: number; medium: number; low: number; reject: number }>();
  for (const s of (scoresWindow ?? []) as ScoreRow[]) {
    const fri = (s as any).fetch_run_id as string;
    if (!trendByRun.has(fri)) trendByRun.set(fri, { high: 0, medium: 0, low: 0, reject: 0 });
    const c = trendByRun.get(fri)!;
    const conf = ((s as any).confidence as string).toLowerCase() as 'high' | 'medium' | 'low' | 'reject';
    c[conf]++;
  }
  const trend: TrendPoint[] = ((runsWindow as any[]) ?? []).map(r => ({
    fetchRunId: r.id,
    date: r.completed_at,
    triggerType: r.trigger_type,
    ...(trendByRun.get(r.id) ?? { high: 0, medium: 0, low: 0, reject: 0 }),
  }));

  // ─── Insight panels (top skills / employers) — 30d deduped, qualifying ──
  const skillFreq: Record<string, number> = {};
  latestPerJob
    .filter(s => (s as any).confidence !== 'REJECT')
    .forEach(s => {
      const sr = s as any;
      [...(sr.core_matched as string[] ?? []), ...(sr.specialized_matched as string[] ?? [])].forEach(
        (skill: string) => {
          skillFreq[skill] = (skillFreq[skill] ?? 0) + 1;
        },
      );
    });
  const topSkills = Object.entries(skillFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const empFreq: Record<string, number> = {};
  latestPerJob
    .filter(s => (s as any).confidence !== 'REJECT' && (s as any).jobs?.organization)
    .forEach(s => {
      const org = (s as any).jobs!.organization as string;
      empFreq[org] = (empFreq[org] ?? 0) + 1;
    });
  const topEmployers = Object.entries(empFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const subtitle =
    pairOptions.length > 1 ? (
      <CampusRolePicker
        pairs={pairOptions}
        activeCampusId={activeCampusId}
        activeRoleId={activeRoleId}
      />
    ) : (
      <span className="text-sm text-gray-500">
        {activeRole?.name ?? 'Role'} · {activeCampus?.name ?? 'Campus'}
      </span>
    );

  const meta = (
    <>
      {activeCampus?.address ?? ''}
      {activeCampus?.default_radius_miles
        ? ` · ${activeCampus.default_radius_miles}mi radius`
        : ''}
      {' · '}
      {latestRun
        ? `Last fetch ${new Date((latestRun as any).completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${(latestRun as any).jobs_returned} jobs`
        : 'No fetches yet — cron runs Mon/Wed/Fri 9am ET'}
    </>
  );

  return (
    <AppShell
      header={
        <Header
          subtitle={subtitle}
          meta={meta}
          nav={
            <NavLinks email={user.email} showAdminLink={user.role === 'admin'} />
          }
        />
      }
      footer={
        <Footer>
          <div className="mb-2 font-semibold uppercase tracking-wider text-gray-700">
            Data source
          </div>
          <p>
            Pipeline view shows the most recent score per unique job seen in the last{' '}
            {WINDOW_DAYS} days, scored against the active CFT taxonomy. Jobs sourced from the
            Fantastic Jobs Active Jobs DB (rolling 7-day ATS window). Fetch cadence:
            Mon/Wed/Fri at 9am ET. Admins can trigger a manual fetch from the Admin panel.
          </p>
        </Footer>
      }
    >
      {/* 1. Pipeline overview — 30-day cumulative stats (the headline) */}
      <PipelineStats
        windowDays={WINDOW_DAYS}
        totalSeen={totalSeen}
        stillActive={stillActive}
        qualifying={qualifying}
        counts={counts}
      />

      {/* 2. Detection trend — per-fetch confidence breakdown */}
      <FetchTrend data={trend} windowDays={WINDOW_DAYS} />

      {/* 3. Why-filtered + Confidence distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RejectionBreakdown reasons={rejectionReasons} windowDays={WINDOW_DAYS} />
        <ConfidenceDistributionPanel
          counts={counts}
          total={totalSeen}
          scores={latestPerJob}
        />
      </div>

      {/* 4. Top Skills + Top Employers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopSkillsPanel skills={topSkills} />
        <TopEmployersPanel employers={topEmployers} />
      </div>

      {/* 5. Jobs table — 30-day deduped */}
      <JobsTable scores={tableScores as any} />
    </AppShell>
  );
}
