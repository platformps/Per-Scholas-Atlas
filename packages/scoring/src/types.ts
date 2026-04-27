// ============================================================================
// Taxonomy schema types (matches packages/taxonomy/schemas/cft.json)
// ============================================================================

/**
 * How a skill form should be matched against job text.
 * - 'word'      : whole-word regex match (`\bform\b`, with optional trailing 's' for plurals).
 *                 Use for short tokens / acronyms where substring matching causes false positives
 *                 (e.g. 'sop' in 'philosopher', 'ats' in 'thermostats', 'bas' in 'basement').
 * - 'substring' : raw `text.includes(form)`. Use for multi-word phrases where collisions are
 *                 vanishingly rare (e.g. 'uninterruptible power supply').
 *
 * If omitted, the engine auto-classifies: any form ≤4 chars or all-caps acronym → 'word',
 * otherwise → 'substring'. See §A1 of SCORING_ADDENDUM.md.
 */
export type MatchMode = 'word' | 'substring';

export interface SkillEntry {
  canonical: string;
  forms: string[];
  match_mode?: MatchMode;
  curriculum_module?: string;
  is_certification?: boolean;
}

/** §B4 — employer category with metadata (v1.1.0). */
export interface EmployerCategory {
  is_healthcare: boolean;
  employers: string[];
}

/**
 * §B3 — rule-based tag definition (v1.1.0). A tag fires if ANY of its present
 * clauses is satisfied (OR semantics across clauses). For `any_of_skills`,
 * `min_matches` (default 1) sets the threshold.
 */
export interface TagRule {
  /** Canonical skill names that must appear in any matched bucket (core/specialized/bonus/cert). */
  any_of_skills?: string[];
  /** Minimum number of skills from `any_of_skills` that must match. Default 1. */
  min_matches?: number;
  /** Names of `employer_watchlist.categories` whose employers count as a hit on the job's organization. */
  any_of_employer_categories?: string[];
  /** Substrings to look for in combined title + description (case-insensitive). */
  any_of_phrases?: string[];
  /** Substrings to look for in `linkedin_org_industry` (case-insensitive). */
  any_of_industries?: string[];
}

export interface TagDef {
  description?: string;
  rules: TagRule;
}

export interface TitleTier {
  description: string;
  score: number;
  score_if_unverified?: number;
  min_core_skills_to_verify?: number;
  tag?: string;
  requires_healthcare_context?: boolean;
  phrases: string[];
}

export interface Taxonomy {
  role_id: string;
  role_name: string;
  version: string;
  version_notes?: string;
  curriculum_source?: Record<string, unknown>;
  created_at?: string;
  created_by?: string;
  active: boolean;

  title_tiers: {
    A: TitleTier;
    B: TitleTier;
    C: TitleTier;
    D: TitleTier;
  };
  title_exclusions: {
    seniority: string[];
    wrong_discipline: string[];
    controls_programming: string[];
  };
  description_disqualifiers: {
    credentials: string[];
    /**
     * §A2: regex-based experience filter (replaces literal-string list).
     * Each pattern's first capture group is the year-count (digit or spelled-out).
     * Rejection requires the captured number > max_years_allowed AND a
     * "required"-class word within ±50 chars of the match.
     */
    experience: {
      max_years_allowed: number;
      patterns: string[];
    };
  };
  core_skills: {
    weight_per_match: number;
    max_score: number;
    skills: SkillEntry[];
  };
  specialized_skills: {
    weight_per_match: number;
    max_score: number;
    skills: SkillEntry[];
  };
  bonus_skills: {
    weight_per_match: number;
    max_score: number;
    requires_core_or_industry_match: boolean;
    skills: SkillEntry[];
  };
  industry_context: {
    weight_per_match: number;
    max_score: number;
    phrases: string[];
  };
  healthcare_context: {
    phrases: string[];
  };
  certifications: {
    weight_per_match: number;
    max_score: number;
    certs: SkillEntry[];
  };
  /**
   * §B4 (v1.1.0): each category carries `is_healthcare` so the Tier D gate (§A4)
   * can use a healthcare-employer match as a healthcare-context signal.
   */
  employer_watchlist: {
    weight_per_match: number;
    categories: Record<string, EmployerCategory>;
  };
  experience_filter: {
    api_levels_allowed: string[];
    auto_reject_levels: string[];
    post_fetch_penalty: {
      patterns: string[];
      penalty: number;
    };
  };
  geography: {
    default_radius_miles: number;
  };
  scoring: {
    thresholds: {
      high: number;
      medium: number;
      low: number;
    };
  };
  /**
   * §B3 — top-level tag definitions evaluated independently of `titleTier`.
   * Optional for back-compat with v1.0.0 schemas.
   */
  tags?: Record<string, TagDef>;
}

// ============================================================================
// Job payload (matches Fantastic Jobs API response structure)
// ============================================================================
export interface JobPayload {
  id: string;
  title: string;
  organization?: string;
  organization_logo?: string;
  url?: string;
  source?: string;
  source_type?: string;
  date_posted?: string;
  date_created?: string;
  description_text?: string;

  locations_derived?: string[];
  cities_derived?: string[];
  regions_derived?: string[];
  countries_derived?: string[];
  lats_derived?: number[];
  lngs_derived?: number[];
  location_type?: string | null;
  employment_type?: string[];

  ai_key_skills?: string[];
  ai_experience_level?: string;
  ai_employment_type?: string[];
  ai_work_arrangement?: string;
  ai_salary_minvalue?: number;
  ai_salary_maxvalue?: number;
  ai_salary_unittext?: string;

  linkedin_org_industry?: string;
  linkedin_org_employees?: number;
  linkedin_org_recruitment_agency_derived?: boolean;
}

// ============================================================================
// Campus context for scoring (geofence)
// ============================================================================
export interface CampusContext {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMiles: number;
}

// ============================================================================
// Score result — the output of scoreJob()
// ============================================================================
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECT';

export interface ScoreResult {
  jobId: string;
  title: string;
  organization?: string;

  confidence: Confidence;
  score: number;

  titleTier: 'A' | 'B' | 'C' | 'D' | null;
  titleMatched: string | null;
  titleScore: number;

  coreMatched: string[];
  coreScore: number;
  specializedMatched: string[];
  specializedScore: number;
  bonusMatched: string[];
  bonusScore: number;
  industryMatched: string[];
  industryScore: number;
  certsMatched: string[];
  certsScore: number;
  employerHit: boolean;
  employerScore: number;
  experiencePenalty: number;

  distanceMiles: number | null;
  tags: string[];
  rejectionReason: string | null;
}
