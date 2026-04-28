// Atlas dashboard — Per Scholas brand redesign.
// Light surface, navy/royal/orange used per brand book. The header carries
// the Atlas wordmark with Per Scholas attribution above it. Stat cards,
// insight panels, and the jobs table are arranged in three vertical bands
// with generous negative space.

import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { JobsTable } from '@/components/jobs-table';
import { StatCards } from '@/components/stat-cards';
import { TopSkillsPanel, TopEmployersPanel, ConfidenceDistributionPanel } from '@/components/insights-panels';

interface DashboardPageProps {
  searchParams: { campus?: string; role?: string; confidence?: string };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: campusRoles } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, campuses(*), roles(*)')
    .eq('active', true);

  const activeCampusId = searchParams.campus ?? campusRoles?.[0]?.campus_id ?? 'atlanta';
  const activeRoleId = searchParams.role ?? campusRoles?.[0]?.role_id ?? 'cft';
  const activeCampus = campusRoles?.find(cr => cr.campus_id === activeCampusId)?.campuses as any;
  const activeRole = campusRoles?.find(cr => cr.role_id === activeRoleId)?.roles as any;

  const { data: latestRun } = await supabase
    .from('fetch_runs')
    .select('*')
    .eq('campus_id', activeCampusId)
    .eq('role_id', activeRoleId)
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const { data: scoresRaw } = await supabase
    .from('job_scores')
    .select(`
      *,
      jobs:job_id (
        id, source_id, title, organization, url, date_posted,
        cities_derived, regions_derived, ai_salary_min, ai_salary_max,
        description_text, ai_key_skills, ai_experience_level, still_active
      )
    `)
    .eq('campus_id', activeCampusId)
    .eq('fetch_run_id', latestRun?.id ?? '00000000-0000-0000-0000-000000000000')
    .order('score', { ascending: false });

  const scores = (scoresRaw ?? []).filter(s => s.jobs?.still_active !== false);

  const counts = {
    HIGH: scores.filter(s => s.confidence === 'HIGH').length,
    MEDIUM: scores.filter(s => s.confidence === 'MEDIUM').length,
    LOW: scores.filter(s => s.confidence === 'LOW').length,
    REJECT: scores.filter(s => s.confidence === 'REJECT').length,
  };
  const total = scores.length;
  const qualifying = counts.HIGH + counts.MEDIUM + counts.LOW;

  const skillFreq: Record<string, number> = {};
  scores.filter(s => s.confidence !== 'REJECT').forEach(s => {
    [...(s.core_matched as string[] ?? []), ...(s.specialized_matched as string[] ?? [])].forEach(skill => {
      skillFreq[skill] = (skillFreq[skill] ?? 0) + 1;
    });
  });
  const topSkills = Object.entries(skillFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const empFreq: Record<string, number> = {};
  scores.filter(s => s.confidence !== 'REJECT' && s.jobs?.organization).forEach(s => {
    const org = s.jobs!.organization!;
    empFreq[org] = (empFreq[org] ?? 0) + 1;
  });
  const topEmployers = Object.entries(empFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const withSalary = scores.filter(s => s.confidence !== 'REJECT' && s.jobs?.ai_salary_min);
  const avgSalaryMin = withSalary.length
    ? withSalary.reduce((acc, s) => acc + (s.jobs!.ai_salary_min ?? 0), 0) / withSalary.length
    : 0;
  const avgSalaryMax = withSalary.length
    ? withSalary.reduce((acc, s) => acc + (s.jobs!.ai_salary_max ?? 0), 0) / withSalary.length
    : 0;

  return (
    <main className="min-h-screen bg-white">
      <div className="brand-accent-bar" aria-hidden />

      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-[1600px] mx-auto px-6 py-5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-5 min-w-0">
            {/* Per Scholas 30th Anniversary horizontal logo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/per-scholas-logo.png"
              alt="Per Scholas"
              className="h-10 w-auto shrink-0"
            />
            <div className="h-10 w-px bg-gray-200 shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight text-night leading-none">Atlas</h1>
                <span className="text-sm text-gray-500">
                  {activeRole?.name ?? 'Role'} · {activeCampus?.name ?? 'Campus'}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1.5">
                {activeCampus?.address ?? ''}
                {activeCampus?.default_radius_miles
                  ? ` · ${activeCampus.default_radius_miles}mi radius`
                  : ''}
                {' · '}
                {latestRun
                  ? `Last fetch ${new Date(latestRun.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${latestRun.jobs_returned} jobs`
                  : 'No fetches yet — cron runs Mon/Wed/Fri 9am ET'}
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-5 text-sm shrink-0">
            <span className="hidden sm:inline text-gray-600">{user.email}</span>
            {user.role === 'admin' && (
              <a
                href="/admin"
                className="text-royal hover:text-navy font-semibold uppercase tracking-wider text-xs"
              >
                Admin
              </a>
            )}
            <a
              href="/auth/signout"
              className="text-gray-500 hover:text-gray-800 uppercase tracking-wider text-xs"
            >
              Sign out
            </a>
          </nav>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-8 space-y-6">
        <StatCards
          total={total}
          qualifying={qualifying}
          counts={counts}
          avgSalaryMin={avgSalaryMin}
          avgSalaryMax={avgSalaryMax}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TopSkillsPanel skills={topSkills} />
          <TopEmployersPanel employers={topEmployers} />
          <ConfidenceDistributionPanel counts={counts} total={total} scores={scores} />
        </div>

        <JobsTable scores={scores} />

        <footer className="pt-8 border-t border-gray-200 text-xs text-gray-500 leading-relaxed">
          <div className="mb-2 font-semibold uppercase tracking-wider text-gray-700">Data source</div>
          <p>
            Scores computed against the active CFT taxonomy. Jobs sourced from the Fantastic Jobs
            Active Jobs DB (rolling 7-day ATS window). Fetch cadence: Mon/Wed/Fri at 9am ET.
            Admins can trigger a manual fetch from the Admin panel.
          </p>
          <p className="mt-3 text-gray-400">
            Atlas is a Per Scholas internal tool · v1 · Atlanta · Critical Facilities Technician
          </p>
        </footer>
      </div>
    </main>
  );
}
