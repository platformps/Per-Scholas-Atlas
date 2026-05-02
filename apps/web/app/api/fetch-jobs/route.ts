// POST /api/fetch-jobs
//
// Single source of truth for the job fetch + score pipeline (BRIEF §14).
// Two callers:
//   • GitHub Actions cron (Authorization: Bearer <CRON_SECRET>)
//   • Logged-in admin (session cookie)
//
// For each active (campus, role) pair (or a single pair if filtered via the
// request body):
//   1) auth + quota + (manual-only) 24h throttle
//   2) load active taxonomy from DB
//   3) RapidAPI fetch (paginated, post-filtered by haversine via scoring)
//   4) upsert jobs by source_id
//   5) score each via scoreJob() → insert immutable job_scores row
//   6) reconcile still_active for jobs in this campus not in this fetch
//   7) close fetch_run + record quota in api_usage
//   8) audit_log row for manual triggers
//
// All DB writes use the service-role client (jobs / job_scores / fetch_runs /
// api_usage / audit_log have no INSERT policy for `authenticated` — service
// role only).

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { authorizeAdminOrCron } from '@/lib/cron-auth';
import {
  buildTitleFilter,
  buildLocationFilter,
  fetchAllActiveJobs,
  normalizeApiJob,
  rawJobToDbRow,
} from '@/lib/rapidapi';
import {
  buildTheirStackTitleFilter,
  buildTheirStackLocationFilter,
  fetchAllTheirStackJobs,
  normalizeTheirStackJob,
  theirStackJobToDbRow,
  type TheirStackQuotaSnapshot,
} from '@/lib/theirstack';
import type { JobPayload } from '@per-scholas/scoring';
import {
  loadActivePairs,
  loadActiveTaxonomy,
  scoreResultToRow,
  makeCampusContext,
  type PairRow,
} from '@/lib/scoring-helpers';
import { scoreJob } from '@per-scholas/scoring';

// Vercel route segment config — Pro tier supports up to 300s for serverless
// functions. With 18 active pairs running sequentially at ~5s each, the
// cron's worst case is ~90–180s; 300s gives comfortable headroom and
// leaves room for taxonomy/quota work added later.
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const QUOTA_MONTHLY = 20000;
const QUOTA_BLOCK_RATIO = 0.15;        // BRIEF §3 — refuse below 15% remaining
const QUOTA_RESERVE = QUOTA_MONTHLY * QUOTA_BLOCK_RATIO; // = 3000 jobs reserved
const ESTIMATED_JOBS_PER_PAIR = 80;    // empirical; updated as we learn
const MANUAL_THROTTLE_MS = 24 * 60 * 60 * 1000;
const MAX_PER_PAIR = 500;              // pagination cap

// ─────────────────────────────────────────────────────────────────────────────
type SourceId = 'active-jobs-db' | 'theirstack';
const ALL_SOURCES: SourceId[] = ['active-jobs-db', 'theirstack'];

interface FetchBody {
  trigger_type?: 'scheduled' | 'manual';
  campus_id?: string;
  role_id?: string;
  /**
   * Optional whitelist of data sources to exercise on this run. When
   * omitted, all configured sources fire (current default). Used by the
   * cron to do source-cadence splitting:
   *   - Mon: ['active-jobs-db', 'theirstack']  (or omitted — same effect)
   *   - Wed/Fri: ['active-jobs-db']            (TheirStack stays quiet
   *     to conserve Starter-tier credits)
   * Reconcile is source-aware: a run with sources=['active-jobs-db']
   * only marks active-jobs-db-sourced jobs inactive — TheirStack-only
   * postings are left alone so they survive the gap until the next
   * Monday TheirStack pull.
   */
  sources?: SourceId[];
}

interface PairResult {
  campus_id: string;
  role_id: string;
  status: 'success' | 'failed' | 'throttled' | 'no_taxonomy';
  fetch_run_id?: string;
  jobs_returned?: number;
  jobs_new?: number;
  jobs_updated?: number;
  jobs_marked_inactive?: number;
  scores_computed?: number;
  /** Per-source raw counts (pre-dedup). Populated only on success. */
  raw_counts?: Record<string, number>;
  /** Per-source counts in the deduped post-merge result. */
  per_source_counts?: Record<string, number>;
  /** Number of jobs dropped during cross-source URL dedup. */
  deduped_drops?: number;
  /**
   * Sources that errored mid-pair (typically caught inside runPair so the
   * pair as a whole still succeeds with whatever the other source returned).
   * Surfaced to the caller so cron-level reconcile/sweep can EXCLUDE any
   * source that errored on any pair — partial success is not a complete
   * worldview, and reconciling on it would falsely mark live jobs inactive.
   */
  sources_failed?: SourceId[];
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const auth = await authorizeAdminOrCron(request);
  if (auth.kind === 'unauthorized') {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as FetchBody;
  const triggerType: 'scheduled' | 'manual' =
    body.trigger_type === 'manual' ? 'manual' :
    auth.kind === 'cron' ? 'scheduled' : 'manual';

  // ─── Resolve which sources to exercise this run ─────────────────────
  // Each source is gated by ITS OWN env-var presence. Removing a key in
  // Vercel cleanly turns that source off — no code edit, no workflow
  // change. Specifically:
  //   - RAPIDAPI_KEY missing       → Active Jobs DB skipped
  //   - THEIRSTACK_API_KEY missing → TheirStack skipped
  // body.sources whitelist (if any) is then intersected with the
  // configured set so a Monday TheirStack cron firing after the key has
  // been removed gracefully no-ops instead of erroring.
  const configuredSources: SourceId[] = [];
  if (process.env.RAPIDAPI_KEY) configuredSources.push('active-jobs-db');
  if (process.env.THEIRSTACK_API_KEY) configuredSources.push('theirstack');

  // Validate body.sources separately from the configured-set intersection
  // so we can tell the difference between:
  //   (a) "user passed nonsense like ['lvft']"     → 400, surfaces a typo
  //   (b) "user passed a real source not enabled"  → 200 no-op (kill-switch)
  // Conflating them, as we used to, caused a workflow_dispatch with the
  // role name accidentally placed in the sources field to look like a
  // legitimate kill-switch trigger.
  let requestedSources: SourceId[];
  if (Array.isArray(body.sources) && body.sources.length > 0) {
    const valid = body.sources.filter((s): s is SourceId =>
      ALL_SOURCES.includes(s as SourceId),
    );
    const invalid = body.sources.filter(s => !ALL_SOURCES.includes(s as SourceId));
    if (invalid.length > 0 && valid.length === 0) {
      // All entries were unknown — user error, not a kill-switch.
      return NextResponse.json(
        {
          error: 'No valid source names in body.sources.',
          received: body.sources,
          valid_source_names: ALL_SOURCES,
          hint: 'If you meant to filter by role, pass it as body.role_id; sources must be one of the known data feeds.',
        },
        { status: 400 },
      );
    }
    if (invalid.length > 0) {
      // Mixed valid + invalid — proceed with the valid ones but signal the typo
      // in the response. Still legitimate (some valid sources to run).
      console.warn(`[fetch-jobs] body.sources contained unknown entries: ${invalid.join(', ')}`);
    }
    requestedSources = valid;
  } else {
    // No sources specified → exercise everything configured (admin manual
    // fetches, default cron behavior when sources field omitted).
    requestedSources = configuredSources;
  }
  const enabledSources: SourceId[] = requestedSources.filter(s => configuredSources.includes(s));

  // Hard error: nothing is configured at all (both keys missing).
  if (configuredSources.length === 0) {
    return NextResponse.json(
      {
        error: 'No data sources configured. Set RAPIDAPI_KEY and/or THEIRSTACK_API_KEY in environment.',
      },
      { status: 503 },
    );
  }

  // Soft skip: requested sources are valid names but none are currently
  // configured (env keys removed). Typical case: Monday TheirStack cron
  // firing after THEIRSTACK_API_KEY has been removed. We return 200 so the
  // GitHub Actions run stays green — the disabled source's stale data gets
  // cleaned up by the next AJD-cadence cron via the stale-sweeper (see
  // below). This is the "kill TheirStack with one env-var deletion" contract.
  if (enabledSources.length === 0) {
    return NextResponse.json(
      {
        trigger_type: triggerType,
        pairs: 0,
        sources_requested: body.sources ?? null,
        sources_configured: configuredSources,
        sources_exercised: [],
        note: 'No-op: requested sources are not currently configured (likely the source\'s API key was removed). Stale jobs from this source will be swept by the next AJD-cadence cron.',
        results: [],
      },
      { status: 200 },
    );
  }

  // Service role for all writes; bypasses RLS on the worker-only tables.
  const sb = createServiceClient();

  // ─── Reactive + predictive quota guards (Active Jobs DB only) ───────
  // The api_usage table tracks the AJD/RapidAPI monthly job quota.
  // TheirStack uses a separate credit budget and is tracked per-fetch
  // in fetch_runs.query_params.theirstack_credits_remaining, not in
  // api_usage. So both quota checks below ONLY apply when AJD is being
  // exercised this run. Without this gate, a low AJD quota (e.g. late
  // in the month) would 429 a Monday TheirStack-only cron and stale
  // out the entire TheirStack pipeline. Verified after pre-flight
  // audit found this exact failure mode.
  const ajdEnabled = enabledSources.includes('active-jobs-db');
  const quotaState = ajdEnabled
    ? await readLatestQuota(sb)
    : { jobs_remaining: null, requests_remaining: null };

  if (
    ajdEnabled &&
    quotaState.jobs_remaining != null &&
    quotaState.jobs_remaining / QUOTA_MONTHLY < QUOTA_BLOCK_RATIO
  ) {
    return NextResponse.json(
      {
        error: 'Active Jobs DB quota below 15% — fetch refused.',
        quota: quotaState,
      },
      { status: 429 },
    );
  }

  // ─── Pair selection ──────────────────────────────────────────────────
  const pairs = await loadActivePairs(sb, body.campus_id, body.role_id);
  if (pairs.length === 0) {
    return NextResponse.json(
      { error: 'No active campus_role pairs match the filter.', filter: body },
      { status: 404 },
    );
  }

  // Predictive guard: refuse up front if running every active pair would
  // push AJD remaining below the 15% reserve. Avoids the "started OK,
  // ended in overage" failure mode at full multi-pair scale. Same
  // AJD-only gating — not applied to TheirStack-only runs.
  if (ajdEnabled && quotaState.jobs_remaining != null) {
    const estimatedBurn = pairs.length * ESTIMATED_JOBS_PER_PAIR;
    const wouldRemain = quotaState.jobs_remaining - estimatedBurn;
    if (wouldRemain < QUOTA_RESERVE) {
      return NextResponse.json(
        {
          error: `Active Jobs DB quota safety: estimated burn of ${estimatedBurn} jobs across ${pairs.length} pair${pairs.length === 1 ? '' : 's'} would leave ${wouldRemain} (< ${QUOTA_RESERVE} reserve). Refused.`,
          quota: quotaState,
          pairs: pairs.length,
          estimated_burn: estimatedBurn,
        },
        { status: 429 },
      );
    }
  }

  // Shared accumulator: union of source_ids seen across every successful
  // pair in this cron invocation. Used by the parent-level still_active
  // reconciliation that runs ONCE after all pairs complete (not per-pair —
  // per-pair reconciliation cross-thrashes campuses at multi-pair scale
  // by marking other campuses' jobs inactive on each pair iteration).
  const allSeenSourceIds = new Set<string>();

  const results: PairResult[] = [];
  for (const pair of pairs) {
    results.push(await runPair(sb, pair, triggerType, auth, allSeenSourceIds, enabledSources));
  }

  // ─── Source-aware still_active reconciliation ──────────────────────
  // Only safe when every pair succeeded AND we fetched the full active
  // set (no campus_id / role_id filter). Reasons we skip otherwise:
  //
  //   1. Failure: a partial picture would mark missing-but-not-actually-
  //      missing jobs inactive. Next successful cron will reconcile.
  //   2. Filter: an LVFT-only multi-fetch's seen-set has no CFT
  //      source_ids, so the union-based reconcile would mark every
  //      CFT job inactive. Discovered 2026-04-28 after a manual
  //      role_id=lvft multi-fetch flipped all 1,174 CFT pairs to
  //      still_active=false; the next CFT fetch refreshed only the
  //      jobs that re-appeared in that fetch. Reconcile is a global
  //      operation so it can only run on a global fetch.
  //
  // Source-aware: when this run only exercised a SUBSET of sources
  // (e.g. Wed/Fri Active-Jobs-DB-only run), we ONLY reconcile jobs
  // whose `source` column is in `enabledSources`. TheirStack-only
  // postings are left alone until the next Monday TheirStack pull
  // refreshes their last_seen_at — otherwise an Active-Jobs-DB-only
  // run would flip every TheirStack-sourced job inactive.
  let jobsMarkedInactiveTotal = 0;
  const filtered = Boolean(body.campus_id || body.role_id);
  const allSucceeded = results.length > 0 && results.every(r => r.status === 'success');

  // Sources that errored on at least one pair this run. A source with even
  // a single mid-pair failure does NOT have a complete worldview, so we
  // exclude it from reconcile + sweep this run — otherwise jobs from the
  // pairs that errored would get falsely marked inactive on the next run.
  // Discovered in pre-flight audit: TheirStack 401 on bad key would error
  // on every pair, but each pair caught the error and returned 'success'
  // with an empty TheirStack contribution. The cron-level reconcile then
  // saw an empty TheirStack seen-set and would have flipped EVERY
  // TheirStack-sourced job to still_active=false.
  const sourcesWithErrors = new Set<SourceId>();
  for (const r of results) {
    if (r.sources_failed) {
      for (const s of r.sources_failed) sourcesWithErrors.add(s);
    }
  }
  const trustySources = enabledSources.filter(s => !sourcesWithErrors.has(s));

  const reconcileEligible =
    allSucceeded && !filtered && allSeenSourceIds.size > 0 && trustySources.length > 0;
  if (reconcileEligible) {
    jobsMarkedInactiveTotal = await reconcileStillActive(sb, allSeenSourceIds, trustySources);
  }

  // ─── Stale-sweep for sources NOT exercised this run ─────────────────
  // Runs on every successful scheduled cron (skipped on manual/filtered
  // runs to avoid surprising global side-effects from a per-pair fetch).
  // Catches jobs whose source has been silent for > STALE_THRESHOLD —
  // typically because that source has been disabled (e.g. THEIRSTACK_API_KEY
  // removed). Without this, TheirStack-sourced postings would stay
  // still_active=true forever once the source goes dark, polluting the
  // qualifying-jobs leaderboard with months-old listings.
  //
  // Threshold: 14 days = one full TheirStack cadence (Mondays) plus
  // a 7-day buffer for one missed Monday cron. Active Jobs DB at MWF
  // never approaches 14 days between refreshes when healthy; if it does,
  // those jobs ARE genuinely stale and should be swept.
  //
  // Dormancy is computed against `trustySources` (NOT `enabledSources`):
  // if TheirStack errored mid-run we treat it as "didn't truly exercise"
  // and the next AJD-only cron will sweep dormant TheirStack jobs the
  // same way it sweeps a properly-disabled source.
  let staleSwept = 0;
  if (triggerType === 'scheduled' && allSucceeded && !filtered) {
    const dormantSources = ALL_SOURCES.filter(s => !trustySources.includes(s));
    if (dormantSources.length > 0) {
      staleSwept = await sweepStaleFromDormantSources(sb, dormantSources);
    }
  }

  return NextResponse.json({
    trigger_type: triggerType,
    pairs: pairs.length,
    sources_requested: body.sources ?? null,
    sources_configured: configuredSources,
    sources_exercised: enabledSources,
    sources_with_errors: Array.from(sourcesWithErrors),
    sources_trusty_for_reconcile: trustySources,
    jobs_marked_inactive: jobsMarkedInactiveTotal,
    stale_swept_from_dormant_sources: staleSwept,
    reconciliation_skipped: !reconcileEligible,
    reconciliation_skip_reason: reconcileEligible
      ? null
      : !allSucceeded
        ? 'one_or_more_pairs_failed'
        : filtered
          ? 'filtered_fetch'
          : allSeenSourceIds.size === 0
            ? 'empty_seen_set'
            : 'all_sources_had_errors',
    results,
  });
}

/**
 * Marks still_active=false for jobs whose `source` is in `dormantSources`
 * AND whose last_seen_at is older than STALE_THRESHOLD_DAYS. Used to
 * clean up after a source goes dark (key removed from env, vendor
 * outage, etc.) without losing the ability to bring the source back —
 * the historical job rows stay in `jobs` and `job_scores` untouched;
 * only the `still_active` flag is updated.
 */
async function sweepStaleFromDormantSources(
  sb: ReturnType<typeof createServiceClient>,
  dormantSources: SourceId[],
): Promise<number> {
  const STALE_THRESHOLD_DAYS = 14;
  const cutoffIso = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await sb
    .from('jobs')
    .select('id')
    .eq('still_active', true)
    .in('source', dormantSources)
    .lt('last_seen_at', cutoffIso);
  if (!stale || stale.length === 0) return 0;
  const ids = (stale as Array<{ id: string }>).map(r => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await sb.from('jobs').update({ still_active: false }).in('id', chunk);
  }
  return ids.length;
}

// Union-based still_active reconciliation. Runs at the END of a cron
// invocation, after every pair has had a chance to refresh last_seen_at on
// jobs it saw. Marks any still_active=true job whose source_id wasn't seen
// by ANY pair in this run as inactive. Independent of campus scoping —
// `still_active` is a global "is this job still listed in the API" flag,
// not a per-pair concept.
async function reconcileStillActive(
  sb: ReturnType<typeof createServiceClient>,
  seenSourceIds: Set<string>,
  sourcesExercised: SourceId[],
): Promise<number> {
  // Only reconcile jobs from sources we actually pulled this run.
  // E.g. a Wed/Fri ['active-jobs-db']-only run skips TheirStack-sourced
  // jobs; their last_seen_at gets refreshed on the next Monday run.
  const { data: activeNow } = await sb
    .from('jobs')
    .select('id, source_id, source')
    .eq('still_active', true)
    .in('source', sourcesExercised);
  if (!activeNow) return 0;
  const inactiveIds: string[] = [];
  for (const r of activeNow as Array<{ id: string; source_id: string; source: string }>) {
    if (!seenSourceIds.has(r.source_id)) inactiveIds.push(r.id);
  }
  if (inactiveIds.length === 0) return 0;
  for (let i = 0; i < inactiveIds.length; i += 100) {
    const chunk = inactiveIds.slice(i, i + 100);
    await sb.from('jobs').update({ still_active: false }).in('id', chunk);
  }
  return inactiveIds.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (route-local; the cross-route ones live in @/lib/scoring-helpers)
// ─────────────────────────────────────────────────────────────────────────────

async function readLatestQuota(sb: ReturnType<typeof createServiceClient>) {
  const { data } = await sb
    .from('api_usage')
    .select('jobs_remaining, requests_remaining, recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    jobs_remaining: (data as any)?.jobs_remaining ?? null,
    requests_remaining: (data as any)?.requests_remaining ?? null,
  } as { jobs_remaining: number | null; requests_remaining: number | null };
}

/**
 * Manual-only throttle: refuse a manual fetch if any manual run for this
 * (campus, role) completed in the last 24h. Scheduled cron is exempt.
 */
async function checkManualThrottle(
  sb: ReturnType<typeof createServiceClient>,
  campusId: string,
  roleId: string,
): Promise<{ throttled: boolean; nextAllowedAt?: string }> {
  const since = new Date(Date.now() - MANUAL_THROTTLE_MS).toISOString();
  const { data } = await sb
    .from('fetch_runs')
    .select('started_at')
    .eq('campus_id', campusId)
    .eq('role_id', roleId)
    .eq('trigger_type', 'manual')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1);
  const last = (data as any[])?.[0];
  if (!last) return { throttled: false };
  const nextAllowedAt = new Date(new Date(last.started_at).getTime() + MANUAL_THROTTLE_MS).toISOString();
  return { throttled: true, nextAllowedAt };
}

// ─── Per-pair pipeline ──────────────────────────────────────────────────
//
// The `allSeenSourceIds` parameter is the cron-level accumulator. Each
// successful pair adds the source_ids it saw — the parent reconciler then
// uses the union to mark globally-vanished jobs inactive once at the end.
// Per-pair reconciliation was removed because at multi-pair scale it
// cross-thrashes campuses (each pair would mark other campuses' jobs
// inactive on its iteration).
async function runPair(
  sb: ReturnType<typeof createServiceClient>,
  pair: PairRow,
  triggerType: 'scheduled' | 'manual',
  auth: Awaited<ReturnType<typeof authorizeAdminOrCron>>,
  allSeenSourceIds: Set<string>,
  enabledSources: SourceId[],
): Promise<PairResult> {
  const { campus, role } = pair;

  if (triggerType === 'manual') {
    const t = await checkManualThrottle(sb, campus.id, role.id);
    if (t.throttled) {
      return {
        campus_id: campus.id,
        role_id: role.id,
        status: 'throttled',
        error: `Manual fetch throttled until ${t.nextAllowedAt}`,
      };
    }
  }

  const taxonomyRow = await loadActiveTaxonomy(sb, role.id);
  if (!taxonomyRow) {
    return {
      campus_id: campus.id,
      role_id: role.id,
      status: 'no_taxonomy',
      error: `No active taxonomy seeded for role '${role.id}'`,
    };
  }
  const taxonomy = taxonomyRow.schema;

  const titleFilter = buildTitleFilter(taxonomy);
  const locationFilter = buildLocationFilter(campus);

  // Open fetch_run
  const triggeredBy = auth.kind === 'admin' ? auth.user.id : null;
  const startedAt = Date.now();
  const { data: runIns, error: runErr } = await sb
    .from('fetch_runs')
    .insert({
      trigger_type: triggerType,
      triggered_by: triggeredBy,
      campus_id: campus.id,
      role_id: role.id,
      status: 'running',
      query_params: { title_filter: titleFilter, location_filter: locationFilter },
    })
    .select('id')
    .single();
  if (runErr || !runIns) {
    return { campus_id: campus.id, role_id: role.id, status: 'failed', error: `Could not open fetch_run: ${runErr?.message}` };
  }
  const fetchRunId = (runIns as { id: string }).id;

  try {
    // ─── Fan out across enabled data sources ────────────────────────
    //
    // Each source returns its own raw shape; we normalize per-source
    // into the unified JobPayload + DB-row form. The shared collection
    // lets us dedupe by URL across sources and run a single upsert +
    // score pass downstream — Active Jobs DB jobs and TheirStack jobs
    // get the same scoring + storage treatment.
    //
    // Active Jobs DB always runs (RAPIDAPI_KEY required for the project
    // to be operational). TheirStack runs only when its API key is set,
    // so the source can be turned on/off via Vercel env without code.
    interface SourcedJob {
      raw: unknown;
      payload: JobPayload | null;
      dbRow: Record<string, unknown> | null;
      source: 'active-jobs-db' | 'theirstack';
    }
    const collected: SourcedJob[] = [];
    const sourcesAttempted: string[] = [];
    const sourcesFailed: { source: string; error: string }[] = [];

    // ── Source 1: Active Jobs DB ──
    let ajdJobs: unknown[] = [];
    let quota: { jobs_remaining: number | null; requests_remaining: number | null } = {
      jobs_remaining: null,
      requests_remaining: null,
    };
    if (enabledSources.includes('active-jobs-db')) {
      sourcesAttempted.push('active-jobs-db');
      const ajdResp = await fetchAllActiveJobs({
        titleFilter,
        locationFilter,
        pageSize: 100,
        maxTotal: MAX_PER_PAIR,
      });
      ajdJobs = ajdResp.rawJobs;
      quota = ajdResp.quota;
      for (const raw of ajdJobs) {
        collected.push({
          raw,
          payload: normalizeApiJob(raw),
          dbRow: rawJobToDbRow(raw),
          source: 'active-jobs-db',
        });
      }
    }

    // ── Source 2: TheirStack (only if requested AND env var is set) ──
    let theirStackQuota: TheirStackQuotaSnapshot = { api_credits_remaining: null };
    let theirStackRawCount = 0;
    const theirStackKey = process.env.THEIRSTACK_API_KEY;
    if (enabledSources.includes('theirstack') && theirStackKey) {
      sourcesAttempted.push('theirstack');
      try {
        const { rawJobs: tsJobs, quota: tsQuota } = await fetchAllTheirStackJobs({
          titlePhrases: buildTheirStackTitleFilter(taxonomy),
          locationPattern: buildTheirStackLocationFilter(campus),
          pageSize: 100,
          maxTotal: MAX_PER_PAIR,
          apiKey: theirStackKey,
        });
        theirStackQuota = tsQuota;
        theirStackRawCount = tsJobs.length;
        for (const raw of tsJobs) {
          collected.push({
            raw,
            payload: normalizeTheirStackJob(raw),
            dbRow: theirStackJobToDbRow(raw),
            source: 'theirstack',
          });
        }
      } catch (e) {
        // Don't fail the whole pair if TheirStack errors — log it and
        // continue with Active Jobs DB results only. The pair is still
        // considered successful so the cron-level reconcile can proceed.
        const msg = e instanceof Error ? e.message : 'unknown';
        sourcesFailed.push({ source: 'theirstack', error: msg });
        console.error(`[fetch-jobs] TheirStack failed for ${campus.id}/${role.id}: ${msg}`);
      }
    }

    // ─── Cross-source dedup by URL ──────────────────────────────────
    //
    // The same posting can appear in both sources (especially when
    // TheirStack picks up an Indeed mirror of an ATS post that Active
    // Jobs DB also crawls). First source wins — Active Jobs DB always
    // iterates first, so a posting in both is tagged 'active-jobs-db'.
    // Net effect: TheirStack adds the genuinely-new postings (small/mid
    // contractors, direct-Indeed posts) without duplicating ATS jobs.
    const seenUrls = new Set<string>();
    const deduped: SourcedJob[] = [];
    let dedupedCount = 0;
    for (const j of collected) {
      const url = j.payload?.url;
      if (url) {
        const norm = url.trim().toLowerCase();
        if (seenUrls.has(norm)) {
          dedupedCount++;
          continue;
        }
        seenUrls.add(norm);
      }
      deduped.push(j);
    }

    // Per-source counts in the deduped (post-merge) result. Useful for
    // /admin/qa to confirm each source is contributing.
    const perSourceCounts: Record<string, number> = {};
    for (const j of deduped) {
      perSourceCounts[j.source] = (perSourceCounts[j.source] ?? 0) + 1;
    }

    // ─── Upsert all deduped jobs ────────────────────────────────────
    let jobsNew = 0;
    let jobsUpdated = 0;
    const jobIdBySourceId = new Map<string, string>();

    for (const j of deduped) {
      if (!j.dbRow) continue;
      const sid = j.dbRow.source_id as string;
      allSeenSourceIds.add(sid);

      const { data: existing } = await sb
        .from('jobs')
        .select('id')
        .eq('source_id', sid)
        .limit(1)
        .maybeSingle();

      if (existing && (existing as any).id) {
        const id = (existing as any).id as string;
        await sb
          .from('jobs')
          .update({
            last_seen_at: new Date().toISOString(),
            still_active: true,
            description_text: j.dbRow.description_text ?? null,
            ai_key_skills: j.dbRow.ai_key_skills ?? null,
            ai_experience_level: j.dbRow.ai_experience_level ?? null,
            raw_payload: j.dbRow.raw_payload ?? null,
          })
          .eq('id', id);
        jobIdBySourceId.set(sid, id);
        jobsUpdated++;
      } else {
        const { data: inserted } = await sb
          .from('jobs')
          .insert(j.dbRow)
          .select('id')
          .single();
        const id = (inserted as { id: string } | null)?.id;
        if (id) jobIdBySourceId.set(sid, id);
        jobsNew++;
      }
    }

    // ─── Score all deduped jobs ─────────────────────────────────────
    const campusCtx = makeCampusContext(campus);

    let scoresComputed = 0;
    for (const j of deduped) {
      if (!j.payload) continue;
      const jobUuid = jobIdBySourceId.get(j.payload.id);
      if (!jobUuid) continue; // upsert failed; skip
      const result = scoreJob(j.payload, taxonomy, campusCtx);
      await sb.from('job_scores').insert(scoreResultToRow(result, {
        job_id: jobUuid,
        taxonomy_id: taxonomyRow.id,
        campus_id: campus.id,
        fetch_run_id: fetchRunId,
      }));
      scoresComputed++;
    }

    const totalRawJobs = ajdJobs.length + theirStackRawCount;

    // Close fetch_run. `jobs_marked_inactive` is now reconciled at the
    // cron level (after all pairs run) — per-pair is always 0 because
    // any single pair only sees its own slice of the world.
    //
    // jobs_returned reflects the deduped post-merge count, which is
    // what we actually scored. The pre-dedup raw counts go into
    // query_params for forensic visibility.
    await sb
      .from('fetch_runs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        jobs_returned: deduped.length,
        jobs_new: jobsNew,
        jobs_updated: jobsUpdated,
        jobs_marked_inactive: 0,
        scores_computed: scoresComputed,
        quota_jobs_remaining: quota.jobs_remaining,
        quota_requests_remaining: quota.requests_remaining,
        query_params: {
          title_filter: titleFilter,
          location_filter: locationFilter,
          sources_attempted: sourcesAttempted,
          sources_failed: sourcesFailed,
          per_source_counts: perSourceCounts,
          raw_counts: {
            'active-jobs-db': ajdJobs.length,
            theirstack: theirStackRawCount,
          },
          deduped_drops: dedupedCount,
          theirstack_credits_remaining: theirStackQuota.api_credits_remaining,
        },
      })
      .eq('id', fetchRunId);

    // Record Active Jobs DB quota snapshot. TheirStack quota lives in
    // query_params above — the api_usage table is shaped around the
    // RapidAPI quota model and we don't want to retrofit it for a second
    // pricing structure (TheirStack uses credits, not requests/jobs).
    await sb.from('api_usage').insert({
      jobs_remaining: quota.jobs_remaining,
      requests_remaining: quota.requests_remaining,
      jobs_used_this_month:
        quota.jobs_remaining != null ? QUOTA_MONTHLY - quota.jobs_remaining : null,
      requests_used_this_month:
        quota.requests_remaining != null ? QUOTA_MONTHLY - quota.requests_remaining : null,
    });

    // Audit log for manual triggers
    if (triggerType === 'manual' && auth.kind === 'admin') {
      await sb.from('audit_log').insert({
        user_id: auth.user.id,
        user_email: auth.user.email,
        action: 'fetch.manual',
        entity_type: 'fetch_run',
        entity_id: fetchRunId,
        metadata: {
          campus_id: campus.id,
          role_id: role.id,
          jobs_returned: deduped.length,
          per_source_counts: perSourceCounts,
        },
      });
    }

    return {
      campus_id: campus.id,
      role_id: role.id,
      status: 'success',
      fetch_run_id: fetchRunId,
      jobs_returned: deduped.length,
      jobs_new: jobsNew,
      jobs_updated: jobsUpdated,
      jobs_marked_inactive: 0, // reconciled at cron level after all pairs
      scores_computed: scoresComputed,
      raw_counts: {
        'active-jobs-db': ajdJobs.length,
        theirstack: theirStackRawCount,
      },
      per_source_counts: perSourceCounts,
      deduped_drops: dedupedCount,
      sources_failed: sourcesFailed
        .map(f => f.source)
        .filter((s): s is SourceId => ALL_SOURCES.includes(s as SourceId)),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb
      .from('fetch_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        error_message: message,
      })
      .eq('id', fetchRunId);
    return {
      campus_id: campus.id,
      role_id: role.id,
      status: 'failed',
      fetch_run_id: fetchRunId,
      error: message,
    };
  }
}

// scoreResultToRow + makeCampusContext + loadActivePairs + loadActiveTaxonomy
// all live in @/lib/scoring-helpers and are shared with /api/rescore.
