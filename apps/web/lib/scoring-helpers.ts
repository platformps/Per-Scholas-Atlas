// Shared helpers for /api/fetch-jobs and /api/rescore.
//
// All four functions are thin wrappers around Supabase queries + the scoring
// engine. They take a service-role client as input rather than constructing
// one themselves, which makes them composable and avoids re-importing the
// service key in every caller.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScoreResult, Taxonomy, JobPayload, CampusContext } from '@per-scholas/scoring';

// ─── Pair / taxonomy loaders ────────────────────────────────────────────
export interface CampusRow {
  id: string;
  name: string;
  city: string;
  state: string;
  /**
   * Optional override for the Job API location_filter. Used for campuses
   * whose office city is a poor proxy for the metro labor market — e.g.
   * Brooklyn (new_york_city campus) → "New York", Cambridge → "Boston",
   * Menlo Park → "San Francisco", Silver Spring → "Washington". Falls
   * back to `city` when null.
   */
  metro_label: string | null;
  lat: number;
  lng: number;
  default_radius_miles: number;
}

export interface RoleRow {
  id: string;
  name: string;
}

export interface PairRow {
  campus: CampusRow;
  role: RoleRow;
}

export async function loadActivePairs(
  sb: SupabaseClient,
  campusFilter?: string,
  roleFilter?: string,
): Promise<PairRow[]> {
  let q = sb
    .from('campus_roles')
    .select('campus_id, role_id, campuses(*), roles(*)')
    .eq('active', true);
  if (campusFilter) q = q.eq('campus_id', campusFilter);
  if (roleFilter) q = q.eq('role_id', roleFilter);
  const { data, error } = await q;
  if (error || !data) return [];
  // Supabase v2 infers joined relations as arrays even when the FK is a
  // 1:1 to a unique key. We tolerate both shapes (single object OR
  // single-element array) to stay robust across codegen / no-codegen.
  type Joined = { campuses: CampusRow | CampusRow[] | null; roles: RoleRow | RoleRow[] | null };
  return (data as unknown as Joined[])
    .map(r => ({
      campus: Array.isArray(r.campuses) ? r.campuses[0] : r.campuses,
      role: Array.isArray(r.roles) ? r.roles[0] : r.roles,
    }))
    .filter((p): p is PairRow => Boolean(p.campus && p.role));
}

export interface TaxonomyRow {
  id: string;
  version: string;
  schema: Taxonomy;
}

export async function loadActiveTaxonomy(
  sb: SupabaseClient,
  roleId: string,
): Promise<TaxonomyRow | null> {
  const { data } = await sb
    .from('taxonomies')
    .select('id, version, schema')
    .eq('role_id', roleId)
    .eq('active', true)
    .limit(1)
    .single();
  return (data as TaxonomyRow | null) ?? null;
}

// ─── ScoreResult → DB row ───────────────────────────────────────────────
export interface ScoreFK {
  job_id: string;
  taxonomy_id: string;
  campus_id: string;
  fetch_run_id: string;
}

export function scoreResultToRow(
  result: ScoreResult,
  fk: ScoreFK,
): Record<string, unknown> {
  return {
    ...fk,
    confidence: result.confidence,
    score: result.score,
    title_tier: result.titleTier,
    title_matched: result.titleMatched,
    title_score: result.titleScore,
    core_matched: result.coreMatched,
    core_score: result.coreScore,
    specialized_matched: result.specializedMatched,
    specialized_score: result.specializedScore,
    bonus_matched: result.bonusMatched,
    bonus_score: result.bonusScore,
    industry_matched: result.industryMatched,
    industry_score: result.industryScore,
    certs_matched: result.certsMatched,
    certs_score: result.certsScore,
    employer_hit: result.employerHit,
    employer_score: result.employerScore,
    experience_penalty: result.experiencePenalty,
    distance_miles: result.distanceMiles,
    tags: result.tags,
    rejection_reason: result.rejectionReason,
  };
}

// ─── DB row → JobPayload (rescore path) ─────────────────────────────────
// The scoring engine consumes the JobPayload shape (matches API field names).
// When we re-score from `jobs` rows, we have to translate column names back
// (e.g. ai_salary_min → ai_salary_minvalue) so a single scoring engine can
// serve both fetch-time and rescore-time inputs.
export function jobsRowToPayload(row: Record<string, unknown>): JobPayload | null {
  const id = typeof row.source_id === 'string' ? row.source_id : null;
  const title = typeof row.title === 'string' ? row.title : null;
  if (!id || !title) return null;
  return {
    id,
    title,
    organization: typeof row.organization === 'string' ? row.organization : undefined,
    organization_logo: typeof row.organization_logo === 'string' ? row.organization_logo : undefined,
    url: typeof row.url === 'string' ? row.url : undefined,
    source: typeof row.source_ats === 'string' ? row.source_ats : undefined,
    source_type: typeof row.source_ats === 'string' ? row.source_ats : undefined,
    date_posted: typeof row.date_posted === 'string' ? row.date_posted : undefined,
    date_created: typeof row.date_created === 'string' ? row.date_created : undefined,
    description_text: typeof row.description_text === 'string' ? row.description_text : undefined,
    locations_derived: asStringArray(row.locations_derived),
    cities_derived: asStringArray(row.cities_derived),
    regions_derived: asStringArray(row.regions_derived),
    countries_derived: asStringArray(row.countries_derived),
    lats_derived: asNumberArray(row.lats_derived),
    lngs_derived: asNumberArray(row.lngs_derived),
    location_type: typeof row.location_type === 'string' ? row.location_type : null,
    employment_type: asStringArray(row.employment_type),
    ai_key_skills: asStringArray(row.ai_key_skills),
    ai_experience_level: typeof row.ai_experience_level === 'string' ? row.ai_experience_level : undefined,
    ai_employment_type: asStringArray(row.ai_employment_type),
    ai_work_arrangement: typeof row.ai_work_arrangement === 'string' ? row.ai_work_arrangement : undefined,
    ai_salary_minvalue: asNumber(row.ai_salary_min),
    ai_salary_maxvalue: asNumber(row.ai_salary_max),
    ai_salary_unittext: typeof row.ai_salary_unittext === 'string' ? row.ai_salary_unittext : undefined,
    linkedin_org_industry: typeof row.linkedin_org_industry === 'string' ? row.linkedin_org_industry : undefined,
    linkedin_org_employees: asNumber(row.linkedin_org_employees),
    linkedin_org_recruitment_agency_derived:
      typeof row.linkedin_org_recruitment_agency_derived === 'boolean'
        ? row.linkedin_org_recruitment_agency_derived
        : undefined,
  };
}

export function makeCampusContext(c: CampusRow): CampusContext {
  return {
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    radiusMiles: c.default_radius_miles,
  };
}

// ─── primitive coercers (reused) ───────────────────────────────────────
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
