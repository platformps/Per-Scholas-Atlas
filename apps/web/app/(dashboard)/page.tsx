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

  // Get active campus_roles
  const { data: campusRoles } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, campuses(*), roles(*)')
    .eq('active', true);

  const activeCampusId = searchParams.campus ?? campusRoles?.[0]?.campus_id ?? 'atlanta';
  const activeRoleId = searchParams.role ?? campusRoles?.[0]?.role_id ?? 'cft';
  const activeCampus = campusRoles?.find(cr => cr.campus_id === activeCampusId)?.campuses as any;
  const activeRole = campusRoles?.find(cr => cr.role_id === activeRoleId)?.roles as any;

  // Latest fetch run for this campus+role
  const { data: latestRun } = await supabase
    .from('fetch_runs')
    .select('*')
    .eq('campus_id', activeCampusId)
    .eq('role_id', activeRoleId)
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  // Most recent score per job (latest scored_at) for this campus
  // Using a window function via raw SQL for accuracy; here a simpler approximation via recent fetch_run
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

  // Counts
  const counts = {
    HIGH: scores.filter(s => s.confidence === 'HIGH').length,
    MEDIUM: scores.filter(s => s.confidence === 'MEDIUM').length,
    LOW: scores.filter(s => s.confidence === 'LOW').length,
    REJECT: scores.filter(s => s.confidence === 'REJECT').length,
  };
  const total = scores.length;
  const qualifying = counts.HIGH + counts.MEDIUM + counts.LOW;

  // Top skills (from non-reject)
  const skillFreq: Record<string, number> = {};
  scores.filter(s => s.confidence !== 'REJECT').forEach(s => {
    [...(s.core_matched as string[] ?? []), ...(s.specialized_matched as string[] ?? [])].forEach(skill => {
      skillFreq[skill] = (skillFreq[skill] ?? 0) + 1;
    });
  });
  const topSkills = Object.entries(skillFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Top employers
  const empFreq: Record<string, number> = {};
  scores.filter(s => s.confidence !== 'REJECT' && s.jobs?.organization).forEach(s => {
    const org = s.jobs!.organization!;
    empFreq[org] = (empFreq[org] ?? 0) + 1;
  });
  const topEmployers = Object.entries(empFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Avg salary (qualifying only)
  const withSalary = scores.filter(s => s.confidence !== 'REJECT' && s.jobs?.ai_salary_min);
  const avgSalaryMin = withSalary.length
    ? withSalary.reduce((acc, s) => acc + (s.jobs!.ai_salary_min ?? 0), 0) / withSalary.length
    : 0;
  const avgSalaryMax = withSalary.length
    ? withSalary.reduce((acc, s) => acc + (s.jobs!.ai_salary_max ?? 0), 0) / withSalary.length
    : 0;

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-zinc-900 bg-black/40 sticky top-0 z-10 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-semibold tracking-tight text-zinc-100">CFT.ATL</h1>
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                {activeRole?.name ?? 'Role'} · {activeCampus?.name ?? 'Campus'} · v1
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-0.5 font-mono">
              {activeCampus?.address} · {activeCampus?.default_radius_miles}mi radius ·{' '}
              {latestRun
                ? `Last fetch: ${new Date(latestRun.completed_at).toLocaleDateString()} (${latestRun.jobs_returned} jobs)`
                : 'No fetches yet — scheduled cron runs Mon 6am ET'}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-zinc-500">{user.email}</span>
            {user.role === 'admin' && (
              <a href="/admin" className="text-emerald-400 hover:text-emerald-300 uppercase tracking-widest">
                Admin
              </a>
            )}
            <a href="/auth/signout" className="text-zinc-500 hover:text-zinc-300 uppercase tracking-widest">
              Sign out
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <StatCards
          total={total}
          qualifying={qualifying}
          counts={counts}
          avgSalaryMin={avgSalaryMin}
          avgSalaryMax={avgSalaryMax}
        />

        <div className="grid grid-cols-3 gap-3 my-6">
          <TopSkillsPanel skills={topSkills} />
          <TopEmployersPanel employers={topEmployers} />
          <ConfidenceDistributionPanel counts={counts} total={total} scores={scores} />
        </div>

        <JobsTable scores={scores} />

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-zinc-900 text-[10px] font-mono text-zinc-600 leading-relaxed">
          <div className="mb-2 text-zinc-400 uppercase tracking-widest">Data Source</div>
          <div>
            Scores computed against active taxonomy v{(latestRun as any)?.taxonomy_version ?? '?'}.
            Jobs sourced from Fantastic Jobs Active Jobs DB API (last 7-day window).
            Fetch cadence: weekly (Monday 6am ET). To refresh manually, an admin can trigger a fetch from the Admin panel.
          </div>
        </div>
      </div>
    </main>
  );
}
