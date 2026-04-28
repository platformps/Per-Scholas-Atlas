import type {
  Taxonomy,
  JobPayload,
  CampusContext,
  ScoreResult,
  Confidence,
  SkillEntry,
  MatchMode,
} from './types';

// ============================================================================
// PUBLIC: scoreJob — the only function consumers should call
// ============================================================================
export function scoreJob(
  job: JobPayload,
  taxonomy: Taxonomy,
  campus: CampusContext
): ScoreResult {
  const titleLower = (job.title || '').toLowerCase();
  const descLower = (job.description_text || '').toLowerCase();
  const orgLower = (job.organization || '').toLowerCase();
  const skillsArrayText = (job.ai_key_skills || []).join(' ').toLowerCase();
  const combinedTitleDesc = `${titleLower} ${descLower}`;
  const allText = `${combinedTitleDesc} ${skillsArrayText}`;

  const base: Pick<ScoreResult, 'jobId' | 'title' | 'organization'> = {
    jobId: job.id,
    title: job.title,
    organization: job.organization,
  };

  // ─── Title exclusions (hard reject) ───
  const allExclusions = [
    ...taxonomy.title_exclusions.seniority,
    ...taxonomy.title_exclusions.wrong_discipline,
    ...taxonomy.title_exclusions.controls_programming,
  ];
  const titleExclusionHits = allExclusions.filter(ex => titleLower.includes(ex));
  if (titleExclusionHits.length > 0) {
    return rejectResult(base, `Excluded title pattern: ${titleExclusionHits.join(', ')}`);
  }

  // ─── Description disqualifiers (hard reject) ───
  // Credentials: literal-string match (unchanged from v1.0).
  const credentialHits = taxonomy.description_disqualifiers.credentials.filter(dq =>
    descLower.includes(dq),
  );
  if (credentialHits.length > 0) {
    return rejectResult(base, `Description disqualifier: ${credentialHits.join(', ')}`);
  }

  // Experience: regex pass + numeric threshold + proximity gate (§A2).
  const expReject = checkExperienceDisqualifier(descLower, taxonomy.description_disqualifiers.experience);
  if (expReject) {
    return rejectResult(base, expReject);
  }

  // v1.1.4: wrong-discipline IT detector. If the description has IT-side
  // vocabulary (rack-and-stack, fiber, RMA, GPU clusters, etc.) AND lacks
  // any electromechanical / facilities signal, the job is the IT track —
  // wrong Per Scholas program, hard reject regardless of title.
  //
  // v1.1.4-fix1: short tokens (≤4 chars or all-caps acronyms) need
  // word-boundary matching, not naive substring. Without it, "bas" matches
  // "based", "ats" matches "thermostats", "mop" matches "compose", etc.,
  // and the absent_signals check spuriously suppresses the rule. We mirror
  // the §A1 auto-classification used elsewhere in the engine.
  const wdRule = taxonomy.description_disqualifiers.wrong_discipline_it;
  if (wdRule) {
    const indicatorHits = wdRule.indicators.filter(p => disqualifierMatch(descLower, p));
    if (indicatorHits.length >= wdRule.min_indicators) {
      const cftSignalHits = wdRule.absent_signals.filter(p => disqualifierMatch(descLower, p));
      if (cftSignalHits.length === 0) {
        return rejectResult(
          base,
          `Wrong discipline: IT data center role (better fit for IT Support / Networking program) — IT signals: ${indicatorHits.slice(0, 3).join(', ')}${indicatorHits.length > 3 ? `…` : ''}`,
        );
      }
    }
  }

  // ─── Geographic filter ───
  const lat = job.lats_derived?.[0];
  const lng = job.lngs_derived?.[0];
  let distanceMiles: number | null = null;
  if (lat != null && lng != null) {
    distanceMiles = haversineMiles(campus.lat, campus.lng, lat, lng);
    if (distanceMiles > campus.radiusMiles) {
      return {
        ...rejectResult(base, `Outside ${campus.radiusMiles}mi radius (${distanceMiles.toFixed(1)}mi)`),
        distanceMiles,
      };
    }
  }

  // ─── Experience-level hard reject ───
  if (job.ai_experience_level && taxonomy.experience_filter.auto_reject_levels.includes(job.ai_experience_level)) {
    return rejectResult(base, `Experience level too high (${job.ai_experience_level})`);
  }

  // ─── Title tier ───
  let titleTier: 'A' | 'B' | 'C' | 'D' | null = null;
  let titleMatched: string | null = null;
  let titleScore = 0;

  for (const tier of ['A', 'B', 'C', 'D'] as const) {
    const tierSpec = taxonomy.title_tiers[tier];
    for (const phrase of tierSpec.phrases) {
      if (titleLower.includes(phrase)) {
        titleTier = tier;
        titleMatched = phrase;
        titleScore = tierSpec.score;
        break;
      }
    }
    if (titleTier) break;
  }

  if (titleTier === null) {
    return rejectResult(base, 'No title tier match', distanceMiles);
  }

  // ─── Skills (core, specialized, bonus) ───
  const coreMatched = matchSkillEntries(allText, taxonomy.core_skills.skills);
  const specializedMatched = matchSkillEntries(allText, taxonomy.specialized_skills.skills);
  const bonusMatchedRaw = matchSkillEntries(allText, taxonomy.bonus_skills.skills);
  const industryMatched = matchPhrases(combinedTitleDesc, taxonomy.industry_context.phrases);
  const certsMatched = matchSkillEntries(allText, taxonomy.certifications.certs);

  // Tier B verification (§C v1.1.3 — two-stage demotion).
  //
  // 1) `score_if_no_industry_context` (new) — if this tier has the option set
  //    and zero industry-context phrases matched in title+description, the
  //    title score collapses to that value (typically 0). Catches the
  //    "Tier B title + generic building-trade skills + no DC signal"
  //    false-positive pattern (Cushman observation).
  //
  // 2) `score_if_unverified` (existing) — otherwise, if too few core skills
  //    matched, drop the title score to the unverified value. The original
  //    quality gate; covers cases where a JD has DC-context vocabulary but
  //    the actual skill content is thin.
  //
  // Stage 1 takes precedence: a job with NO industry context shouldn't get
  // any Tier B title points even if the skill bucket is full. Stage 2 only
  // fires when stage 1 either isn't configured or didn't trip.
  if (titleTier === 'B') {
    const tierB = taxonomy.title_tiers.B;
    if (tierB.score_if_no_industry_context !== undefined && industryMatched.length === 0) {
      titleScore = tierB.score_if_no_industry_context;
    } else {
      const minRequired = tierB.min_core_skills_to_verify ?? 4;
      if (coreMatched.length < minRequired) {
        titleScore = tierB.score_if_unverified ?? 10;
      }
    }
  }

  // Tier D requires healthcare context
  const tags: string[] = [];
  if (titleTier === 'C' && taxonomy.title_tiers.C.tag) {
    tags.push(taxonomy.title_tiers.C.tag);
  }
  if (titleTier === 'D') {
    // §A4: also accept a watchlist-employer match in any category flagged
    // is_healthcare as a valid healthcare-context signal. Catches roles like
    // "Stationary Engineer" at Northside Hospital where the description writer
    // says "our facility" instead of "the hospital".
    const healthcareEmployers = Object.values(taxonomy.employer_watchlist.categories)
      .filter(c => c.is_healthcare)
      .flatMap(c => c.employers);
    const hasHealthcareContext =
      taxonomy.healthcare_context.phrases.some(h => combinedTitleDesc.includes(h)) ||
      (job.linkedin_org_industry || '').toLowerCase().includes('hospital') ||
      (job.linkedin_org_industry || '').toLowerCase().includes('health care') ||
      healthcareEmployers.some(e => orgLower.includes(e));
    if (!hasHealthcareContext) {
      return rejectResult(base, 'Tier D title without healthcare context', distanceMiles);
    }
    if (taxonomy.title_tiers.D.tag) tags.push(taxonomy.title_tiers.D.tag);
  }
  // §A3 (v1.1.0): the legacy HEALTHCARE_CONTEXT tag was a workaround for the
  // tier/tag coupling. Tags are now applied via the rule-based applyTags() pass
  // (§B3) below, after all matches are collected.

  // Bonus skills only count when paired with core or industry signal
  const bonusGateOk =
    !taxonomy.bonus_skills.requires_core_or_industry_match ||
    coreMatched.length >= 1 ||
    industryMatched.length >= 1;
  const bonusMatched = bonusGateOk ? bonusMatchedRaw : [];

  // Compute scores (capped)
  const coreScore = Math.min(coreMatched.length * taxonomy.core_skills.weight_per_match, taxonomy.core_skills.max_score);
  const specializedScore = Math.min(specializedMatched.length * taxonomy.specialized_skills.weight_per_match, taxonomy.specialized_skills.max_score);
  const bonusScore = Math.min(bonusMatched.length * taxonomy.bonus_skills.weight_per_match, taxonomy.bonus_skills.max_score);
  const industryScore = Math.min(industryMatched.length * taxonomy.industry_context.weight_per_match, taxonomy.industry_context.max_score);
  const certsScore = Math.min(certsMatched.length * taxonomy.certifications.weight_per_match, taxonomy.certifications.max_score);

  // Employer watchlist (§B4: categories now {is_healthcare, employers}).
  const allWatchlistEmployers = Object.values(taxonomy.employer_watchlist.categories)
    .flatMap(c => c.employers);
  const employerHit = allWatchlistEmployers.some(e => orgLower.includes(e));
  const employerScore = employerHit ? taxonomy.employer_watchlist.weight_per_match : 0;
  if (employerHit) tags.push('WATCHLIST_EMPLOYER');

  // §A3 (v1.1.0): rule-based tags, evaluated independently of titleTier.
  // Tier C/D `tag` field (added above) acts as a fallback for tier-aligned jobs
  // that don't satisfy the rules. Set-dedup keeps the array clean.
  const ruleTags = applyTags(taxonomy, {
    matchedCanonicals: new Set([
      ...coreMatched,
      ...specializedMatched,
      ...bonusMatched,
      ...certsMatched,
    ]),
    combinedTitleDesc,
    orgLower,
    industryLower: (job.linkedin_org_industry || '').toLowerCase(),
  });
  for (const t of ruleTags) {
    if (!tags.includes(t)) tags.push(t);
  }

  // Experience penalty (post-fetch tightening)
  let experiencePenalty = 0;
  if (job.ai_experience_level === '2-5') {
    const patterns = taxonomy.experience_filter.post_fetch_penalty.patterns.map(p => new RegExp(p, 'i'));
    if (patterns.some(re => re.test(descLower))) {
      experiencePenalty = taxonomy.experience_filter.post_fetch_penalty.penalty;
    }
  }

  // Total
  const rawScore =
    titleScore + coreScore + specializedScore + bonusScore + industryScore + certsScore + employerScore;
  const finalScore = Math.max(0, rawScore - experiencePenalty);

  // Confidence bucket
  const t = taxonomy.scoring.thresholds;
  let confidence: Confidence;
  if (finalScore >= t.high) confidence = 'HIGH';
  else if (finalScore >= t.medium) confidence = 'MEDIUM';
  else if (finalScore >= t.low) confidence = 'LOW';
  else confidence = 'REJECT';

  return {
    ...base,
    confidence,
    score: finalScore,
    titleTier,
    titleMatched,
    titleScore,
    coreMatched,
    coreScore,
    specializedMatched,
    specializedScore,
    bonusMatched,
    bonusScore,
    industryMatched,
    industryScore,
    certsMatched,
    certsScore,
    employerHit,
    employerScore,
    experiencePenalty,
    distanceMiles,
    tags,
    rejectionReason: null,
  };
}

// ============================================================================
// HELPERS
// ============================================================================
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill matching (§A1 word-boundary matching)
// ─────────────────────────────────────────────────────────────────────────────
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Pick the effective match mode for a skill entry.
 * Explicit `entry.match_mode` always wins. Otherwise: any form ≤4 chars or all-caps
 * acronym → 'word'; else 'substring'.
 */
export function getEffectiveMatchMode(entry: SkillEntry): MatchMode {
  if (entry.match_mode) return entry.match_mode;
  for (const form of entry.forms) {
    if (form.length <= 4) return 'word';
    if (/^[A-Z0-9]+$/.test(form)) return 'word';
  }
  return 'substring';
}

/**
 * Whole-word match with optional trailing 's' for plurals (ATSs, SOPs, MOPs, …).
 * Note: this admits a small set of false positives (e.g. 'bas' matches 'bass') —
 * acceptable for this domain; documented in §F summary.
 */
function buildWordRegex(form: string): RegExp {
  const escaped = form.replace(REGEX_META, '\\$&');
  return new RegExp(`\\b${escaped}s?\\b`, 'i');
}

function matchesForm(text: string, form: string, mode: MatchMode): boolean {
  const lower = form.toLowerCase();
  if (mode === 'substring') return text.includes(lower);
  return buildWordRegex(lower).test(text);
}

/**
 * Phrase match for the v1.1.4 wrong_discipline_it rule (and any future
 * disqualifier list of bare phrases). Auto-classifies short / all-caps
 * tokens as word-boundary matches — same heuristic as the skill-form
 * auto-classifier — so 'bas' does not match 'based', 'ats' does not match
 * 'thermostats', 'mop' does not match 'compose', etc.
 *
 * Multi-word phrases (≥5 chars with a space) use plain substring since
 * collisions are vanishingly rare and word-boundary regex over phrases
 * with punctuation gets brittle.
 */
function disqualifierMatch(text: string, phrase: string): boolean {
  const lower = phrase.toLowerCase();
  // ≤4 char tokens, or single tokens of all-letters/digits → word-boundary.
  // Examples that need this: ats, bas, bms, pdu, rpp, mop, eop, sop, ups,
  // loto, crac, crah, rma, cmms.
  const isShortOrAcronym =
    lower.length <= 4 || /^[a-z0-9_-]+$/i.test(lower);
  if (isShortOrAcronym && !lower.includes(' ')) {
    return buildWordRegex(lower).test(text);
  }
  return text.includes(lower);
}

function matchSkillEntries(text: string, entries: SkillEntry[]): string[] {
  const matched = new Set<string>();
  for (const entry of entries) {
    const mode = getEffectiveMatchMode(entry);
    for (const form of entry.forms) {
      if (matchesForm(text, form, mode)) {
        matched.add(entry.canonical);
        break;
      }
    }
  }
  return Array.from(matched);
}

function matchPhrases(text: string, phrases: string[]): string[] {
  return phrases.filter(p => text.includes(p.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────────────
// §A2 — experience disqualifier (regex + numeric threshold + proximity gate)
// ─────────────────────────────────────────────────────────────────────────────
const SPELLED_NUM: Record<string, number> = {
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseYearCount(captured: string): number | null {
  if (/^\d+$/.test(captured)) return parseInt(captured, 10);
  const n = SPELLED_NUM[captured.toLowerCase()];
  return typeof n === 'number' ? n : null;
}

const REQUIRED_WORD_RE = /\b(?:required|must|needs?|needed|essential|mandatory)\b/gi;
const REQUIRED_PROXIMITY_CHARS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// §A3 / §B3 — rule-based tag application, independent of titleTier.
// ─────────────────────────────────────────────────────────────────────────────
interface ApplyTagsContext {
  matchedCanonicals: Set<string>;
  combinedTitleDesc: string;
  orgLower: string;
  industryLower: string;
}

/**
 * Evaluate every tag definition in `taxonomy.tags` against the job's match
 * results. A tag fires if ANY of its rule clauses is satisfied (OR semantics).
 * Skip safely if the taxonomy doesn't define `tags` (back-compat with v1.0.0).
 */
export function applyTags(taxonomy: Taxonomy, ctx: ApplyTagsContext): string[] {
  if (!taxonomy.tags) return [];
  const fired: string[] = [];
  for (const [tagName, tagDef] of Object.entries(taxonomy.tags)) {
    if (!tagDef || typeof tagDef !== 'object' || !tagDef.rules) continue;
    const r = tagDef.rules;
    let satisfied = false;

    if (!satisfied && r.any_of_skills?.length) {
      const min = r.min_matches ?? 1;
      const hits = r.any_of_skills.filter(s => ctx.matchedCanonicals.has(s)).length;
      if (hits >= min) satisfied = true;
    }
    if (!satisfied && r.any_of_employer_categories?.length) {
      for (const catName of r.any_of_employer_categories) {
        const cat = taxonomy.employer_watchlist.categories[catName];
        if (cat && cat.employers.some(e => ctx.orgLower.includes(e))) {
          satisfied = true;
          break;
        }
      }
    }
    if (!satisfied && r.any_of_phrases?.length) {
      if (r.any_of_phrases.some(p => ctx.combinedTitleDesc.includes(p.toLowerCase()))) {
        satisfied = true;
      }
    }
    if (!satisfied && r.any_of_industries?.length) {
      if (r.any_of_industries.some(s => ctx.industryLower.includes(s.toLowerCase()))) {
        satisfied = true;
      }
    }

    if (satisfied) fired.push(tagName);
  }
  return fired;
}

/**
 * Returns a rejection reason string if the description should be rejected on
 * experience grounds, else null. See §A2.
 */
export function checkExperienceDisqualifier(
  descLower: string,
  cfg: { max_years_allowed: number; patterns: string[] },
): string | null {
  if (!cfg || !cfg.patterns?.length) return null;

  // Find positions of all "required"-class words; reused across pattern scans.
  const requiredPositions: number[] = [];
  REQUIRED_WORD_RE.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = REQUIRED_WORD_RE.exec(descLower)) !== null) {
    requiredPositions.push(rm.index);
    if (rm.index === REQUIRED_WORD_RE.lastIndex) REQUIRED_WORD_RE.lastIndex++; // safety against zero-width
  }

  for (const patternSrc of cfg.patterns) {
    let re: RegExp;
    try {
      re = new RegExp(patternSrc, 'gi');
    } catch {
      // Skip malformed patterns rather than crashing the whole engine.
      continue;
    }
    let match: RegExpExecArray | null;
    while ((match = re.exec(descLower)) !== null) {
      // The number-of-years capture is the first non-undefined capture group.
      const captured = match.slice(1).find(c => c != null);
      if (!captured) {
        if (match.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      const years = parseYearCount(captured);
      if (years == null || years <= cfg.max_years_allowed) {
        if (match.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      const matchStart = match.index;
      const near = requiredPositions.some(p => Math.abs(p - matchStart) <= REQUIRED_PROXIMITY_CHARS);
      if (near) {
        return `Description requires >${cfg.max_years_allowed} years experience: "${match[0].trim()}"`;
      }
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }
  return null;
}

function rejectResult(
  base: Pick<ScoreResult, 'jobId' | 'title' | 'organization'>,
  reason: string,
  distanceMiles: number | null = null
): ScoreResult {
  return {
    ...base,
    confidence: 'REJECT',
    score: 0,
    titleTier: null,
    titleMatched: null,
    titleScore: 0,
    coreMatched: [],
    coreScore: 0,
    specializedMatched: [],
    specializedScore: 0,
    bonusMatched: [],
    bonusScore: 0,
    industryMatched: [],
    industryScore: 0,
    certsMatched: [],
    certsScore: 0,
    employerHit: false,
    employerScore: 0,
    experiencePenalty: 0,
    distanceMiles,
    tags: [],
    rejectionReason: reason,
  };
}

export type { Taxonomy, JobPayload, CampusContext, ScoreResult, Confidence };
