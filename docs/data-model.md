# Data Model

Reference for the Supabase Postgres schema. Generated from `supabase/migrations/0001_initial.sql`. When the schema changes, update both.

---

## Entity relationship overview

```
auth.users (Supabase managed)
    │ 1:1
    ▼
public.users (id, email, role)
    │
    │ admin actions ──► audit_log
    │
    ▼
public.campuses ◄──┐
    │              │
    │ many-to-many │ via campus_roles
    │              │
public.roles ◄─────┘
    │
    │ 1:many
    ▼
public.taxonomies (versioned per role)
    │
    │ 1:many
    ▼
public.job_scores ◄── public.jobs
    ▲                      ▲
    │                      │
public.fetch_runs ─────────┘
    │
    │ 1:many
    ▼
public.api_usage (snapshot per fetch)
```

---

## Tables

### `users`
Mirrors `auth.users` with our app-level role.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK to `auth.users.id` |
| `email` | text UNIQUE | |
| `full_name` | text | from Google OAuth metadata |
| `role` | enum | `admin` \| `viewer`; defaults `viewer` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

A trigger on `auth.users` insert populates this row automatically. Two emails (`shahparan.hasnat@gmail.com`, `ashahparan@perscholas.org`) get `admin` role; everyone else gets `viewer`.

---

### `campuses`
17 Per Scholas campuses preloaded.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | slug e.g. `atlanta`, `new_york_city` |
| `name` | text | display name |
| `address`, `city`, `state`, `postal_code` | text | |
| `lat`, `lng` | double precision | for geofencing |
| `default_radius_miles` | int | default search radius |
| `active` | boolean | |

Atlanta is set to 100mi radius; others default 50mi. Adjust per campus as needed.

---

### `roles`
Curriculum-aligned role families. v1 has one: `cft`.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | slug e.g. `cft`, `csa` |
| `name`, `short_name`, `uci_code` | text | |
| `soc_codes` | text[] | BLS occupation codes |
| `cip_codes` | text[] | DoE program codes |
| `certifications` | text[] | required certs |

---

### `campus_roles`
Many-to-many junction. Determines which campuses run which programs.

| Column | Type | Notes |
|---|---|---|
| `campus_id` | text PK FK | |
| `role_id` | text PK FK | |
| `active` | boolean | flip to `true` to start tracking that combo |
| `cohort_start_date` | date | optional |
| `notes` | text | |

v1: only `(atlanta, cft)` is `active=true`.

---

### `taxonomies`
Versioned scoring schemas. One row per (role, version).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `role_id` | text FK | |
| `version` | int | monotonic per role |
| `is_active` | boolean | exactly one active per role (enforced by unique index) |
| `payload` | jsonb | the full taxonomy structure (see `taxonomy-guide.md`) |
| `notes` | text | |
| `created_by` | uuid FK | who created this version |
| `created_at` | timestamptz | |

**Unique constraints:**
- `(role_id, version)` — no duplicate versions
- `(role_id) where is_active = true` — only one active per role

---

### `jobs`
Append-only mirror of RapidAPI Active Jobs DB. Never delete rows.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_id` | text UNIQUE | RapidAPI's job ID; used for dedup |
| `source_url`, `source_ats` | text | |
| `title`, `organization`, `description_text` | text | |
| `date_posted`, `date_created` | timestamptz | from API |
| `first_seen_at` | timestamptz | when WE first saw it |
| `last_seen_at` | timestamptz | updated each fetch |
| `still_active` | boolean | flips to `false` when job no longer in API feed |
| `cities_derived`, `regions_derived`, `locations_derived` | text[] | |
| `lat`, `lng` | double precision | |
| `ai_key_skills`, `ai_employment_type` | text[] | API enrichments |
| `ai_experience_level` | text | one of `0-2`, `2-5`, `5-10`, `10+` |
| `ai_salary_min`, `ai_salary_max` | numeric | |
| `linkedin_org_industry` | text | |
| `raw_payload` | jsonb | full original API response, for forensics |

**Lifecycle:** When a fetch returns a job:
- If `source_id` exists → UPDATE row (`last_seen_at`, score-relevant fields, `still_active=true`)
- If new → INSERT (`first_seen_at = now()`)
- After fetch completes, all jobs NOT in the current pull get `still_active=false`

This means you can always answer: "When did employer X first start posting CFT roles?" and "Which jobs have been open ≥ N weeks?"

---

### `job_scores`
Immutable. Every (job, taxonomy_version, campus) combo gets its own row. Re-scoring inserts new rows.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `job_id` | uuid FK | |
| `taxonomy_id` | uuid FK | which version produced this score |
| `campus_id` | text FK | |
| `fetch_run_id` | uuid | which fetch produced this score |
| `confidence` | enum | `HIGH` \| `MEDIUM` \| `LOW` \| `REJECT` |
| `score` | int | total |
| `title_tier` | text | `A` \| `B` \| `C` \| `D` \| null |
| `title_matched`, `title_score` | | |
| `core_matched`, `core_score` | text[], int | |
| `specialized_matched`, `specialized_score` | text[], int | |
| `bonus_matched`, `bonus_score` | text[], int | |
| `industry_matched`, `industry_score` | text[], int | |
| `cert_matched`, `cert_score` | text[], int | |
| `employer_hit`, `employer_score` | bool, int | |
| `distance_miles` | numeric | |
| `tags` | text[] | `BAS_TRACK`, `HEALTHCARE_TRACK`, `WATCHLIST_EMPLOYER`, `HEALTHCARE_CONTEXT` |
| `rejection_reason` | text | populated only when `confidence = REJECT` |
| `experience_penalty` | int | |
| `scored_at` | timestamptz | |

**Why immutable:** allows comparing scores across taxonomy versions for the same jobs; supports A/B testing and historical analysis.

---

### `fetch_runs`
Operational log. One row per fetch attempt.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `trigger_type` | enum | `scheduled` \| `manual` \| `backfill` |
| `triggered_by` | uuid FK | null for `scheduled` |
| `campus_id`, `role_id` | text FK | |
| `query_params` | jsonb | what we sent to RapidAPI |
| `status` | enum | `running` \| `success` \| `failed` |
| `started_at`, `finished_at`, `duration_ms` | | |
| `jobs_returned`, `jobs_new`, `jobs_updated`, `jobs_marked_inactive` | int | |
| `scores_computed` | int | |
| `requests_used` | int | always 1 in v1 (no pagination) |
| `quota_jobs_remaining`, `quota_requests_remaining` | int | from API headers |
| `error_message`, `error_detail` | | populated on failure |

---

### `api_usage`
Quota snapshots. One row per fetch.

| Column | Type | Notes |
|---|---|---|
| `recorded_at` | timestamptz | |
| `jobs_remaining`, `requests_remaining` | int | from RapidAPI headers |
| `jobs_used_this_month`, `requests_used_this_month` | int | derived (20000 - remaining) |
| `bandwidth_mb_used` | numeric | reserved for future |

---

### `audit_log`
Phase 2: writes on every admin action. Schema present in v1, no writers yet.

| Column | Type | Notes |
|---|---|---|
| `user_id`, `user_email` | | |
| `action` | text | e.g. `taxonomy.update`, `fetch.manual` |
| `entity_type`, `entity_id` | | |
| `before_state`, `after_state`, `metadata` | jsonb | |
| `created_at` | timestamptz | |

---

## Views

### `latest_job_scores`
Most recent score per (job, campus) joined with job details. This is what the dashboard reads.

```sql
select * from public.latest_job_scores
where campus_id = 'atlanta' and confidence != 'REJECT'
order by score desc;
```

Implementation: `distinct on (job_id, campus_id)` ordered by `scored_at desc`.

---

## RLS summary

| Table | Authenticated viewer | Admin |
|---|---|---|
| `users` | own row only | all |
| `campuses`, `roles`, `campus_roles`, `taxonomies` | read | read/write |
| `jobs`, `job_scores`, `fetch_runs` | read | read (writes via service role) |
| `api_usage`, `audit_log` | none | read |

Service role key (used by API routes for fetch/score) bypasses RLS entirely. This is correct — those routes have already done their own auth check.
