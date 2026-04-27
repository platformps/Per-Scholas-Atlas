// RapidAPI / Active Jobs DB client + payload normalizer.
//
// Two responsibilities, both pure and unit-testable:
//   1. buildTitleFilter()          — taxonomy → boolean OR expression
//   2. normalizeApiJob()           — RapidAPI payload → JobPayload (the shape
//                                    `scoreJob()` consumes from packages/scoring)
//
// One side-effecty function:
//   3. fetchActiveJobs()           — hits the API, returns rows + quota headers
//
// Pagination is handled by `fetchAllActiveJobs()`. We respect the 5 req/s
// rate limit with a 250ms sleep between pages (per BRIEF §7).

import type { JobPayload, Taxonomy } from '@per-scholas/scoring';

export const RAPIDAPI_HOST = 'active-jobs-db.p.rapidapi.com';
export const RAPIDAPI_URL = `https://${RAPIDAPI_HOST}/active-ats-7d`;

/**
 * Build a boolean-OR title filter from Tier A + Tier B phrases of the active
 * taxonomy. Tier C/D are intentionally NOT sent to the server — see BRIEF §7
 * ("we build this from Tier A + Tier B titles only … to avoid query-string
 * noise"). C/D matches happen post-fetch via title tier scoring.
 */
export function buildTitleFilter(taxonomy: Taxonomy): string {
  const a = taxonomy.title_tiers.A?.phrases ?? [];
  const b = taxonomy.title_tiers.B?.phrases ?? [];
  // Quote each phrase so multi-word terms are treated atomically by the API,
  // dedupe to keep the URL compact.
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const p of [...a, ...b]) {
    const lower = p.toLowerCase().trim();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    phrases.push(`"${lower}"`);
  }
  return phrases.join(' OR ');
}

/**
 * US state code → full name. The Active Jobs DB index stores
 * locations_derived as `"City, <FullStateName>, United States"` — for
 * example, `"Perry, Georgia, United States"`. The two-letter code does
 * not appear in the indexed string, so a filter like `"Atlanta, GA"`
 * substring-matches nothing. We translate the campus's `state` column
 * (2-letter, per the seed) to the full name before building the filter.
 */
const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

/**
 * Compose a location filter in the form "City, FullStateName"
 * (e.g. "Atlanta, Georgia"). The Active Jobs DB API does fuzzy substring
 * matching against locations_derived; this format is the substring most
 * commonly present in real ATS-indexed location strings.
 *
 * The 100-mile haversine geofence in scoring picks up the precision; the
 * server-side filter just needs decent recall in the right metro.
 */
export function buildLocationFilter(campus: { city: string; state: string }): string {
  const code = campus.state.toUpperCase();
  const fullState = US_STATE_NAMES[code] ?? campus.state;
  return `${campus.city}, ${fullState}`;
}

/**
 * Quota state surfaced by the API in response headers. All optional —
 * the API may not return every field on every response.
 */
export interface QuotaSnapshot {
  jobs_remaining: number | null;
  requests_remaining: number | null;
}

export function readQuotaHeaders(headers: Headers): QuotaSnapshot {
  const jr = headers.get('x-ratelimit-jobs-remaining');
  const rr = headers.get('x-ratelimit-requests-remaining');
  return {
    jobs_remaining: jr != null && /^\d+$/.test(jr) ? parseInt(jr, 10) : null,
    requests_remaining: rr != null && /^\d+$/.test(rr) ? parseInt(rr, 10) : null,
  };
}

interface FetchPageOptions {
  titleFilter: string;
  locationFilter: string;
  limit?: number;
  offset?: number;
}

/** Single-page fetch. Throws on non-2xx. */
export async function fetchActiveJobs(opts: FetchPageOptions): Promise<{
  rawJobs: unknown[];
  quota: QuotaSnapshot;
}> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY env var not set');

  // Note on filters: we deliberately do NOT pass `ai_employment_type_filter`
  // or `ai_experience_level_filter`. Those are AI-classified per-job fields;
  // when null (which is common — many postings don't get classified), the
  // job is excluded server-side and we lose recall. Our scoring engine does
  // the same filtering post-fetch via `experience_filter.auto_reject_levels`
  // and the §A2 description regex, with the added benefit of being able to
  // see WHY each job was rejected (rejection_reason). Server-side AI filters
  // were inherited from the Python worker pattern and dropped 2026-04-27 after
  // empirical recall loss observed in the first Atlanta fetch (18 jobs).
  const params = new URLSearchParams({
    title_filter: opts.titleFilter,
    location_filter: opts.locationFilter,
    description_type: 'text',
    include_ai: 'true',
    include_li: 'true',
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
  });

  const resp = await fetch(`${RAPIDAPI_URL}?${params.toString()}`, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': RAPIDAPI_HOST,
    },
    // Disable Next caching — we want a real network call every invocation.
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '<no body>');
    throw new Error(`Active Jobs DB ${resp.status}: ${body.slice(0, 500)}`);
  }
  const data = (await resp.json()) as unknown;
  const rawJobs = Array.isArray(data) ? data : [];
  return { rawJobs, quota: readQuotaHeaders(resp.headers) };
}

/**
 * Paginated fetch. Stops when a page returns fewer than `pageSize` rows OR
 * `maxTotal` is reached. Returns aggregate jobs + the QuotaSnapshot from the
 * LAST page.
 */
export async function fetchAllActiveJobs(opts: {
  titleFilter: string;
  locationFilter: string;
  pageSize?: number;
  maxTotal?: number;
}): Promise<{ rawJobs: unknown[]; quota: QuotaSnapshot }> {
  const pageSize = opts.pageSize ?? 100;
  const maxTotal = opts.maxTotal ?? 500;
  const all: unknown[] = [];
  let quota: QuotaSnapshot = { jobs_remaining: null, requests_remaining: null };
  let offset = 0;
  while (all.length < maxTotal) {
    const { rawJobs, quota: q } = await fetchActiveJobs({
      titleFilter: opts.titleFilter,
      locationFilter: opts.locationFilter,
      limit: Math.min(pageSize, maxTotal - all.length),
      offset,
    });
    quota = q;
    if (rawJobs.length === 0) break;
    all.push(...rawJobs);
    if (rawJobs.length < pageSize) break;
    offset += pageSize;
    // 5 req/sec → 200ms minimum spacing; 250ms gives headroom (BRIEF §7).
    await new Promise(r => setTimeout(r, 250));
  }
  return { rawJobs: all.slice(0, maxTotal), quota };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalize raw API payload → JobPayload (the shape scoreJob expects)
// ─────────────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asStringRequired(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length ? out : undefined;
}
function asNumberArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return out.length ? out : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Normalize a single raw RapidAPI job into the JobPayload shape that
 * `scoreJob` consumes. Returns null for rows missing the required `id` or
 * `title`; the caller should skip those.
 *
 * Notes on field renames between the API and our type:
 *   API field            → JobPayload field
 *   `id`                 → `id`
 *   `ai_salary_minvalue` → not used directly here (we keep both shapes for DB upsert)
 *   `ai_salary_maxvalue` → ditto
 */
export function normalizeApiJob(raw: unknown): JobPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = asString(r.id);
  const title = asString(r.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    organization: asString(r.organization),
    organization_logo: asString(r.organization_logo),
    url: asString(r.url),
    source: asString(r.source),
    source_type: asString(r.source_type),
    date_posted: asString(r.date_posted),
    date_created: asString(r.date_created),
    description_text: asString(r.description_text),
    locations_derived: asStringArray(r.locations_derived),
    cities_derived: asStringArray(r.cities_derived),
    regions_derived: asStringArray(r.regions_derived),
    countries_derived: asStringArray(r.countries_derived),
    lats_derived: asNumberArray(r.lats_derived),
    lngs_derived: asNumberArray(r.lngs_derived),
    location_type: asString(r.location_type) ?? null,
    employment_type: asStringArray(r.employment_type),
    ai_key_skills: asStringArray(r.ai_key_skills),
    ai_experience_level: asString(r.ai_experience_level),
    ai_employment_type: asStringArray(r.ai_employment_type),
    ai_work_arrangement: asString(r.ai_work_arrangement),
    ai_salary_minvalue: asNumber(r.ai_salary_minvalue),
    ai_salary_maxvalue: asNumber(r.ai_salary_maxvalue),
    ai_salary_unittext: asString(r.ai_salary_unittext),
    linkedin_org_industry: asString(r.linkedin_org_industry),
    linkedin_org_employees: asNumber(r.linkedin_org_employees),
    linkedin_org_recruitment_agency_derived: asBool(r.linkedin_org_recruitment_agency_derived),
  };
}

/**
 * Project a raw API row into the column shape of the `jobs` table for upsert.
 * Renames `ai_salary_minvalue`/`maxvalue` → `ai_salary_min`/`max`. Stores the
 * full original payload in `raw_payload` for forensics.
 */
export function rawJobToDbRow(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = asString(r.id);
  const title = asString(r.title);
  if (!id || !title) return null;
  return {
    source_id: id,
    source_ats: asString(r.source_type) ?? asString(r.source) ?? null,
    url: asString(r.url) ?? null,
    title,
    organization: asString(r.organization) ?? null,
    organization_logo: asString(r.organization_logo) ?? null,
    description_text: asString(r.description_text) ?? null,
    date_posted: asString(r.date_posted) ?? null,
    date_created: asString(r.date_created) ?? null,
    locations_derived: asStringArray(r.locations_derived) ?? null,
    cities_derived: asStringArray(r.cities_derived) ?? null,
    regions_derived: asStringArray(r.regions_derived) ?? null,
    countries_derived: asStringArray(r.countries_derived) ?? null,
    lats_derived: asNumberArray(r.lats_derived) ?? null,
    lngs_derived: asNumberArray(r.lngs_derived) ?? null,
    location_type: asString(r.location_type) ?? null,
    employment_type: asStringArray(r.employment_type) ?? null,
    ai_key_skills: asStringArray(r.ai_key_skills) ?? null,
    ai_experience_level: asString(r.ai_experience_level) ?? null,
    ai_employment_type: asStringArray(r.ai_employment_type) ?? null,
    ai_work_arrangement: asString(r.ai_work_arrangement) ?? null,
    ai_salary_min: asNumber(r.ai_salary_minvalue) ?? null,
    ai_salary_max: asNumber(r.ai_salary_maxvalue) ?? null,
    ai_salary_unittext: asString(r.ai_salary_unittext) ?? null,
    linkedin_org_industry: asString(r.linkedin_org_industry) ?? null,
    linkedin_org_employees: asNumber(r.linkedin_org_employees) ?? null,
    linkedin_org_recruitment_agency_derived: asBool(r.linkedin_org_recruitment_agency_derived) ?? null,
    raw_payload: r,
  };
}
