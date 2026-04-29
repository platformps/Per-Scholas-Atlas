// /admin — admin-only operations console for Atlas.
// Same Per Scholas brand language as the dashboard. RLS is the security
// boundary; we also call requireAdmin() so non-admins can't even render.

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { PairManager, type CampusRow, type CampusOption, type RoleOption } from '@/components/pair-manager';
import { ManualFetchSection, type RoleGroup } from '@/components/manual-fetch-section';
import { ThresholdEditor } from '@/components/threshold-editor';
import { WatchlistEditor } from '@/components/watchlist-editor';
import { AppShell } from '@/components/layout/app-shell';
import { Header, NavLinks } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const QUOTA_MONTHLY = 20000;
const QUOTA_BLOCK_RATIO = 0.15;

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireAdmin('/admin');
  const supabase = createClient();

  // Active pairs grouped by role for the redesigned manual fetch section
  const { data: activePairsRaw } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, campuses(id, name), roles(id, name)')
    .eq('active', true);

  // Last successful real fetch per (campus, role) — exclude rescores; they're
  // not "new market data" and showing a rescore as the "last fetch" would be
  // misleading. Pull all and dedupe in JS (Supabase JS doesn't expose
  // DISTINCT ON cleanly).
  const { data: allFetchRunsRaw } = await supabase
    .from('fetch_runs')
    .select('campus_id, role_id, completed_at, trigger_type, status')
    .eq('status', 'success')
    .in('trigger_type', ['scheduled', 'manual'])
    .order('completed_at', { ascending: false });

  type LastFetch = { at: string; trigger_type: 'scheduled' | 'manual' };
  const lastFetchByPair = new Map<string, LastFetch>();
  for (const r of (allFetchRunsRaw as any[]) ?? []) {
    if (!r.campus_id || !r.role_id || !r.completed_at) continue;
    const key = `${r.campus_id}:${r.role_id}`;
    if (!lastFetchByPair.has(key)) {
      lastFetchByPair.set(key, {
        at: r.completed_at as string,
        trigger_type: r.trigger_type as 'scheduled' | 'manual',
      });
    }
  }

  // Group active pairs by role
  const roleMap = new Map<string, RoleGroup>();
  for (const p of (activePairsRaw as any[]) ?? []) {
    const role = Array.isArray(p.roles) ? p.roles[0] : p.roles;
    const campus = Array.isArray(p.campuses) ? p.campuses[0] : p.campuses;
    if (!role || !campus) continue;
    if (!roleMap.has(role.id)) {
      roleMap.set(role.id, { role_id: role.id, role_name: role.name, campuses: [] });
    }
    roleMap.get(role.id)!.campuses.push({
      campus_id: campus.id,
      campus_name: campus.name,
      last_fetch: lastFetchByPair.get(`${campus.id}:${role.id}`) ?? null,
    });
  }
  // Sort campuses alphabetically within each role
  for (const g of roleMap.values()) {
    g.campuses.sort((a, b) => a.campus_name.localeCompare(b.campus_name));
  }
  const roleGroups: RoleGroup[] = Array.from(roleMap.values()).sort((a, b) =>
    a.role_name.localeCompare(b.role_name),
  );

  // ALL pairs (active + inactive) for the pair manager section. We pull
  // campus.active too so the UI can disable scheduling on inactive campuses
  // (e.g. Tampa) without leaving them invisible.
  const { data: allPairsRaw } = await supabase
    .from('campus_roles')
    .select('campus_id, role_id, active, notes, campuses(name, active), roles(name)')
    .order('active', { ascending: false })
    .order('campus_id', { ascending: true });

  // Full campus + role lists for the "add new pair" dropdowns
  const [{ data: allCampusesRaw }, { data: allRolesRaw }] = await Promise.all([
    supabase.from('campuses').select('id, name, active').order('name'),
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
        campus_active: campus.active !== false, // default true if missing
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
    active: c.active !== false,
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

  // Last successful SCHEDULED fetch — that's the cron heartbeat. Manual
  // fetches don't count because admins might not run them on a cadence.
  const { data: lastCronRunRaw } = await supabase
    .from('fetch_runs')
    .select('completed_at')
    .eq('trigger_type', 'scheduled')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastCronISO =
    (lastCronRunRaw as { completed_at?: string | null } | null)?.completed_at ?? null;

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
    .limit(50);

  // Build name lookups so the audit log can render "Newark × LVFT" instead
  // of opaque slugs. Names already loaded above; just index for O(1).
  const campusNameById = new Map(allCampuses.map(c => [c.id, c.name]));
  const roleNameById = new Map(allRoles.map(r => [r.id, r.name]));

  const jobsRemaining = (quota as { jobs_remaining?: number | null } | null)?.jobs_remaining ?? null;
  const requestsRemaining = (quota as { requests_remaining?: number | null } | null)?.requests_remaining ?? null;
  const quotaRatio = jobsRemaining != null ? jobsRemaining / QUOTA_MONTHLY : null;
  const quotaBlocked = quotaRatio != null && quotaRatio < QUOTA_BLOCK_RATIO;
  const quotaPct = quotaRatio != null ? Math.round(quotaRatio * 100) : null;

  return (
    <AppShell
      header={
        <Header
          subtitle={<span className="text-sm text-gray-500">Admin · Operations</span>}
          meta="Manual fetches, recent runs, Job API quota, audit log."
          nav={
            <NavLinks
              email={user.email}
              active="admin"
              showAdminLink
              pinnedCampusId={user.homeCampusId}
            />
          }
        />
      }
      footer={<Footer />}
    >
      {/* Cron heartbeat — most-recent successful scheduled fetch with a
          warning chip if it's been >36h. Lets an admin spot a stalled cron
          before someone notices the homepage is going stale. */}
      <CronFreshness lastCronISO={lastCronISO} />

      {/* Brief orientation strip — gives a first-time admin a 3-second read
          on what each section below is for. Sits above the manual-fetch
          area which is the most-used admin tool. */}
      <Card>
        <div className="p-5 sm:p-6">
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <Badge tone="navy" variant="soft" size="sm">Admin orientation</Badge>
            <span className="text-[11px] text-gray-400">
              Read once, then it's all muscle memory.
            </span>
          </div>
          <ul className="text-sm text-gray-700 space-y-1.5 leading-relaxed list-disc pl-5 marker:text-gray-300">
            <li>
              <strong>Manual fetch</strong> — kick off an out-of-cycle Job API run for a
              single campus, a whole role, or every active pair. Most admins won't need
              this often; the cron handles the regular cadence.
            </li>
            <li>
              <strong>Campus × role pairs</strong> — turn monitoring on or off for a
              campus &times; role combination. Activating a pair adds it to the next
              cron run; deactivating preserves history but stops new fetches.
            </li>
            <li>
              <strong>Taxonomy tuning</strong> — adjust HIGH / MEDIUM / LOW thresholds
              and the employer watchlist for each active role. Saving creates a new
              taxonomy version; older scores stay pinned to the version they ran under.
            </li>
            <li>
              <strong>Recent fetch runs &amp; audit log</strong> — verify the cron is
              healthy and see who did what. If a run failed, the error message lives in
              the right-most column.
            </li>
            <li>
              <strong><a href="/admin/qa" className="text-royal hover:text-navy underline-offset-2 hover:underline">QA dashboard</a></strong> —
              cross-surface metric consistency check. Re-runs the homepage's data path
              against an independent ground truth and flags any mismatch in red.
            </li>
            <li>
              <strong><a href="/admin/taxonomies/diff" className="text-royal hover:text-navy underline-offset-2 hover:underline">Taxonomy diff</a></strong> —
              compare any two taxonomy versions for a role and see exactly which phrases,
              thresholds, or watchlist entries changed. Useful for answering &quot;what
              actually changed in v1.1.4?&quot; without grepping commits.
            </li>
          </ul>
          <p className="text-xs text-gray-500 mt-3">
            New here? See <a href="/faq" className="text-royal hover:text-navy underline-offset-2 hover:underline">FAQ</a> for the
            full mental model — taxonomy structure, how scoring works, and what the
            schedule looks like.
          </p>
        </div>
      </Card>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div>
            <SectionHeader label="Manual fetch" />
            <p className="text-sm text-gray-600 mt-1 mb-4 max-w-xl">
              Triggers an immediate Job API fetch and scoring run. Per-campus throttled at 1 per
              24 hours. Refused if quota is below {Math.round(QUOTA_BLOCK_RATIO * 100)}%. The
              "Fetch all" button on each role triggers all of its active campuses in one call.
            </p>
          </div>
          <ManualFetchSection
            roles={roleGroups}
            quotaBlocked={quotaBlocked}
            quotaHint={quotaBlocked ? 'Blocked: quota below 15%.' : undefined}
          />
        </div>

        <Card>
          <div className="p-6">
            <SectionHeader label="Job API quota" />
            {jobsRemaining == null ? (
              <div className="text-sm text-gray-500">
                No quota snapshot yet — runs once after the first fetch.
              </div>
            ) : (
              <>
                <div
                  className={`text-4xl font-bold tracking-tight leading-none ${quotaBlocked ? 'text-orange' : 'text-night'}`}
                >
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
        </Card>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-night">Campus × role pairs</h2>
          <span className="text-xs text-gray-400">
            {allPairs.length} total · {allPairs.filter(p => p.active).length} active
          </span>
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
        <Card>
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[100px_90px_140px_120px_90px_70px_70px_70px_1fr] gap-3 px-6 py-2.5 border-b border-gray-200 bg-cloud text-[11px] font-semibold uppercase tracking-wider text-gray-700 min-w-[900px]">
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
              <ul className="divide-y divide-gray-100 min-w-[900px]">
                {(recentRuns as RunRow[]).map(r => (
                  <li
                    key={r.id}
                    className="grid grid-cols-[100px_90px_140px_120px_90px_70px_70px_70px_1fr] gap-3 px-6 py-2.5 text-sm"
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
                    <span
                      className="text-orange truncate text-xs"
                      title={r.error_message ?? ''}
                    >
                      {r.error_message ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-6 py-6 text-sm text-gray-500">No fetch runs yet.</div>
            )}
          </div>
        </Card>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-night">Activity log</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Who triggered what fetch / rescore / pair toggle. Useful for new
              admins to see what senior admins are doing — read the log for a
              week and the workflow patterns become obvious.
            </p>
          </div>
          <span className="text-xs text-gray-400 shrink-0">last 50</span>
        </div>
        <Card>
          {(audit as AuditRow[] | null)?.length ? (
            <ul className="divide-y divide-gray-100">
              {(audit as AuditRow[]).map(a => (
                <ActivityLogRow
                  key={a.id}
                  entry={a}
                  campusNameById={campusNameById}
                  roleNameById={roleNameById}
                />
              ))}
            </ul>
          ) : (
            <div className="px-6 py-6 text-sm text-gray-500">No audit entries yet.</div>
          )}
        </Card>
      </section>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{label}</h2>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Parameters<typeof Badge>[0]['tone'] =
    status === 'success' ? 'royal' :
    status === 'running' ? 'yellow' :
    status === 'failed'  ? 'orange' :
                           'gray';
  return (
    <Badge tone={tone} variant="soft" size="sm">
      {status}
    </Badge>
  );
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Cron freshness banner ──────────────────────────────────────────────────
//
// Renders a single-row card at the top of the admin page showing:
//   • Last successful scheduled fetch (relative + absolute)
//   • Next scheduled run (Mon/Wed/Fri 9am ET)
//   • Orange warning chip if it's been >36h since the last successful cron
//
// 36h is the threshold because the longest gap in a healthy MWF cadence is
// Friday → Monday (~72h). But in practice we expect the cron to fire within
// 24h of the last (Mon→Wed and Wed→Fri are both 48h). 36h represents "we've
// missed at least one expected slot" — a reasonable point to alert.
//
// Definition of "scheduled": fetch_runs.trigger_type='scheduled' (the cron
// path). Manual fetches don't count toward heartbeat — admins might not run
// them on a cadence and we shouldn't paper over a stalled cron with manual
// work.
const CRON_STALE_HOURS = 36;
// Cron schedule: Mon/Wed/Fri at 9am ET. In Date-of-week terms: 1, 3, 5.
const CRON_DAYS_OF_WEEK = [1, 3, 5];

function CronFreshness({ lastCronISO }: { lastCronISO: string | null }) {
  const now = new Date();
  const last = lastCronISO ? new Date(lastCronISO) : null;
  const ageHours = last ? (now.valueOf() - last.valueOf()) / 36e5 : null;
  const stale = ageHours == null || ageHours > CRON_STALE_HOURS;
  const next = nextCronET(now);

  return (
    <Card>
      <div className="px-5 sm:px-6 py-3.5 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge tone={stale ? 'orange' : 'royal'} variant="soft" size="sm">
            {stale ? 'Cron stale' : 'Cron healthy'}
          </Badge>
          <span className="text-sm text-gray-700">
            Last successful cron:{' '}
            <span className="font-semibold text-night">
              {last ? formatRelativeHours(ageHours!) : 'never'}
            </span>
            {last && (
              <span className="text-gray-400 ml-1.5">({formatTime(lastCronISO)})</span>
            )}
          </span>
        </div>
        <span className="text-xs text-gray-600">
          Next scheduled: <span className="text-night font-medium">{formatNextCron(next)}</span>
        </span>
      </div>
      {stale && (
        <div className="border-t border-orange/20 bg-orange/[0.04] px-5 sm:px-6 py-2.5">
          <p className="text-xs text-orange leading-relaxed">
            The scheduled fetch hasn&apos;t completed in the expected window.
            Check the GitHub Actions cron job (<code>weekly-fetch.yml</code>) and
            the most recent run on the <strong>Recent fetch runs</strong> table
            below for an error message. Trigger a manual unfiltered fetch to
            unblock if the cron itself is healthy but the last attempt failed.
          </p>
        </div>
      )}
    </Card>
  );
}

function formatRelativeHours(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes}m ago`;
  }
  if (hours < 36) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Compute the next Mon/Wed/Fri 9am in America/New_York. We iterate one day
// at a time from `now` and check the day-of-week + hour in ET.
function nextCronET(from: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  // Start scanning from `from` rounded forward; we step in 1h increments
  // (cheap; max 168 iterations for a worst-case full week).
  for (let h = 0; h < 24 * 8; h++) {
    const probe = new Date(from.valueOf() + h * 3600_000);
    const parts = fmt.formatToParts(probe);
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const dow = dayMap[weekday];
    if (dow !== undefined && CRON_DAYS_OF_WEEK.includes(dow) && hour === 9 && probe > from) {
      return probe;
    }
  }
  // Should never hit; return a sentinel.
  return new Date(from.valueOf() + 24 * 3600_000);
}

function formatNextCron(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
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

// ─── Activity log row ───────────────────────────────────────────────────────
//
// Renders one audit_log entry in human-readable form:
//   [Manual fetch]  Sara · Newark × LVFT · 60 jobs · 3h ago
//
// Looks up campus/role names from id maps passed in by the parent (already
// loaded server-side; no extra round-trip). Falls back to the raw slug if
// a campus/role has been deleted.
const ACTION_LABELS: Record<string, { label: string; tone: 'royal' | 'navy' | 'ocean' | 'gray' | 'yellow' }> = {
  'fetch.manual':       { label: 'Manual fetch',         tone: 'royal' },
  'fetch.scheduled':    { label: 'Scheduled fetch',      tone: 'navy' },
  'rescore':            { label: 'Rescore',              tone: 'ocean' },
  'campus_role.update': { label: 'Pair toggled',         tone: 'gray' },
  'taxonomy.save':      { label: 'Taxonomy saved',       tone: 'yellow' },
};

function ActivityLogRow({
  entry,
  campusNameById,
  roleNameById,
}: {
  entry: AuditRow;
  campusNameById: Map<string, string>;
  roleNameById: Map<string, string>;
}) {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const campusId = typeof meta.campus_id === 'string' ? meta.campus_id : null;
  const roleId = typeof meta.role_id === 'string' ? meta.role_id : null;
  const jobsScored = typeof meta.jobs_scored === 'number' ? meta.jobs_scored : null;
  const jobsReturned = typeof meta.jobs_returned === 'number' ? meta.jobs_returned : null;
  const active = typeof meta.active === 'boolean' ? meta.active : null;
  const taxonomyVersion = typeof meta.taxonomy_version === 'string' ? meta.taxonomy_version : null;

  const actionInfo = ACTION_LABELS[entry.action] ?? { label: entry.action, tone: 'gray' as const };
  const campusName = campusId ? (campusNameById.get(campusId) ?? campusId) : null;
  const roleName = roleId ? (roleNameById.get(roleId) ?? roleId) : null;

  // Build a "target" string describing what the action was applied to.
  let target: string | null = null;
  if (campusName && roleName) target = `${campusName} × ${roleName}`;
  else if (campusName) target = campusName;
  else if (roleName) target = roleName;

  // Build a "result" tail with the salient metric for that action.
  const resultParts: string[] = [];
  if (entry.action === 'fetch.manual' && jobsReturned != null) {
    resultParts.push(`${jobsReturned} job${jobsReturned === 1 ? '' : 's'}`);
  } else if (entry.action === 'rescore' && jobsScored != null) {
    resultParts.push(`${jobsScored} rescored`);
  } else if (entry.action === 'campus_role.update' && active != null) {
    resultParts.push(active ? 'activated' : 'deactivated');
  } else if (entry.action === 'taxonomy.save' && taxonomyVersion) {
    resultParts.push(`v${taxonomyVersion}`);
  }
  const result = resultParts.join(' · ');

  return (
    <li className="px-6 py-2.5 text-sm flex items-baseline gap-3 flex-wrap">
      <Badge tone={actionInfo.tone} variant="soft" size="sm">
        {actionInfo.label}
      </Badge>
      <span className="text-gray-700 truncate min-w-0">
        {entry.user_email ?? 'system'}
      </span>
      {target && (
        <>
          <span className="text-gray-300">·</span>
          <span className="text-night font-medium">{target}</span>
        </>
      )}
      {result && (
        <>
          <span className="text-gray-300">·</span>
          <span className="text-gray-600">{result}</span>
        </>
      )}
      <span
        className="text-xs text-gray-400 ml-auto shrink-0"
        title={formatTime(entry.occurred_at)}
      >
        {formatRelativeTime(entry.occurred_at)}
      </span>
    </li>
  );
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  const ageMs = Date.now() - d.valueOf();
  const ageMin = ageMs / 60_000;
  if (ageMin < 1) return 'just now';
  if (ageMin < 60) return `${Math.round(ageMin)}m ago`;
  const ageHours = ageMin / 60;
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
  const ageDays = ageHours / 24;
  if (ageDays < 30) return `${Math.round(ageDays)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
