// /admin — admin-only operations console for Atlas.
// Same Per Scholas brand language as the dashboard. RLS is the security
// boundary; we also call requireAdmin() so non-admins can't even render.

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { ManualFetchButton } from '@/components/manual-fetch-button';
import { PairManager, type CampusRow, type CampusOption, type RoleOption } from '@/components/pair-manager';
import { ThresholdEditor } from '@/components/threshold-editor';
import { WatchlistEditor } from '@/components/watchlist-editor';

const QUOTA_MONTHLY = 20000;
const QUOTA_BLOCK_RATIO = 0.15;

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireAdmin();
  const supabase = createClient();

  // Active pairs (used for the Manual Fetch buttons up top)
  const { data: campusRoles } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, campuses(name), roles(name)')
    .eq('active', true);

  // ALL pairs (active + inactive) for the pair manager section
  const { data: allPairsRaw } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, active, notes, campuses(name), roles(name)')
    .order('active', { ascending: false })
    .order('campus_id', { ascending: true });

  // Full campus + role lists for the "add new pair" dropdowns
  const [{ data: allCampusesRaw }, { data: allRolesRaw }] = await Promise.all([
    supabase.from('campuses').select('id, name').order('name'),
    supabase.from('roles').select('id, name').order('name'),
  ]);

  // Normalize Supabase's "join could be array or object" shape
  const allPairs: CampusRow[] = ((allPairsRaw as any[]) ?? [])
    .map((r): CampusRow | null => {
      const campus = Array.isArray(r.campuses) ? r.campuses[0] : r.campuses;
      const role = Array.isArray(r.roles) ? r.roles[0] : r.roles;
      if (!campus || !role) return null;
      return {
        campus_id: r.campus_id as string,
        campus_name: campus.name as string,
        role_id: r.role_id as string,
        role_name: role.name as string,
        active: !!r.active,
        notes: typeof r.notes === 'string' ? r.notes : null,
      };
    })
    .filter((p): p is CampusRow => p !== null);

  const allCampuses: CampusOption[] = ((allCampusesRaw as any[]) ?? []).map(c => ({
    id: c.id as string,
    name: c.name as string,
  }));
  const allRoles: RoleOption[] = ((allRolesRaw as any[]) ?? []).map(r => ({
    id: r.id as string,
    name: r.name as string,
  }));

  // Active taxonomies — one per role with at least one active pair. We feed
  // these into the threshold/watchlist editors so the admin can tune the
  // operational knobs on the running configuration.
  const activeRoleIds = Array.from(new Set(allPairs.filter(p => p.active).map(p => p.role_id)));
  const { data: activeTaxonomiesRaw } = activeRoleIds.length
    ? await supabase
        .from('taxonomies')
        .select('id, role_id, version, schema')
        .in('role_id', activeRoleIds)
        .eq('active', true)
    : { data: [] as any[] };
  type TaxonomyEdit = {
    id: string;
    role_id: string;
    role_name: string;
    version: string;
    thresholds: { high: number; medium: number; low: number };
    weight_per_match: number;
    categories: Record<string, { is_healthcare: boolean; employers: string[] }>;
  };
  const taxonomyEdits: TaxonomyEdit[] = ((activeTaxonomiesRaw as any[]) ?? [])
    .map(t => {
      const schema = t.schema as any;
      const role = allRoles.find(r => r.id === t.role_id);
      if (!schema?.scoring?.thresholds || !schema?.employer_watchlist || !role) return null;
      return {
        id: t.id as string,
        role_id: t.role_id as string,
        role_name: role.name,
        version: t.version as string,
        thresholds: schema.scoring.thresholds,
        weight_per_match: schema.employer_watchlist.weight_per_match ?? 5,
        categories: schema.employer_watchlist.categories ?? {},
      };
    })
    .filter((t): t is TaxonomyEdit => t !== null);

  const { data: recentRuns } = await supabase
    .from('fetch_runs')
    .select('id, trigger_type, status, started_at, completed_at, duration_ms, campus_id, role_id, jobs_returned, jobs_new, jobs_marked_inactive, scores_computed, error_message')
    .order('started_at', { ascending: false })
    .limit(20);

  const { data: quota } = await supabase
    .from('api_usage')
    .select('jobs_remaining, requests_remaining, recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: audit } = await supabase
    .from('audit_log')
    .select('id, action, user_email, occurred_at, entity_type, entity_id, metadata')
    .order('occurred_at', { ascending: false })
    .limit(15);

  const jobsRemaining = (quota as { jobs_remaining?: number | null } | null)?.jobs_remaining ?? null;
  const requestsRemaining = (quota as { requests_remaining?: number | null } | null)?.requests_remaining ?? null;
  const quotaRatio = jobsRemaining != null ? jobsRemaining / QUOTA_MONTHLY : null;
  const quotaBlocked = quotaRatio != null && quotaRatio < QUOTA_BLOCK_RATIO;
  const quotaPct = quotaRatio != null ? Math.round(quotaRatio * 100) : null;

  return (
    <main className="min-h-screen bg-white">
      <div className="brand-accent-bar" aria-hidden />

      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-[1400px] mx-auto px-6 py-5 flex items-center justify-between gap-6">
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
                <span className="text-sm text-gray-500">Admin · Operations</span>
              </div>
              <div className="text-xs text-gray-500 mt-1.5">
                Manual fetches, recent runs, RapidAPI quota, audit log.
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-5 text-sm shrink-0">
            <a
              href="/"
              className="text-royal hover:text-navy font-semibold uppercase tracking-wider text-xs"
            >
              Dashboard
            </a>
            <span className="hidden sm:inline text-gray-600">{user.email}</span>
            <a
              href="/auth/signout"
              className="text-gray-500 hover:text-gray-800 uppercase tracking-wider text-xs"
            >
              Sign out
            </a>
          </nav>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-8 space-y-8">
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-md p-5 shadow-sm lg:col-span-2">
            <SectionHeader label="Manual fetch" />
            <p className="text-sm text-gray-600 mb-4 max-w-xl">
              Triggers an immediate RapidAPI fetch and scoring run for active campus×role pairs.
              Throttled at 1 per 24 hours per pair. Refused if quota is below {Math.round(QUOTA_BLOCK_RATIO * 100)}%.
            </p>
            <div className="flex flex-wrap gap-3">
              {(campusRoles as Array<{ campus_id: string; role_id: string; campuses: { name: string }; roles: { name: string } }> | null)?.map(cr => (
                <div key={`${cr.campus_id}-${cr.role_id}`} className="border border-gray-200 rounded-md p-4 min-w-[260px] bg-cloud/40">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                    {cr.campuses?.name} · {cr.roles?.name}
                  </div>
                  <div className="text-xs text-gray-400 mb-3 font-mono">
                    {cr.campus_id} / {cr.role_id}
                  </div>
                  <ManualFetchButton
                    campusId={cr.campus_id}
                    roleId={cr.role_id}
                    disabled={quotaBlocked}
                    disabledHint={quotaBlocked ? 'Blocked: quota below 15%.' : undefined}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-md p-5 shadow-sm">
            <SectionHeader label="RapidAPI quota" />
            {jobsRemaining == null ? (
              <div className="text-sm text-gray-500">No quota snapshot yet — runs once after the first fetch.</div>
            ) : (
              <>
                <div className={`text-4xl font-bold tracking-tight leading-none ${quotaBlocked ? 'text-orange' : 'text-night'}`}>
                  {jobsRemaining.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 mt-1.5">
                  jobs remaining · {quotaPct}% of {QUOTA_MONTHLY.toLocaleString()} monthly
                </div>
                {requestsRemaining != null && (
                  <div className="text-xs text-gray-500 mt-1">
                    {requestsRemaining.toLocaleString()} requests remaining
                  </div>
                )}
                <div className="h-2 bg-gray-100 mt-4 overflow-hidden rounded-sm">
                  <div
                    className={quotaBlocked ? 'bg-orange h-full' : 'bg-royal h-full'}
                    style={{ width: `${Math.max(2, quotaPct ?? 0)}%` }}
                  />
                </div>
                {quotaBlocked && (
                  <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-orange">
                    Below 15% — fetches refused
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-night">Campus × role pairs</h2>
            <span className="text-xs text-gray-400">{allPairs.length} total · {allPairs.filter(p => p.active).length} active</span>
          </div>
          <PairManager pairs={allPairs} allCampuses={allCampuses} allRoles={allRoles} />
        </section>

        {taxonomyEdits.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold text-night">Taxonomy tuning</h2>
              <span className="text-xs text-gray-400">
                {taxonomyEdits.length} active taxonom{taxonomyEdits.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-4 max-w-2xl">
              Edit operational knobs on the active taxonomy for each role. Each save creates a
              new patch version and deactivates the previous one — no redeploy required, but the
              source <code className="text-night">cft.json</code> file in the repo goes out of sync
              until reconciled.
            </p>
            <div className="space-y-5">
              {taxonomyEdits.map(t => (
                <div key={t.id} className="space-y-4">
                  <ThresholdEditor
                    roleId={t.role_id}
                    roleName={t.role_name}
                    taxonomyVersion={t.version}
                    current={t.thresholds}
                  />
                  <WatchlistEditor
                    roleId={t.role_id}
                    roleName={t.role_name}
                    taxonomyVersion={t.version}
                    weightPerMatch={t.weight_per_match}
                    categories={t.categories}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-night">Recent fetch runs</h2>
            <span className="text-xs text-gray-400">last 20</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
            <div className="grid grid-cols-[100px_90px_140px_120px_90px_70px_70px_70px_1fr] gap-3 px-5 py-2.5 border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <div>Trigger</div>
              <div>Status</div>
              <div>Started</div>
              <div>Pair</div>
              <div>Duration</div>
              <div className="text-right">Jobs</div>
              <div className="text-right">New</div>
              <div className="text-right">Scored</div>
              <div>Error</div>
            </div>
            {(recentRuns as RunRow[] | null)?.length ? (
              <ul className="divide-y divide-gray-100">
                {(recentRuns as RunRow[]).map(r => (
                  <li
                    key={r.id}
                    className="grid grid-cols-[100px_90px_140px_120px_90px_70px_70px_70px_1fr] gap-3 px-5 py-2.5 text-sm"
                  >
                    <span className="text-gray-700">{r.trigger_type}</span>
                    <StatusPill status={r.status} />
                    <span className="text-gray-500">{formatTime(r.started_at)}</span>
                    <span className="text-gray-700">
                      {r.campus_id ?? '—'}/{r.role_id ?? '—'}
                    </span>
                    <span className="text-gray-500 tabular-nums">
                      {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </span>
                    <span className="text-night font-medium text-right tabular-nums">
                      {r.jobs_returned ?? 0}
                    </span>
                    <span className="text-royal text-right tabular-nums">
                      {r.jobs_new ?? 0}
                    </span>
                    <span className="text-gray-700 text-right tabular-nums">
                      {r.scores_computed ?? 0}
                    </span>
                    <span className="text-orange truncate text-xs" title={r.error_message ?? ''}>
                      {r.error_message ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-6 text-sm text-gray-500">No fetch runs yet.</div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-night">Audit log</h2>
            <span className="text-xs text-gray-400">last 15</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
            {(audit as AuditRow[] | null)?.length ? (
              <ul className="divide-y divide-gray-100">
                {(audit as AuditRow[]).map(a => (
                  <li key={a.id} className="px-5 py-2.5 text-sm flex items-baseline justify-between gap-4">
                    <span className="text-gray-500 w-[140px] flex-shrink-0">{formatTime(a.occurred_at)}</span>
                    <span className="text-night font-medium">{a.action}</span>
                    <span className="text-gray-500 truncate flex-1">
                      {a.user_email ?? 'system'}
                      {a.entity_id ? ` → ${a.entity_type}/${a.entity_id.slice(0, 8)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-6 text-sm text-gray-500">No audit entries yet.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{label}</h2>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-royal/10 text-royal border-royal/20',
    running: 'bg-yellow/15 text-night border-yellow/30',
    failed:  'bg-orange/10 text-orange border-orange/20',
  };
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded-sm leading-5 ${map[status] ?? 'bg-cloud text-gray-600 border-gray-200'}`}
    >
      {status}
    </span>
  );
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface RunRow {
  id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  campus_id: string | null;
  role_id: string | null;
  jobs_returned: number | null;
  jobs_new: number | null;
  jobs_marked_inactive: number | null;
  scores_computed: number | null;
  error_message: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  user_email: string | null;
  occurred_at: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
}
