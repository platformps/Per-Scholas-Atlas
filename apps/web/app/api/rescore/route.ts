// POST /api/rescore
//
// Admin-only. Re-runs scoring against the current active taxonomy for jobs
// already in the DB — no RapidAPI call, no quota spend.
//
// For each active (campus, role) pair (or a single pair if filtered via the
// request body):
//   1) auth (admin or cron — note: cron is allowed too so a future automation
//      could trigger rescores after a taxonomy bump; today the UI button is
//      the primary caller)
//   2) load active taxonomy from DB
//   3) open a fetch_run with trigger_type='rescore' (no API counters touched)
//   4) load all jobs (default: still_active=true; pass include_inactive=true
//      in the body to widen)
//   5) score each via scoreJob() → batch-insert immutable job_scores rows
//   6) close fetch_run
//   7) audit_log row

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { authorizeAdminOrCron } from '@/lib/cron-auth';
import {
  loadActivePairs,
  loadActiveTaxonomy,
  scoreResultToRow,
  makeCampusContext,
  jobsRowToPayload,
  type PairRow,
} from '@/lib/scoring-helpers';
import { scoreJob } from '@per-scholas/scoring';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;          // per-insert batch for job_scores
const MAX_JOBS_PER_PAIR = 5000;  // safety cap; v1 nowhere near this

interface RescoreBody {
  campus_id?: string;
  role_id?: string;
  include_inactive?: boolean;
}

interface PairResult {
  campus_id: string;
  role_id: string;
  status: 'success' | 'failed' | 'no_taxonomy' | 'no_jobs';
  fetch_run_id?: string;
  jobs_scored?: number;
  error?: string;
}

export async function POST(request: Request) {
  const auth = await authorizeAdminOrCron(request);
  if (auth.kind === 'unauthorized') {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as RescoreBody;
  const sb = createServiceClient();

  const pairs = await loadActivePairs(sb, body.campus_id, body.role_id);
  if (pairs.length === 0) {
    return NextResponse.json(
      { error: 'No active campus_role pairs match the filter.', filter: body },
      { status: 404 },
    );
  }

  const results: PairResult[] = [];
  for (const pair of pairs) {
    results.push(await runPair(sb, pair, body, auth));
  }

  return NextResponse.json({
    trigger_type: 'rescore',
    pairs: pairs.length,
    results,
  });
}

async function runPair(
  sb: ReturnType<typeof createServiceClient>,
  pair: PairRow,
  body: RescoreBody,
  auth: Awaited<ReturnType<typeof authorizeAdminOrCron>>,
): Promise<PairResult> {
  const { campus, role } = pair;

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

  // Open fetch_run (rescore type — does NOT count against API quota)
  const triggeredBy = auth.kind === 'admin' ? auth.user.id : null;
  const startedAt = Date.now();
  const { data: runIns, error: runErr } = await sb
    .from('fetch_runs')
    .insert({
      trigger_type: 'rescore',
      triggered_by: triggeredBy,
      campus_id: campus.id,
      role_id: role.id,
      status: 'running',
      query_params: {
        rescore: true,
        taxonomy_version: taxonomyRow.version,
        include_inactive: !!body.include_inactive,
      },
    })
    .select('id')
    .single();
  if (runErr || !runIns) {
    return {
      campus_id: campus.id,
      role_id: role.id,
      status: 'failed',
      error: `Could not open fetch_run: ${runErr?.message}`,
    };
  }
  const fetchRunId = (runIns as { id: string }).id;

  try {
    // Load jobs to rescore
    let jq = sb.from('jobs').select('*').limit(MAX_JOBS_PER_PAIR);
    if (!body.include_inactive) {
      jq = jq.eq('still_active', true);
    }
    const { data: jobs, error: jobsErr } = await jq;
    if (jobsErr) throw new Error(`Job load failed: ${jobsErr.message}`);
    const rows = (jobs as Array<Record<string, unknown>>) ?? [];

    if (rows.length === 0) {
      await sb
        .from('fetch_runs')
        .update({
          status: 'success',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          jobs_returned: 0,
          scores_computed: 0,
        })
        .eq('id', fetchRunId);
      return {
        campus_id: campus.id,
        role_id: role.id,
        status: 'no_jobs',
        fetch_run_id: fetchRunId,
        jobs_scored: 0,
      };
    }

    const campusCtx = makeCampusContext(campus);
    const scoreRows: Record<string, unknown>[] = [];

    for (const row of rows) {
      const payload = jobsRowToPayload(row);
      if (!payload) continue;
      const result = scoreJob(payload, taxonomy, campusCtx);
      scoreRows.push(
        scoreResultToRow(result, {
          job_id: row.id as string,
          taxonomy_id: taxonomyRow.id,
          campus_id: campus.id,
          fetch_run_id: fetchRunId,
        }),
      );
    }

    // Batch insert
    for (let i = 0; i < scoreRows.length; i += BATCH_SIZE) {
      const chunk = scoreRows.slice(i, i + BATCH_SIZE);
      const { error: insErr } = await sb.from('job_scores').insert(chunk);
      if (insErr) throw new Error(`job_scores insert failed: ${insErr.message}`);
    }

    await sb
      .from('fetch_runs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        jobs_returned: rows.length,
        scores_computed: scoreRows.length,
      })
      .eq('id', fetchRunId);

    if (auth.kind === 'admin') {
      await sb.from('audit_log').insert({
        user_id: auth.user.id,
        user_email: auth.user.email,
        action: 'rescore',
        entity_type: 'fetch_run',
        entity_id: fetchRunId,
        metadata: {
          campus_id: campus.id,
          role_id: role.id,
          taxonomy_version: taxonomyRow.version,
          jobs_scored: scoreRows.length,
          include_inactive: !!body.include_inactive,
        },
      });
    }

    return {
      campus_id: campus.id,
      role_id: role.id,
      status: 'success',
      fetch_run_id: fetchRunId,
      jobs_scored: scoreRows.length,
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
