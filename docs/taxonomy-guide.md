# Taxonomy Guide

A taxonomy is the curriculum-derived schema that maps a Per Scholas role family (e.g., CFT) to the signals we look for in job postings: titles, skills, certifications, employer types, exclusions, and rule-based tags. The scoring engine consumes taxonomies as input — it has no built-in knowledge of any specific role.

This guide covers how the CFT taxonomy is structured (schema **v1.1.0**), how scoring works, how to tune it, and how to add a new role family. For the rationale behind individual fields, see `SCORING_ADDENDUM.md`.

---

## File location

Taxonomies live in two places:

1. **Source of truth** — versioned JSON in `packages/taxonomy/schemas/<role_id>.json`. Committed to git.
2. **Runtime copy** — the `taxonomies` table in Supabase. The seed script copies the JSON file into this table. Scoring reads from the table, not the file.

When you edit a taxonomy, the workflow is:

```
edit packages/taxonomy/schemas/cft.json
  ↓ bump `version` (semver — patch for tweaks, minor for additive fields, major for shape changes)
  ↓ commit + push
  ↓ run `pnpm db:seed-taxonomy` (idempotent; deactivates the previous active row, inserts the new one as active)
  ↓ next fetch (or manual re-score) uses the new version
```

Old versions are preserved in the `taxonomies` table. Score rows reference the taxonomy version they were computed against, so you can compare scores across versions for the same job.

---

## Anatomy of a taxonomy (v1.1.0)

```jsonc
{
  "role_id": "cft",
  "role_name": "Critical Facilities Technician",
  "version": "1.1.0",
  "version_notes": "v1.1.0 (2026-04-27, pre-fetch addendum pass): §A1…",
  "active": true,

  // ─── Title tiers — each is an OBJECT, not a bare array ─────────────────
  "title_tiers": {
    "A": {
      "description": "Core target titles — direct synonyms.",
      "score": 40,
      "phrases": ["critical facilities technician", "data center technician", …]
    },
    "B": {
      "description": "Adjacent titles — could be a great fit or could be janitorial.",
      "score": 25,
      "score_if_unverified": 10,
      "min_core_skills_to_verify": 4,
      "phrases": ["facilities technician", "building engineer", …]
    },
    "C": {
      "description": "Building-automation specialization.",
      "score": 20,
      "tag": "BAS_TRACK",                 // fallback tag for tier-aligned jobs
      "phrases": ["building automation technician", "bas technician", …]
    },
    "D": {
      "description": "Healthcare-facility subset.",
      "score": 25,
      "tag": "HEALTHCARE_TRACK",          // fallback tag
      "requires_healthcare_context": true,
      "phrases": ["plant operations engineer", "stationary engineer", …]
    }
  },

  // ─── Title exclusions — title-level hard rejects, run BEFORE tier match ─
  "title_exclusions": {
    "seniority":            ["senior", "sr.", "lead", "principal", "manager", " iii", " iv", " v", …],
    "wrong_discipline":     ["electrical engineer", "network engineer", "software engineer", …],
    "controls_programming": ["plc programmer", "systems engineer", …]
  },

  // ─── Description disqualifiers ─────────────────────────────────────────
  "description_disqualifiers": {
    // Literal-string list. Hits anywhere in description → reject.
    "credentials": ["bachelor's degree required", "pe license required", …],

    // §A2: regex-based experience filter with a numeric threshold and a
    // proximity-to-required-word gate. Each pattern's first non-empty capture
    // group is the year-count (digit or spelled-out three…ten). The match
    // rejects iff (years > max_years_allowed) AND a "required"-class word
    // (required|must|need(s|ed)?|essential|mandatory) sits within ±50 chars
    // of the match start. This is what lets the engine pass "5+ years
    // preferred" while still rejecting "5+ years required".
    "experience": {
      "max_years_allowed": 3,
      "patterns": [
        "(\\d+)\\)?\\+?\\s*(?:to\\s*\\d+\\s*)?years?'?\\s+(?:of\\s+)?(?:experience|exp\\b)",
        "(?:minimum|at least|requires?)\\s+(?:of\\s+)?(\\d+|three|four|…|ten)\\+?\\s*years?",
        "(\\d+)\\s*[-–—]\\s*\\d+\\s*years?'?\\s+(?:of\\s+)?(?:experience|exp\\b)",
        "\\b(three|four|…|ten)\\+?\\s*years?\\b",
        "\\b(\\d+)\\+\\s*years?\\b"
      ]
    }
  },

  // ─── Skill buckets — each entry is a SkillEntry, not a bare string ─────
  "core_skills": {
    "weight_per_match": 8,
    "max_score": 40,
    "skills": [
      {
        "canonical": "UPS",
        // First form is the most common one for that skill; rest are variants.
        "forms": ["ups", "uninterruptible power supply"],
        // match_mode is OPTIONAL. If omitted, the engine auto-classifies:
        // any form ≤4 chars OR all-caps acronym → 'word' (regex \bform\b
        // with optional trailing 's' for plurals). Otherwise → 'substring'.
        // See §A1. Set explicitly only when you need to override the default.
        "match_mode": "word",
        "curriculum_module": "UCI 2137 / Module 2"
      },
      …
    ]
  },
  "specialized_skills": { "weight_per_match": 4, "max_score": 20, "skills": [ … ] },
  "bonus_skills":       { "weight_per_match": 1, "max_score": 5, "requires_core_or_industry_match": true, "skills": [ … ] },
  "industry_context":   { "weight_per_match": 3, "max_score": 10, "phrases": [ "mission critical", "data center", "hyperscale", … ] },
  "healthcare_context": { "phrases": ["hospital", "medical center", "healthcare facility", "health system"] },
  "certifications":     { "weight_per_match": 5, "max_score": 15, "certs": [ … same SkillEntry shape … ] },

  // ─── Employer watchlist — categories carry metadata (§B4) ──────────────
  // Each category is { is_healthcare: boolean, employers: string[] }.
  // is_healthcare:true categories feed BOTH the +5 watchlist score AND the
  // §A4 Tier D healthcare gate AND the HEALTHCARE_TRACK rule (via
  // any_of_employer_categories).
  "employer_watchlist": {
    "weight_per_match": 5,
    "categories": {
      "hyperscale_cloud":    { "is_healthcare": false, "employers": ["microsoft", "google", "meta", …] },
      "colocation_wholesale":{ "is_healthcare": false, "employers": ["qts", "equinix", "digital realty", …] },
      "telecom":             { "is_healthcare": false, "employers": [ … ] },
      "healthcare_atlanta":  { "is_healthcare": true,  "employers": ["emory healthcare", "piedmont", "northside hospital", …] },
      "facilities_services": { "is_healthcare": false, "employers": ["jll", "cbre", "cushman & wakefield", …] }
    }
  },

  // ─── Top-level tags — rule-based, evaluated independently of titleTier ─
  // §A3 / §B3. A tag fires if ANY of its present clauses is satisfied (OR
  // across clauses). Rule clauses available:
  //   any_of_skills: [canonicals...]   min_matches?: number (default 1)
  //   any_of_employer_categories: [category names...]
  //   any_of_phrases: [substrings searched in title+description]
  //   any_of_industries: [substrings searched in linkedin_org_industry]
  // Tier C/D `tag` fields above remain as a tier-aligned FALLBACK for jobs
  // that don't satisfy any rule clause.
  "tags": {
    "BAS_TRACK": {
      "description": "Strong building-automation signal regardless of title tier.",
      "rules": {
        "any_of_skills": ["BACnet", "Modbus", "PLC", "BMS/BAS", "Ladder Logic", "PID Control"],
        "min_matches": 2
      }
    },
    "HEALTHCARE_TRACK": {
      "description": "Healthcare facility employer, or strong healthcare context.",
      "rules": {
        "any_of_employer_categories": ["healthcare_atlanta"],
        "any_of_phrases": ["hospital", "medical center", "healthcare facility", "health system"],
        "any_of_industries": ["hospital", "health care"]
      }
    }
  },

  // ─── Experience-level filter (RapidAPI's ai_experience_level field) ────
  "experience_filter": {
    "api_levels_allowed": ["0-2", "2-5"],
    "auto_reject_levels": ["5-10", "10+"],
    "post_fetch_penalty": { "patterns": [ … ], "penalty": 10 }
  },

  // ─── Geography ──────────────────────────────────────────────────────────
  // ⚠ §B5: this is the DEFAULT only. Per-campus radius overrides do NOT
  // belong in the taxonomy — they belong on the `campuses` (or
  // `campus_roles`) table. Adding a per-campus field here would couple
  // role/curriculum content to deployment geography. Don't.
  "geography": { "default_radius_miles": 100 },

  "scoring": {
    "thresholds": { "high": 75, "medium": 50, "low": 30 }
  }
}
```

The TypeScript types for everything above live in `packages/scoring/src/types.ts`. The runtime validator lives in `packages/taxonomy/src/index.ts` (currently shape-light + a §A6 overlap warning; full Zod validation is a deferred enhancement).

---

## How the scoring engine evaluates a job

Source of truth: `packages/scoring/src/index.ts → scoreJob()`. The order matters and is deliberate — exclusions run before any matching so a junk title never accumulates score.

1. **Title exclusions.** Concatenate `title_exclusions.{seniority, wrong_discipline, controls_programming}` and substring-test against the lowercased title. Any hit → REJECT immediately, with reason listing the patterns that fired.
2. **Description disqualifier — credentials.** Substring-test the literal credential strings (`bachelor's degree required`, `pe license required`, …). Any hit → REJECT.
3. **Description disqualifier — experience (§A2).** Run `checkExperienceDisqualifier` with the configured patterns. For each pattern match, parse the captured year-count (digit or spelled three…ten). Reject only when `years > max_years_allowed` **and** a "required"-class word sits within ±50 chars of the match. This passes "5+ years preferred" while rejecting "5+ years required" or "5 to 7 years of experience required."
4. **Geofence.** If the job has coordinates (`lats_derived[0]`, `lngs_derived[0]`), compute haversine miles to the campus center; if it exceeds `campus.radiusMiles`, REJECT and record `distanceMiles` on the result.
5. **Experience-level hard reject.** If `ai_experience_level` is in `experience_filter.auto_reject_levels` (e.g., `5-10`, `10+`), REJECT.
6. **Title tier match.** Walk tiers A → D in order. The first phrase (substring) match in the lowercased title wins; record `titleTier`, `titleMatched`, `titleScore = tiers[T].score`. If no tier matches, REJECT with reason `No title tier match`. (This rejection bucket is the canonical feedback loop for taxonomy gaps; watch it after first fetch — see §C.)
7. **Skill matching.** For each skill bucket (core, specialized, bonus, certifications) call `matchSkillEntries(allText, entries)`. For each entry, the effective `match_mode` is determined by `getEffectiveMatchMode`: explicit `match_mode` wins; otherwise the auto-rule fires `'word'` for any form ≤4 chars or all-caps acronym, else `'substring'`. Word mode uses `\bform_s?\b` (plural-friendly). The first matching form per entry adds the entry's `canonical` to the matched set; duplicates within an entry don't double-count. Industry-context phrases use plain substring match.
8. **Tier B verification.** If `titleTier === 'B'` and `coreMatched.length < min_core_skills_to_verify` (default 4), drop `titleScore` to `score_if_unverified` (default 10). This is what stops a Maintenance Technician at a school district from scoring like a real CFT-aligned facilities tech.
9. **Tier D healthcare gate (§A4).** If `titleTier === 'D'`, accept the job only if at least one of: a `healthcare_context.phrases` hit on title+description, `linkedin_org_industry` contains `hospital` or `health care`, **or** the organization name matches an employer in any category flagged `is_healthcare: true` (e.g., a "Stationary Engineer" at Northside Hospital where the description writer just said "our facility"). Otherwise REJECT with `Tier D title without healthcare context`.
10. **Tier C/D fallback tag.** If the matching tier defines a `tag`, push it onto the result's `tags` (e.g., Tier C → `BAS_TRACK`). This is the back-compat path for tier-aligned jobs that don't satisfy any rule clause in step 13.
11. **Bonus gating.** Bonus skills only count if `core_skills.length >= 1` **or** `industry_context.length >= 1` (controlled by `bonus_skills.requires_core_or_industry_match`). Without this gate, manufacturing-floor maintenance jobs full of pumps/valves/hydraulics over-score.
12. **Component scores.** Each bucket contributes `min(matched.length × weight_per_match, max_score)`. Watchlist employer adds `weight_per_match` (default 5) once on any match; the result is `WATCHLIST_EMPLOYER` is appended to `tags`.
13. **Rule-based tags (§A3).** `applyTags()` evaluates every entry in `taxonomy.tags` against the collected matches (`coreMatched ∪ specializedMatched ∪ bonusMatched ∪ certsMatched` for `any_of_skills`; `org` for `any_of_employer_categories`; combined title+description for `any_of_phrases`; `linkedin_org_industry` for `any_of_industries`). Each tag fires if **any** of its present clauses is satisfied. Tags are de-duplicated against the fallback set from step 10 — no duplicates in the final `tags` array.
14. **Experience penalty.** If `ai_experience_level === '2-5'` and any `experience_filter.post_fetch_penalty.patterns` regex matches the description, subtract the configured `penalty` (default 10) from the raw score. Recorded in `experiencePenalty` for audit.
15. **Confidence bucketing.** `final = max(0, raw − penalty)`. Bucket against `scoring.thresholds.{high, medium, low}`: HIGH ≥ 75, MEDIUM ≥ 50, LOW ≥ 30, otherwise REJECT (note: scores below `low` are still recorded for trend analysis).

Every step's contribution is preserved in `ScoreResult` (`coreMatched`, `coreScore`, `specializedMatched`, `tags`, `rejectionReason`, …), so any decision can be reconstructed from the row.

---

## Tuning the taxonomy

After 2–4 weeks of real Atlanta data, you'll likely tune. Common moves and where they go:

**Title under-coverage** ("genuine fits in the No-tier-match reject bucket")
Add new phrases to `title_tiers.A.phrases` or B/C/D as appropriate. Don't add senior synonyms to A — they should be in `title_exclusions.seniority`. Bump `version` (patch).

**Title over-coverage** ("Senior Critical Facilities Engineer" leaked through, etc.)
Extend `title_exclusions`. Most leaks are roman-numeral level suffixes or new senior synonyms.

**Skill false positives from short tokens** (e.g., "ats" matching `thermostats`)
Either set the entry's `match_mode: "word"` explicitly, or — preferred — fix the `forms` list to avoid forms ≤4 chars where the auto-classifier won't already help. The §A1 auto-rule should catch most of these without intervention.

**Experience filter false positives** ("5+ years preferred" being rejected)
The proximity gate should already prevent this. If it doesn't, raise `max_years_allowed` (currently 3) or refine `description_disqualifiers.experience.patterns` so the capture group is tighter. **Test changes against `tests/scoring.test.ts → §A2` regressions before bumping the version.**

**A skill is missing**
Add a `SkillEntry` to the right bucket. Use multiple `forms` aggressively — the more variants, the higher recall. Set `match_mode` only when the auto-classifier picks the wrong default (rare).

**An employer's postings consistently miss**
Add the company to the appropriate `employer_watchlist.categories.<category>.employers` list. If they're a hospital system not yet in `healthcare_atlanta`, adding them there does triple duty: +5 on score, satisfies the §A4 Tier D gate, fires `HEALTHCARE_TRACK`.

**A new tag is needed** (e.g., `EDGE_TRACK` for edge data centers)
Add a top-level `tags.<NAME>` entry with rule clauses. No engine code change required. If you want a tier-aligned fallback, also set `tag` on the relevant tier.

**Scoring engine itself needs to change**
That's a code change in `packages/scoring/src/index.ts`, not a taxonomy edit. Add tests under the existing §A* describe blocks to lock in the new behavior. Coordinate with anyone running re-scores on existing job data.

Always bump `version` (semver) after edits. Compare old vs new via:

```sql
-- How many jobs changed confidence between v1.1.0 and v1.2.0?
WITH v1 AS (
  SELECT job_id, confidence AS v1_conf, score AS v1_score
  FROM public.job_scores
  WHERE taxonomy_id = (SELECT id FROM taxonomies WHERE role_id='cft' AND version='1.1.0')
), v2 AS (
  SELECT job_id, confidence AS v2_conf, score AS v2_score
  FROM public.job_scores
  WHERE taxonomy_id = (SELECT id FROM taxonomies WHERE role_id='cft' AND version='1.2.0')
)
SELECT v1_conf, v2_conf, count(*)
FROM v1 JOIN v2 USING (job_id)
WHERE v1_conf IS DISTINCT FROM v2_conf
GROUP BY 1, 2;
```

---

## Adding a new role family

Say you want to add Cybersecurity Analyst (CSA).

**1. Add the role record.** New migration `0003_add_csa.sql`:

```sql
INSERT INTO public.roles (id, name, short_name, uci_code, description, soc_codes, cip_codes, certifications, active)
VALUES (
  'csa',
  'Cybersecurity Analyst',
  'CSA',
  'UCI XXXX',
  'Description of the program...',
  ARRAY['15-1212', '15-1244'],
  ARRAY['11.1003'],
  ARRAY['CompTIA Security+', 'CySA+'],
  true
);

-- Activate it for whatever campuses run it.
INSERT INTO public.campus_roles (campus_id, role_id, active) VALUES
  ('atlanta', 'csa', true),
  ('new_york_city', 'csa', true)
ON CONFLICT DO NOTHING;
```

**2. Build the taxonomy.** Create `packages/taxonomy/schemas/csa.json` modeled on `cft.json`. Same shape — title_tiers as objects, skill buckets as `{weight_per_match, max_score, skills: [SkillEntry, …]}`, employer_watchlist with `{is_healthcare, employers}` per category, `tags` block. CSA-specific content:

- Tier A titles: SOC Analyst, Cybersecurity Analyst, Security Operations Analyst.
- Tier B: IT Security Analyst, Information Security Analyst.
- Core skills: SIEM, Splunk, EDR, incident response, threat hunting, log analysis, network forensics. Watch the auto-classifier — `siem`, `edr` will go to word mode automatically.
- Specialized: MITRE ATT&CK, YARA, Sigma rules.
- Industry context: SOC, MSSP, financial services, healthcare. (`soc` may collide with "society" — set `match_mode: "word"` explicitly.)
- Certifications: Security+, CySA+, GCIH, CEH.
- Description disqualifiers: same Bachelor's/credential list; experience config can stay `{max_years_allowed: 3, patterns: <same five>}` initially.
- Tags: maybe `SOC_TIER_1` and `IR_FOCUS` rule sets. Pick what slices the dashboard usefully.

**3. Update `packages/db/seeds/seed-taxonomy.ts`.** It already iterates every `*.json` in `packages/taxonomy/schemas/`, so just dropping `csa.json` next to `cft.json` is enough. The script will pick it up on next run, soft-validate the v1.1.0 shape, and INSERT it as the active row for `role_id='csa'`.

**4. Run migration + seed:**

```bash
psql "$DATABASE_URL" -f packages/db/migrations/0003_add_csa.sql
pnpm db:seed-taxonomy
```

**5. Trigger a fetch.** In v1, the dashboard is hardcoded to CFT/Atlanta. Phase 2 adds the role/campus selector. Until then, manual fetch via the API:

```bash
curl -X POST https://your-vercel-url/api/fetch \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin session cookie>" \
  -d '{"campus_id":"atlanta","role_id":"csa","trigger_type":"manual"}'
```

---

## What lives in the taxonomy vs the scoring engine

Anything role-specific lives in the taxonomy JSON. The scoring engine is taxonomy-agnostic — it implements the matching algorithm but knows nothing about UPS, BACnet, hospitals, or SIEMs.

This means:

- Adding a new skill or new title phrase = JSON edit, no code change.
- Adding a new role family = new JSON file, no code change.
- Adding a new rule-based tag = new entry under `tags`, no code change.
- Changing the matching algorithm itself (new exclusion mechanic, new tag clause type, different bucket math) = code change in `packages/scoring/src/index.ts`, with corresponding TypeScript types in `types.ts` and a JSON-shape update reflected in the validator.

Keep this separation strict. If you find yourself wanting to add a hardcoded role-specific check to the engine, instead expand the schema (and the `Taxonomy` type in `types.ts`).

One thing that explicitly does **not** belong in the taxonomy: per-campus geography. The taxonomy describes a role; campuses describe deployment geography. `geography.default_radius_miles` is a per-role default; per-campus overrides go on the `campuses` (or `campus_roles`) table. See §B5 in `SCORING_ADDENDUM.md`.
