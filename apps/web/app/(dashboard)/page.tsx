// Atlas homepage — four-mode landing experience built for Managing Directors.
//
// Mode dispatch is driven by URL search params:
//
//   /                          → Aggregate landing
//                                "What does the overall opportunity landscape
//                                look like across all campuses and roles?"
//
//   /?role=cft                 → Role-first compare
//                                "For this role, which campuses have the
//                                strongest opportunity signal?"
//
//   /?campus=atlanta           → Campus-first compare
//                                "What roles are strongest in my campus
//                                market?"
//
//   /?campus=atlanta&role=cft  → Focused detail (the original dashboard view)
//                                "What specific intelligence do I need to act
//                                on for this campus × role combination?"
//
// Implementation notes:
//   • A single Supabase query pulls all in-window scores joined with
//     job + role metadata. Slicing happens in JS via `lib/home-aggregations`.
//   • The focused mode does a second, richer query so the score-breakdown
//     panel keeps the full chip blocks. Cleaner than reshaping shared rows.
//   • Volume sanity check: ~18 active pairs × ~30 days × ~50 jobs ≈ 27k rows
//     over the window. Per-row payload is small (~10 fields). Acceptable for
//     a server component.

import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { AppShell } from '@/components/layout/app-shell';
import { Header, NavLinks } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

import { HomeFilterBar } from '@/components/home/home-filter-bar';
import { HomeOverview } from '@/components/home/home-overview';
import { DecisionPaths } from '@/components/home/decision-paths';
import { ComparisonTable } from '@/components/home/comparison-table';
import { RoleFirstView } from '@/components/home/role-first-view';
import { CampusFirstView } from '@/components/home/campus-first-view';

import {
  computeOverview,
  buildCampusLeaderboard,
  buildRoleLeaderboard,
  dedupByJobCampus,
  type ScoreWithContext,
} from '@/lib/home-aggregations';

import { FocusedDetailView } from './focused-detail-view';

const WINDOW_DAYS = 30;
export const dynamic = 'force-dynamic';

interface HomePageProps {
  searchParams: { campus?: string; role?: string; confidence?: string };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  // Preserve any URL params (campus / role / confidence) through the login
  // bounce so deep-linked dashboard URLs survive an unauthenticated visit.
  const qs = new URLSearchParams();
  if (searchParams.campus) qs.set('campus', searchParams.campus);
  if (searchParams.role) qs.set('role', searchParams.role);
  if (searchParams.confidence) qs.set('confidence', searchParams.confidence);
  const homePath = qs.toString() ? `/?${qs.toString()}` : '/';

  const user = await requireUser(homePath);
  const supabase = createClient();

  const activeCampusId = searchParams.campus?.trim() || null;
  const activeRoleId = searchParams.role?.trim() || null;

  // ─── Reference lists (campuses + roles + active pairs) ──────────────────
  const [campusesRes, rolesRes, pairsRes] = await Promise.all([
    supabase.from('campuses').select('id, name, address, state, active').order('name'),
    supabase.from('roles').select('id, name, active').order('name'),
    supabase
      .from('campus_roles')
      .select('campus_id, role_id, active')
      .eq('active', true),
  ]);

  const allCampuses = (campusesRes.data ?? []).map(c => ({
    id: c.id as string,
    name: c.name as string,
    address: (c as { address?: string | null }).address ?? null,
    state: (c as { state?: string | null }).state ?? null,
    active: (c as { active?: boolean | null }).active !== false,
  }));
  const allRoles = (rolesRes.data ?? []).map(r => ({
    id: r.id as string,
    name: r.name as string,
    active: (r as { active?: boolean | null }).active !== false,
  }));
  const activePairs = (pairsRes.data ?? []) as Array<{ campus_id: string; role_id: string }>;
  const activeCampusIds = new Set(activePairs.map(p => p.campus_id));
  const activeRoleIds = new Set(activePairs.map(p => p.role_id));

  // Drop inactive campuses/roles from filter bar selectors so MDs only see
  // markets we're actually monitoring. Keep them in `allCampuses` for naming.
  const filterCampuses = allCampuses.filter(c => c.active && activeCampusIds.has(c.id));
  const filterRoles = allRoles.filter(r => r.active && activeRoleIds.has(r.id));

  // ─── Latest successful fetch across all pairs (freshness indicator) ─────
  const { data: latestRunAcross } = await supabase
    .from('fetch_runs')
    .select('completed_at')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastUpdatedISO =
    (latestRunAcross as { completed_at?: string | null } | null)?.completed_at ?? null;

  // ─── Resolve names for the selected filters ─────────────────────────────
  const activeCampus = activeCampusId
    ? allCampuses.find(c => c.id === activeCampusId) ?? null
    : null;
  const activeRole = activeRoleId
    ? allRoles.find(r => r.id === activeRoleId) ?? null
    : null;

  // ─── If both selected → focused detail (existing dashboard) ──────────────
  if (activeCampusId && activeRoleId && activeCampus && activeRole) {
    return (
      <AppShell
        header={
          <Header
            subtitle={
              <span className="text-sm text-gray-500">
                {activeRole.name} · {activeCampus.name}
              </span>
            }
            meta={`Focused detail · ${WINDOW_DAYS}-day window`}
            nav={
              <NavLinks
                email={user.email}
                active="home"
                showAdminLink={user.role === 'admin'}
              />
            }
          />
        }
        subnav={
          <HomeFilterBar
            campuses={filterCampuses}
            roles={filterRoles}
            activeCampusId={activeCampusId}
            activeRoleId={activeRoleId}
          />
        }
        footer={<Footer />}
      >
        <FocusedDetailView
          campusId={activeCampusId}
          campusName={activeCampus.name}
          campusAddress={activeCampus.address}
          roleId={activeRoleId}
          roleName={activeRole.name}
          windowDays={WINDOW_DAYS}
          confidenceFilter={searchParams.confidence?.toUpperCase() ?? null}
        />
      </AppShell>
    );
  }

  // ─── Otherwise pull aggregate scores for the window ─────────────────────
  // Lightweight projection — we only need fields used in tiles + comparison
  // rows. Dedup to latest score per (job_id, campus_id) in JS.
  const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rawScores } = await supabase
    .from('job_scores')
    .select(
      `
        job_id,
        campus_id,
        confidence,
        score,
        scored_at,
        taxonomies:taxonomy_id ( role_id ),
        jobs:job_id ( title, organization, still_active )
      `,
    )
    .gte('scored_at', sinceISO)
    .order('scored_at', { ascending: false });

  type RawScore = {
    job_id: string;
    campus_id: string;
    confidence: string;
    score: number;
    scored_at: string;
    taxonomies: { role_id: string } | { role_id: string }[] | null;
    jobs: { title: string | null; organization: string | null; still_active: boolean | null } | { title: string | null; organization: string | null; still_active: boolean | null }[] | null;
  };

  // Dedup keyed by (job_id, campus_id, role_id) — latest scored_at wins.
  // We already ordered desc, so the first hit per key is the latest.
  //
  // Including role_id in the key matters once more than one role is active
  // on the platform: a job that's been scored under both CFT and LVFT
  // taxonomies for the same campus has two valid latest-scores (one per
  // role's perspective). Without role_id in the key, the most recently
  // rescored taxonomy collapses the other one out — e.g. after a fresh
  // LVFT rescore, almost every job's CFT score disappeared from the
  // homepage's "latest" set, dropping the role count from 2 → 1.
  const seen = new Set<string>();
  const rows: ScoreWithContext[] = [];
  for (const r of (rawScores ?? []) as RawScore[]) {
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
      confidence: r.confidence as ScoreWithContext['confidence'],
      score: r.score,
      scored_at: r.scored_at,
      job_title: jb?.title ?? null,
      organization: jb?.organization ?? null,
      still_active: jb?.still_active ?? null,
      raw: r,
    });
  }

  // Apply mode-specific filtering
  const filteredRows =
    activeRoleId && !activeCampusId
      ? rows.filter(r => r.role_id === activeRoleId)
      : activeCampusId && !activeRoleId
        ? rows.filter(r => r.campus_id === activeCampusId)
        : rows;

  // ─── ROLE-FIRST mode ────────────────────────────────────────────────────
  if (activeRoleId && activeRole && !activeCampusId) {
    const overview = computeOverview(filteredRows);
    const compRows = buildCampusLeaderboard(
      filteredRows,
      filterCampuses.map(c => ({ id: c.id, name: c.name, state: c.state })),
      null,
      cid => `/?campus=${encodeURIComponent(cid)}&role=${encodeURIComponent(activeRoleId)}`,
    );

    // Top titles across all campuses for this role
    const titleCount = new Map<string, number>();
    for (const r of filteredRows) {
      if (r.confidence === 'REJECT' || !r.job_title) continue;
      const t = r.job_title.trim();
      titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
    }
    const topTitles = Array.from(titleCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t);

    return (
      <AppShell
        header={
          <Header
            subtitle={<span className="text-sm text-gray-500">Role · {activeRole.name}</span>}
            meta={`Compare campuses · ${WINDOW_DAYS}-day window`}
            nav={
              <NavLinks
                email={user.email}
                active="home"
                showAdminLink={user.role === 'admin'}
              />
            }
          />
        }
        subnav={
          <HomeFilterBar
            campuses={filterCampuses}
            roles={filterRoles}
            activeCampusId={null}
            activeRoleId={activeRoleId}
          />
        }
        footer={<Footer />}
      >
        <RoleFirstView
          roleId={activeRoleId}
          roleName={activeRole.name}
          windowDays={WINDOW_DAYS}
          totals={{
            records: overview.totalRecords,
            qualifying: overview.qualifyingRecords,
            employers: overview.employerCount,
          }}
          topTitles={topTitles}
          rows={compRows}
        />
      </AppShell>
    );
  }

  // ─── CAMPUS-FIRST mode ──────────────────────────────────────────────────
  if (activeCampusId && activeCampus && !activeRoleId) {
    const overview = computeOverview(filteredRows);

    // Roles for THIS campus only — restrict to active pairs for this campus
    const campusRoleIds = new Set(
      activePairs.filter(p => p.campus_id === activeCampusId).map(p => p.role_id),
    );
    const rolesForCampus = filterRoles.filter(r => campusRoleIds.has(r.id));
    const compRows = buildRoleLeaderboard(
      filteredRows,
      rolesForCampus,
      rid => `/?campus=${encodeURIComponent(activeCampusId)}&role=${encodeURIComponent(rid)}`,
    );

    // Top employers and titles across all roles for this campus
    const employerCount = new Map<string, number>();
    const titleCount = new Map<string, number>();
    for (const r of filteredRows) {
      if (r.confidence === 'REJECT') continue;
      if (r.organization) {
        employerCount.set(r.organization, (employerCount.get(r.organization) ?? 0) + 1);
      }
      if (r.job_title) {
        const t = r.job_title.trim();
        titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
      }
    }
    const topEmployers = Array.from(employerCount.entries()).sort((a, b) => b[1] - a[1]);
    const topTitles = Array.from(titleCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([t]) => t);

    // Last fetch for this campus
    const { data: campusLastFetch } = await supabase
      .from('fetch_runs')
      .select('completed_at')
      .eq('campus_id', activeCampusId)
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastFetchISO =
      (campusLastFetch as { completed_at?: string | null } | null)?.completed_at ?? null;

    return (
      <AppShell
        header={
          <Header
            subtitle={<span className="text-sm text-gray-500">Campus · {activeCampus.name}</span>}
            meta={`Compare roles · ${WINDOW_DAYS}-day window`}
            nav={
              <NavLinks
                email={user.email}
                active="home"
                showAdminLink={user.role === 'admin'}
              />
            }
          />
        }
        subnav={
          <HomeFilterBar
            campuses={filterCampuses}
            roles={filterRoles}
            activeCampusId={activeCampusId}
            activeRoleId={null}
          />
        }
        footer={<Footer />}
      >
        <CampusFirstView
          campusId={activeCampusId}
          campusName={activeCampus.name}
          campusAddress={activeCampus.address}
          windowDays={WINDOW_DAYS}
          totals={{
            records: overview.totalRecords,
            qualifying: overview.qualifyingRecords,
            employers: overview.employerCount,
          }}
          lastFetchISO={lastFetchISO}
          topEmployers={topEmployers}
          topTitles={topTitles}
          rows={compRows}
        />
      </AppShell>
    );
  }

  // ─── AGGREGATE mode (the default landing) ───────────────────────────────
  const overview = computeOverview(rows);
  // Top campuses leaderboard counts unique postings per campus (collapses
  // the per-role duplicates) — same semantic as the overview tile. Top
  // roles uses the un-collapsed set so both roles' counts are visible.
  const aggregateCampusRows = dedupByJobCampus(rows);
  const campusRows = buildCampusLeaderboard(
    aggregateCampusRows,
    filterCampuses.map(c => ({ id: c.id, name: c.name, state: c.state })),
    null,
    cid => `/?campus=${encodeURIComponent(cid)}`,
  );
  const roleRows = buildRoleLeaderboard(
    rows,
    filterRoles,
    rid => `/?role=${encodeURIComponent(rid)}`,
  );

  return (
    <AppShell
      header={
        <Header
          subtitle={
            <span className="text-sm text-gray-500">
              Overview · all campuses · all roles
            </span>
          }
          meta={`${WINDOW_DAYS}-day rolling view${
            lastUpdatedISO ? ` · last fetch ${formatRelative(lastUpdatedISO)}` : ''
          }`}
          nav={
            <NavLinks
              email={user.email}
              active="home"
              showAdminLink={user.role === 'admin'}
            />
          }
        />
      }
      footer={
        <Footer>
          <div className="mb-2 font-semibold uppercase tracking-wider text-gray-700">
            About this view
          </div>
          <p>
            Atlas tracks live job postings against curriculum-derived role taxonomies for every
            active Per Scholas campus. Records reflect the most recent score per unique (job, campus)
            in the last {WINDOW_DAYS} days. Cron cadence: Mon/Wed/Fri at 9am ET. Admins can trigger
            a manual fetch from the Admin panel.
          </p>
        </Footer>
      }
      subnav={
        <HomeFilterBar
          campuses={filterCampuses}
          roles={filterRoles}
          activeCampusId={null}
          activeRoleId={null}
        />
      }
    >
      {/* 1. Headline numbers */}
      <HomeOverview
        totalRecords={overview.totalRecords}
        qualifyingRecords={overview.qualifyingRecords}
        campusCount={overview.campusCount}
        campusTotal={filterCampuses.length}
        roleCount={overview.roleCount}
        roleTotal={filterRoles.length}
        employerCount={overview.employerCount}
        lastUpdatedISO={lastUpdatedISO}
        windowDays={WINDOW_DAYS}
      />

      {/* 2. Two clear next-step paths */}
      <DecisionPaths campuses={filterCampuses} roles={filterRoles} />

      {/* 3. Leaderboards — stacked vertically so columns stay legible at any
          viewport width (no horizontal scrolling on tablets / sub-1280px).
          Roles render first because Managing Directors usually anchor on a
          role before a campus. */}
      <ComparisonTable
        title="Top roles by opportunity volume"
        description="Click any role to compare campus performance for that role."
        rowLabel="Role"
        rows={roleRows}
        ranked
        emptyMessage="No role data in this window yet."
      />
      <ComparisonTable
        title="Top campuses by opportunity volume"
        description="Click any campus to anchor the view on that local labor market."
        rowLabel="Campus"
        rows={campusRows}
        ranked
        emptyMessage="No campus data in this window yet."
      />
    </AppShell>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  const ageMs = Date.now() - d.valueOf();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 1) return 'just now';
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}
