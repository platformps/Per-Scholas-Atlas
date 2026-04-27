// /admin — admin-only page. RLS is the actual security boundary
// (api_usage_select_admin and audit_log_select_admin are admin-only); we
// also run requireAdmin() at the top so non-admins get redirected to /
// before they can even see "permission denied" empty rows.

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { ManualFetchButton } from '@/components/manual-fetch-button';

const QUOTA_MONTHLY = 20000;
const QUOTA_BLOCK_RATIO = 0.15;

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireAdmin();
  const supabase = createClient();

  // Active campus_role pairs (same source the dashboard uses)
  const { data: campusRoles } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, campuses(name), roles(name)')
    .eq('active', true);

  // Recent fetch_runs (last 20)
  const { data: recentRuns } = await supabase
    .from('fetch_runs')
    .select('id, trigger_type, status, started_at, completed_at, duration_ms, campus_id, role_id, jobs_returned, jobs_new, jobs_marked_inactive, scores_computed, error_message')
    .order('started_at', { ascending: false })
    .limit(20);

  // Latest quota snapshot
  const { data: quota } = await supabase
    .from('api_usage')
    .select('jobs_remaining, requests_remaining, recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Recent audit log (last 15)
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
    <main className="min-h-screen">
      <header className="border-b border-zinc-900 bg-black/40 sticky top-0 z-10 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-semibold tracking-tight text-zinc-100">CFT.ATL · Admin</h1>
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                Operations
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-0.5 font-mono">
              Manual fetches, recent runs, quota, audit log.
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <a href="/" className="text-zinc-500 hover:text-zinc-300 uppercase tracking-widest">
              Dashboard
            </a>
            <span className="text-zinc-500">{user.email}</span>
            <a href="/auth/signout" className="text-zinc-500 hover:text-zinc-300 uppercase tracking-widest">
              Sign out
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        {/* Quota + actions row */}
        <section className="grid grid-cols-3 gap-3">
          <div className="border border-zinc-800 bg-zinc-950/40 p-4 col-span-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
              Manual fetch
            </div>
            <p className="text-xs text-zinc-400 mb-3">
              Triggers an immediate RapidAPI fetch + score for active campus×role pairs.
              Throttled at 1 per 24 hours per pair. Refused if quota is below {Math.round(QUOTA_BLOCK_RATIO * 100)}%.
            </p>
            <div className="flex flex-wrap gap-2">
              {(campusRoles as Array<{ campus_id: string; role_id: string; campuses: { name: string }; roles: { name: string } }> | null)?.map(cr => (
                <div key={`${cr.campus_id}-${cr.role_id}`} className="border border-zinc-800 bg-zinc-950/60 p-3 min-w-[280px]">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
                    {cr.campuses?.name} · {cr.roles?.name}
                  </div>
                  <div className="text-[10px] font-mono text-zinc-600 mb-2">
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

          <div className="border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
              RapidAPI quota
            </div>
            {jobsRemaining == null ? (
              <div className="text-xs text-zinc-500 font-mono">No quota snapshot yet — runs once after first fetch.</div>
            ) : (
              <>
                <div className={`text-3xl font-light tracking-tight ${quotaBlocked ? 'text-orange-300' : 'text-zinc-100'}`}>
                  {jobsRemaining.toLocaleString()}
                  <span className="text-zinc-600 text-base ml-1">jobs</span>
                </div>
                <div className="text-xs text-zinc-500 mt-1 font-mono">
                  {quotaPct}% of {QUOTA_MONTHLY.toLocaleString()} monthly
                  {requestsRemaining != null && (
                    <>
                      {' · '}
                      {requestsRemaining.toLocaleString()} requests
                    </>
                  )}
                </div>
                <div className="h-1.5 bg-zinc-900 mt-3 overflow-hidden">
                  <div
                    className={quotaBlocked ? 'bg-orange-500/60 h-full' : 'bg-emerald-500/40 h-full'}
                    style={{ width: `${Math.max(2, quotaPct ?? 0)}%` }}
                  />
                </div>
                {quotaBlocked && (
                  <div className="mt-2 text-[10px] font-mono text-orange-300 uppercase tracking-widest">
                    Below 15% — fetches refused
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Recent runs */}
        <section>
          <SectionHeader label="Recent fetch runs" hint="last 20" />
          <div className="border border-zinc-800 bg-zinc-950/40">
            <div className="grid grid-cols-[100px_90px_140px_90px_90px_70px_70px_70px_1fr] gap-3 px-4 py-2 border-b border-zinc-900 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
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
              <ul className="divide-y divide-zinc-900">
                {(recentRuns as RunRow[]).map(r => (
                  <li
                    key={r.id}
                    className="grid grid-cols-[100px_90px_140px_90px_90px_70px_70px_70px_1fr] gap-3 px-4 py-2 text-xs"
                  >
                    <span className="font-mono text-zinc-300">{r.trigger_type}</span>
                    <StatusPill status={r.status} />
                    <span className="font-mono text-zinc-500">{formatTime(r.started_at)}</span>
                    <span className="font-mono text-zinc-400">
                      {r.campus_id ?? '—'}/{r.role_id ?? '—'}
                    </span>
                    <span className="font-mono text-zinc-500 tabular-nums">
                      {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </span>
                    <span className="font-mono text-zinc-300 text-right tabular-nums">
                      {r.jobs_returned ?? 0}
                    </span>
                    <span className="font-mono text-emerald-400 text-right tabular-nums">
                      {r.jobs_new ?? 0}
                    </span>
                    <span className="font-mono text-zinc-300 text-right tabular-nums">
                      {r.scores_computed ?? 0}
                    </span>
                    <span className="font-mono text-orange-300 truncate" title={r.error_message ?? ''}>
                      {r.error_message ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-xs text-zinc-500 font-mono">No fetch runs yet.</div>
            )}
          </div>
        </section>

        {/* Audit log */}
        <section>
          <SectionHeader label="Audit log" hint="last 15" />
          <div className="border border-zinc-800 bg-zinc-950/40">
            {(audit as AuditRow[] | null)?.length ? (
              <ul className="divide-y divide-zinc-900">
                {(audit as AuditRow[]).map(a => (
                  <li key={a.id} className="px-4 py-2 text-xs flex items-baseline justify-between gap-4">
                    <span className="font-mono text-zinc-500 w-[140px] flex-shrink-0">{formatTime(a.occurred_at)}</span>
                    <span className="font-mono text-zinc-300">{a.action}</span>
                    <span className="font-mono text-zinc-500 truncate flex-1">
                      {a.user_email ?? 'system'}
                      {a.entity_id ? ` → ${a.entity_type}/${a.entity_id.slice(0, 8)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-xs text-zinc-500 font-mono">No audit entries yet.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h2 className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{label}</h2>
      {hint && <span className="text-[10px] font-mono text-zinc-600">{hint}</span>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'border-emerald-700 text-emerald-300 bg-emerald-950/30',
    running: 'border-amber-700 text-amber-300 bg-amber-950/30',
    failed:  'border-orange-700 text-orange-300 bg-orange-950/30',
  };
  return (
    <span
      className={`inline-block border px-1.5 py-0 text-[10px] font-mono uppercase tracking-widest leading-5 ${map[status] ?? 'border-zinc-800 text-zinc-500'}`}
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

// ─── Local row types (server-rendered, permissive) ─────────────────────
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
