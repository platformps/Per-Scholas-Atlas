// TheirStack client + payload normalizer.
//
// TheirStack aggregates job postings from 315k+ sources (LinkedIn,
// Indeed, ATSes including Workday/Greenhouse/Lever/iCIMS) and exposes
// them through a single REST API. We use it as a second data source
// alongside Active Jobs DB to close the coverage gap on small/mid LV
// contractors and major carriers that don't appear in ATS-only feeds.
//
// Three responsibilities, all pure and unit-testable:
//   1. buildTheirStackTitleFilter() — taxonomy → array of phrases
//   2. fetchAllTheirStackJobs()    — POST to /v1/jobs/search, paginated
//   3. normalizeTheirStackJob()    — TheirStack response → JobPayload
//                                    (the shape `scoreJob` consumes)
//
// Plus a DB-row projector: theirStackJobToDbRow() — same shape as
// rawJobToDbRow in rapidapi.ts so the upsert path is unchanged.
//
// Activation: only runs if THEIRSTACK_API_KEY env var is set. Returning
// an empty array (vs throwing) lets the multi-source fan-out keep
// running on Active Jobs DB alone if this source goes down.

import type { JobPayload, Taxonomy } from '@per-scholas/scoring';

export const THEIRSTACK_BASE = 'https://api.theirstack.com/v1';
export const THEIRSTACK_SEARCH_URL = `${THEIRSTACK_BASE}/jobs/search`;

/**
 * Build the title-phrase array for TheirStack's job_title_or filter.
 * TheirStack treats the array as OR-ed substring matches across the
 * `job_title` field (similar to Active Jobs DB's title_filter, but
 * sent as a list rather than a quoted boolean expression).
 *
 * Tier A + Tier B phrases only — Tier C/D are post-fetch concepts.
 */
export function buildTheirStackTitleFilter(taxonomy: Taxonomy): string[] {
  const a = taxonomy.title_tiers.A?.phrases ?? [];
  const b = taxonomy.title_tiers.B?.phrases ?? [];
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const p of [...a, ...b]) {
    const lower = p.toLowerCase().trim();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    phrases.push(lower);
  }
  return phrases;
}

/**
 * Build a location filter pattern for TheirStack. We pass a single
 * substring match against the `location` field (e.g. "New York" matches
 * "New York, NY", "New York City", "Brooklyn, New York"). Pre-fetch
 * filtering is intentionally loose — the post-fetch haversine in
 * scoreJob handles the precision against the campus's lat/lng.
 *
 * `metro_label` override mirrors the Active Jobs DB campus fix:
 * Bronx → "New York", Cambridge → "Boston", Menlo Park → "San
 * Francisco", Silver Spring → "Washington".
 */
export function buildTheirStackLocationFilter(campus: {
  city: string;
  state: string;
  metro_label?: string | null;
}): string {
  return campus.metro_label?.trim() || campus.city;
}

// ─── Single-page fetch ─────────────────────────────────────────────────────
interface FetchPageOptions {
  titlePhrases: string[];
  locationPattern: string;
  page?: number;
  limit?: number;
  /** Match the Active Jobs DB cap (last 7 days). 30 days is supported by
   *  TheirStack but produces too much overlap with prior cron runs. */
  postedMaxAgeDays?: number;
  apiKey: string;
}

export interface TheirStackQuotaSnapshot {
  api_credits_remaining: number | null;
}

interface PageResult {
  rawJobs: unknown[];
  total: number | null;
  quota: TheirStackQuotaSnapshot;
}

/**
 * One page of TheirStack results. Throws on non-2xx so the caller can
 * decide whether to retry or skip the source for this run.
 *
 * Notable filters:
 *   - posted_at_max_age_days: caps to last N days
 *   - job_title_or: OR-list of title substrings
 *   - job_location_pattern_or: OR-list of location substrings
 *   - job_country_code_or: ['US'] — restrict to US postings
 *   - blur_company_data: false — we want unredacted employer names
 */
export async function fetchTheirStackPage(opts: FetchPageOptions): Promise<PageResult> {
  const body = {
    page: opts.page ?? 0,
    limit: opts.limit ?? 100,
    posted_at_max_age_days: opts.postedMaxAgeDays ?? 7,
    job_title_or: opts.titlePhrases,
    job_location_pattern_or: [opts.locationPattern],
    job_country_code_or: ['US'],
    blur_company_data: false,
  };
  const resp = await fetch(THEIRSTACK_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '<no body>');
    throw new Error(`TheirStack ${resp.status}: ${errBody.slice(0, 500)}`);
  }
  const data = (await resp.json()) as {
    metadata?: { total_results?: number; api_credits_remaining?: number };
    data?: unknown[];
  };
  const rawJobs = Array.isArray(data?.data) ? data.data : [];
  const total = data?.metadata?.total_results ?? null;
  const credits = data?.metadata?.api_credits_remaining ?? null;
  return { rawJobs, total, quota: { api_credits_remaining: credits } };
}

/**
 * Paginated fetch. Stops when a page returns fewer than `pageSize`
 * results OR `maxTotal` is reached OR `total_results` from page 0 has
 * been satisfied. Returns aggregate jobs + the QuotaSnapshot from the
 * LAST page.
 */
export async function fetchAllTheirStackJobs(opts: {
  titlePhrases: string[];
  locationPattern: string;
  pageSize?: number;
  maxTotal?: number;
  postedMaxAgeDays?: number;
  apiKey: string;
}): Promise<{ rawJobs: unknown[]; quota: TheirStackQuotaSnapshot }> {
  const pageSize = opts.pageSize ?? 100;
  const maxTotal = opts.maxTotal ?? 500;
  const all: unknown[] = [];
  let quota: TheirStackQuotaSnapshot = { api_credits_remaining: null };
  let page = 0;
  while (all.length < maxTotal) {
    const { rawJobs, quota: q } = await fetchTheirStackPage({
      titlePhrases: opts.titlePhrases,
      locationPattern: opts.locationPattern,
      page,
      limit: Math.min(pageSize, maxTotal - all.length),
      postedMaxAgeDays: opts.postedMaxAgeDays,
      apiKey: opts.apiKey,
    });
    quota = q;
    if (rawJobs.length === 0) break;
    all.push(...rawJobs);
    if (rawJobs.length < pageSize) break;
    page += 1;
    // Be polite — 250ms between pages mirrors the Active Jobs DB cadence
    // and stays well under any rate-limit cap.
    await new Promise(r => setTimeout(r, 250));
  }
  return { rawJobs: all.slice(0, maxTotal), quota };
}

// ─── Normalize TheirStack response → JobPayload ──────────────────────────
//
// The scoring engine consumes the JobPayload shape (modeled on Active
// Jobs DB's response). TheirStack uses different field names; this
// function maps them. Where TheirStack provides richer data than Active
// Jobs DB (cities, country_codes, employment_statuses), we use it.
// Where TheirStack is sparser (no AI key skills, no AI work arrangement),
// we leave fields undefined and let the scoring engine handle it.

type Raw = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length ? out : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Map TheirStack's `seniority` enum to Active Jobs DB's
 * `ai_experience_level` enum so the scoring engine's
 * auto_reject_levels filter works the same on both sources.
 */
function mapSeniority(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const norm = s.toLowerCase();
  // TheirStack values observed: 'junior', 'mid', 'mid_level', 'senior',
  // 'executive', etc. Active Jobs DB uses '0-2', '2-5', '5-10', '10+'.
  if (norm === 'junior' || norm === 'entry' || norm === 'entry_level') return '0-2';
  if (norm === 'mid' || norm === 'mid_level' || norm === 'associate') return '2-5';
  if (norm === 'senior') return '5-10';
  if (norm === 'executive' || norm === 'director' || norm === 'principal') return '10+';
  return undefined;
}

export function normalizeTheirStackJob(raw: unknown): JobPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const idRaw = r.id;
  const id =
    typeof idRaw === 'number'
      ? `theirstack:${idRaw}`
      : typeof idRaw === 'string'
        ? idRaw.startsWith('theirstack:')
          ? idRaw
          : `theirstack:${idRaw}`
        : null;
  const title = asString(r.job_title);
  if (!id || !title) return null;

  // TheirStack returns `cities` and a single `location` string. If `cities`
  // is empty, fall back to deriving city/region from `location`.
  const citiesArr = asStringArray(r.cities);
  const stateCode = asString(r.state_code);
  const countryCode = asString(r.country_code);
  const lat = asNumber(r.latitude);
  const lng = asNumber(r.longitude);

  // The company info can be a string ("BTG Broadview Technology Group") or
  // an object on `company_object`. The string is in `company`.
  const orgName = asString(r.company);
  const companyObj = (r as { company_object?: Raw }).company_object ?? null;
  const orgIndustry = companyObj
    ? (asString(companyObj.industry) ?? null) ?? undefined
    : undefined;
  const orgEmployees = companyObj ? asNumber(companyObj.employee_count) : undefined;
  const orgIsAgency = companyObj ? asBool(companyObj.is_recruiting_agency) : undefined;
  const orgLogo = companyObj ? asString(companyObj.logo) : undefined;

  return {
    id,
    title,
    organization: orgName,
    organization_logo: orgLogo,
    // Prefer source_url (the canonical posting URL). final_url is often
    // null even when source_url is present.
    url: asString(r.source_url) ?? asString(r.final_url) ?? undefined,
    source: 'theirstack',
    source_type: 'theirstack',
    date_posted: asString(r.date_posted),
    date_created: asString(r.discovered_at),
    description_text: asString(r.description),
    locations_derived: undefined,
    cities_derived: citiesArr ?? (asString(r.location) ? [asString(r.location)!.split(',')[0]!.trim()] : undefined),
    regions_derived: stateCode ? [stateCode] : undefined,
    countries_derived: countryCode ? [countryCode] : undefined,
    lats_derived: lat != null ? [lat] : undefined,
    lngs_derived: lng != null ? [lng] : undefined,
    location_type:
      asBool(r.remote) === true ? 'TELECOMMUTE' : asBool(r.hybrid) === true ? 'HYBRID' : null,
    employment_type: asStringArray(r.employment_statuses),
    ai_key_skills: undefined,
    ai_experience_level: mapSeniority(r.seniority),
    ai_employment_type: asStringArray(r.employment_statuses),
    ai_work_arrangement:
      asBool(r.remote) === true ? 'Remote' : asBool(r.hybrid) === true ? 'Hybrid' : undefined,
    ai_salary_minvalue: asNumber(r.min_annual_salary_usd) ?? asNumber(r.min_annual_salary),
    ai_salary_maxvalue: asNumber(r.max_annual_salary_usd) ?? asNumber(r.max_annual_salary),
    ai_salary_unittext: asNumber(r.min_annual_salary_usd) != null ? 'YEAR' : undefined,
    linkedin_org_industry: orgIndustry,
    linkedin_org_employees: orgEmployees,
    linkedin_org_recruitment_agency_derived: orgIsAgency,
  };
}

/**
 * Project a raw TheirStack job into the column shape of the `jobs` table
 * for upsert. Mirrors rawJobToDbRow in lib/rapidapi.ts so the upsert path
 * stays uniform; the only differences are the `source` tag and field
 * mappings (TheirStack's `description` vs Active Jobs DB's
 * `description_text`, etc.).
 */
export function theirStackJobToDbRow(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const idRaw = r.id;
  const sourceId =
    typeof idRaw === 'number'
      ? `theirstack:${idRaw}`
      : typeof idRaw === 'string'
        ? idRaw.startsWith('theirstack:')
          ? idRaw
          : `theirstack:${idRaw}`
        : null;
  const title = asString(r.job_title);
  if (!sourceId || !title) return null;

  const stateCode = asString(r.state_code);
  const countryCode = asString(r.country_code);
  const lat = asNumber(r.latitude);
  const lng = asNumber(r.longitude);
  const citiesArr = asStringArray(r.cities);
  const locationStr = asString(r.location);
  const companyObj = (r as { company_object?: Raw }).company_object ?? null;

  return {
    source_id: sourceId,
    source_ats: asString(r.source_url) ? 'theirstack' : 'theirstack',
    source: 'theirstack',
    url: asString(r.source_url) ?? asString(r.final_url) ?? null,
    title,
    organization: asString(r.company) ?? null,
    organization_logo: companyObj ? (asString(companyObj.logo) ?? null) : null,
    description_text: asString(r.description) ?? null,
    date_posted: asString(r.date_posted) ?? null,
    date_created: asString(r.discovered_at) ?? null,
    locations_derived: locationStr ? [locationStr] : null,
    cities_derived:
      citiesArr ?? (locationStr ? [locationStr.split(',')[0]!.trim()] : null),
    regions_derived: stateCode ? [stateCode] : null,
    countries_derived: countryCode ? [countryCode] : null,
    lats_derived: lat != null ? [lat] : null,
    lngs_derived: lng != null ? [lng] : null,
    location_type:
      asBool(r.remote) === true ? 'TELECOMMUTE' : asBool(r.hybrid) === true ? 'HYBRID' : null,
    employment_type: asStringArray(r.employment_statuses) ?? null,
    ai_key_skills: null,
    ai_experience_level: mapSeniority(r.seniority) ?? null,
    ai_employment_type: asStringArray(r.employment_statuses) ?? null,
    ai_work_arrangement:
      asBool(r.remote) === true ? 'Remote' : asBool(r.hybrid) === true ? 'Hybrid' : null,
    ai_salary_min: asNumber(r.min_annual_salary_usd) ?? asNumber(r.min_annual_salary) ?? null,
    ai_salary_max: asNumber(r.max_annual_salary_usd) ?? asNumber(r.max_annual_salary) ?? null,
    ai_salary_unittext: asNumber(r.min_annual_salary_usd) != null ? 'YEAR' : null,
    linkedin_org_industry: companyObj ? (asString(companyObj.industry) ?? null) : null,
    linkedin_org_employees: companyObj ? (asNumber(companyObj.employee_count) ?? null) : null,
    linkedin_org_recruitment_agency_derived: companyObj
      ? (asBool(companyObj.is_recruiting_agency) ?? null)
      : null,
    raw_payload: r,
  };
}
