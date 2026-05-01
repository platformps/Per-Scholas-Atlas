// GET /api/admin/sources
//
// Admin-only diagnostic endpoint that reports which job-postings data
// sources are configured (env vars set) and whether each source's
// credentials work against a live ping. Use it after setting / changing
// a source API key in Vercel to confirm the env var made it to runtime
// without leaking the actual key value.
//
// Returns per-source: { configured: boolean, ok: boolean, error?: string }
//
// Active Jobs DB ping: just check RAPIDAPI_KEY presence; we don't burn a
// quota credit on validation. The cron will tell us if the key stops
// working.
//
// TheirStack ping: send a minimal POST to /v1/jobs/search asking for 1
// result. Costs 1 API credit per call. Cheap enough to do on demand.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SourceStatus {
  source: string;
  configured: boolean;
  ok: boolean;
  detail: string;
}

export async function GET(request: Request) {
  await requireAdmin();
  // ?probe=true returns the first raw job from each source's live ping so
  // we can inspect the response shape when wiring up new adapters. Admin-
  // only and one-off — adds 1 API credit on TheirStack per call.
  const url = new URL(request.url);
  const probe = url.searchParams.get('probe') === 'true';
  const results: SourceStatus[] = [];
  const samples: Record<string, unknown> = {};

  // ─── Active Jobs DB ────────────────────────────────────────────────
  results.push({
    source: 'active-jobs-db',
    configured: !!process.env.RAPIDAPI_KEY,
    ok: !!process.env.RAPIDAPI_KEY,
    detail: process.env.RAPIDAPI_KEY
      ? 'RAPIDAPI_KEY set (presence-only check; not pinged)'
      : 'RAPIDAPI_KEY missing',
  });

  // ─── TheirStack ────────────────────────────────────────────────────
  const tsKey = process.env.THEIRSTACK_API_KEY;
  if (!tsKey) {
    results.push({
      source: 'theirstack',
      configured: false,
      ok: false,
      detail: 'THEIRSTACK_API_KEY env var is not set',
    });
  } else {
    // Live ping. Minimal request body — 1 result, recent. The endpoint
    // is /v1/jobs/search per TheirStack's docs.
    try {
      const r = await fetch('https://api.theirstack.com/v1/jobs/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tsKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page: 0,
          limit: 1,
          posted_at_max_age_days: 7,
          job_title_or: ['fiber technician'],
          job_country_code_or: ['US'],
        }),
      });
      const status = r.status;
      if (status >= 200 && status < 300) {
        const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        const total =
          (data as { metadata?: { total_results?: number } })?.metadata?.total_results ??
          (data as { total_results?: number })?.total_results ??
          (data as { total?: number })?.total ??
          null;
        results.push({
          source: 'theirstack',
          configured: true,
          ok: true,
          detail:
            total != null
              ? `Live ping OK (${status}). Sample query "fiber technician" matched ${total.toLocaleString()} jobs.`
              : `Live ping OK (${status}). Response shape unfamiliar but call succeeded.`,
        });
        if (probe) {
          // Dump top-level keys + first job (if present) so we can write the
          // adapter against actual response shape rather than guessing.
          const topLevelKeys = Object.keys(data);
          const dataField =
            (data as { data?: unknown[] })?.data ??
            (data as { jobs?: unknown[] })?.jobs ??
            (data as { results?: unknown[] })?.results ??
            null;
          const firstJob = Array.isArray(dataField) && dataField.length > 0 ? dataField[0] : null;
          samples.theirstack = {
            top_level_keys: topLevelKeys,
            sample_total_results: total,
            first_job: firstJob,
          };
        }
      } else {
        const body = await r.text().catch(() => '');
        results.push({
          source: 'theirstack',
          configured: true,
          ok: false,
          detail: `Live ping FAILED (${status}). ${body.slice(0, 200)}`,
        });
      }
    } catch (e) {
      results.push({
        source: 'theirstack',
        configured: true,
        ok: false,
        detail: `Live ping threw: ${e instanceof Error ? e.message : 'unknown'}`,
      });
    }
  }

  return NextResponse.json(probe ? { sources: results, samples } : { sources: results });
}
