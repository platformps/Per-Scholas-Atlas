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
  loadActivePairs,
  loadActiveTaxonomy,
  scoreResultToRow,
  makeCampusContext,
  type PairRow,
} from '@/lib/scoring-helpers';
import { scoreJob } from '@per-scholas/scoring';

// Vercel route segment config — these calls take longer than the default 10s.
// Pro tier supports up to 60s, hobby is 10s. See BRIEF §2 (Vercel Pro).
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const QUOTA_MONTHLY = 20000;
const QUOTA_BLOCK_RATIO = 0.15;        // BRIEF §3 — refuse below 15% remaining
const MANUAL_THROTTLE_MS = 24 * 60 * 60 * 1000;
const MAX_PER_PAIR = 500;              // pagination cap

// ─────────────────────────────────────────────────────────────────────────────
interface FetchBody {
  trigger_type?: 'scheduled' | 'manual';
  campus_id?: string;
  role_id?: string;
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

  // Service role for all writes; bypasses RLS on the worker-only tables.
  const sb = createServiceClient();

  // ─── Quota guard ─────────────────────────────────────────────────────
  const quotaState = await readLatestQuota(sb);
  if (
    quotaState.jobs_remaining != null &&
    quotaState.jobs_remaining / QUOTA_MONTHLY < QUOTA_BLOCK_RATIO
  ) {
    return NextResponse.json(
      {
        error: 'Quota below 15% — fetch refused.',
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

  const results: PairResult[] = [];
  for (const pair of pairs) {
    results.push(await runPair(sb, pair, triggerType, auth));
  }

  return NextResponse.json({
    trigger_type: triggerType,
    pairs: pairs.length,
    results,
  });
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
async function runPair(
  sb: ReturnType<typeof createServiceClient>,
  pair: PairRow,
  triggerType: 'scheduled' | 'manual',
  auth: Awaited<ReturnType<typeof authorizeAdminOrCron>>,
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
    // RapidAPI fetch
    const { rawJobs, quota } = await fetchAllActiveJobs({
      titleFilter,
      locationFilter,
      pageSize: 100,
      maxTotal: MAX_PER_PAIR,
    });

    // Upsert jobs
    const seenSourceIds = new Set<string>();
    let jobsNew = 0;
    let jobsUpdated = 0;
    const jobIdBySourceId = new Map<string, string>();

    for (const raw of rawJobs) {
      const dbRow = rawJobToDbRow(raw);
      if (!dbRow) continue;
      const sid = dbRow.source_id as string;
      seenSourceIds.add(sid);

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
            description_text: dbRow.description_text ?? null,
            ai_key_skills: dbRow.ai_key_skills ?? null,
            ai_experience_level: dbRow.ai_experience_level ?? null,
            raw_payload: dbRow.raw_payload ?? null,
          })
          .eq('id', id);
        jobIdBySourceId.set(sid, id);
        jobsUpdated++;
      } else {
        const { data: inserted } = await sb
          .from('jobs')
          .insert(dbRow)
          .select('id')
          .single();
        const id = (inserted as { id: string } | null)?.id;
        if (id) jobIdBySourceId.set(sid, id);
        jobsNew++;
      }
    }

    // Reconcile still_active — jobs we had as active but didn't see this run.
    // Only safe to do AFTER we've fetched ALL pages for this pair (we have).
    const { data: activeNow } = await sb
      .from('jobs')
      .select('id, source_id')
      .eq('still_active', true);
    const inactiveIds: string[] = [];
    for (const r of (activeNow as any[]) ?? []) {
      if (!seenSourceIds.has(r.source_id)) inactiveIds.push(r.id);
    }
    let jobsMarkedInactive = 0;
    if (inactiveIds.length > 0) {
      // .in_() chunked to keep URL length sane
      for (let i = 0; i < inactiveIds.length; i += 100) {
        const chunk = inactiveIds.slice(i, i + 100);
        await sb.from('jobs').update({ still_active: false }).in('id', chunk);
      }
      jobsMarkedInactive = inactiveIds.length;
    }

    // Score every job we saw + insert immutable job_scores row
    const campusCtx = makeCampusContext(campus);

    let scoresComputed = 0;
    for (const raw of rawJobs) {
      const payload = normalizeApiJob(raw);
      if (!payload) continue;
      const jobUuid = jobIdBySourceId.get(payload.id);
      if (!jobUuid) continue; // upsert failed; skip
      const result = scoreJob(payload, taxonomy, campusCtx);
      await sb.from('job_scores').insert(scoreResultToRow(result, {
        job_id: jobUuid,
        taxonomy_id: taxonomyRow.id,
        campus_id: campus.id,
        fetch_run_id: fetchRunId,
      }));
      scoresComputed++;
    }

    // Close fetch_run
    await sb
      .from('fetch_runs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        jobs_returned: rawJobs.length,
        jobs_new: jobsNew,
        jobs_updated: jobsUpdated,
        jobs_marked_inactive: jobsMarkedInactive,
        scores_computed: scoresComputed,
        quota_jobs_remaining: quota.jobs_remaining,
        quota_requests_remaining: quota.requests_remaining,
      })
      .eq('id', fetchRunId);

    // Record quota snapshot
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
          jobs_returned: rawJobs.length,
        },
      });
    }

    return {
      campus_id: campus.id,
      role_id: role.id,
      status: 'success',
      fetch_run_id: fetchRunId,
      jobs_returned: rawJobs.length,
      jobs_new: jobsNew,
      jobs_updated: jobsUpdated,
      jobs_marked_inactive: jobsMarkedInactive,
      scores_computed: scoresComputed,
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
