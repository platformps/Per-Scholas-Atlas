# Atlas — Operational Runbook

**Audience:** future-you, or whoever inherits this. Captures everything you need to deploy from scratch, run day-2 operations, rotate secrets, and recover from common failures.

**Last verified state:** 2026-04-27. App: Atlas (Per Scholas brand). Pilot scope: Atlanta × Critical Facilities Technician. Taxonomy: cft v1.1.3.

---

## Quick reference

| Thing | Where it lives |
|---|---|
| Source | `github.com/platformps/Per-Scholas-Atlas` |
| Deploy | Vercel project (production domain set in Vercel → Settings → Domains) |
| Database | Supabase project (URL ends in `.supabase.co`) |
| Cron | GitHub Actions, `Atlas Job Fetch` workflow, Mon/Wed/Fri 13:00 UTC |
| RapidAPI | Active Jobs DB Ultra plan, `active-ats-7d` endpoint |
| Admin email | `ashahparan@perscholas.org` (only). Promoted via the `handle_new_user` Postgres trigger |
| Local repo | `/Users/ahmshahparan/Documents/Claude/Projects/Per Scholas ATLAS - 4/per-scholas-job-intel/` |

**Secrets (live in three places — see `## Secret rotation` for changing them):**
- Vercel env vars
- GitHub Actions repo secrets
- Local `.env.local` (for one-off scripts like `seed-taxonomy.ts`)

---

## Architecture at a glance

```
GitHub Actions cron (MWF 13:00 UTC)
        │  POST /api/fetch-jobs  (Authorization: Bearer CRON_SECRET)
        ▼
Vercel: apps/web (Next.js 14)
  ├── /api/fetch-jobs   → calls RapidAPI, normalizes, scores, writes to Supabase
  ├── /api/rescore      → re-scores existing jobs against active taxonomy (no API call)
  └── /(dashboard)      → server-rendered Atlas dashboard reading from Supabase
        │
        ▼
Supabase Postgres
  • jobs (append-only, source_id is the natural key)
  • job_scores (immutable; one row per (job, taxonomy version, fetch run))
  • taxonomies (versioned; only one active per role_id at a time)
  • fetch_runs, api_usage, audit_log, users, campuses, roles, campus_roles
```

Single TypeScript scoring engine in `packages/scoring/` is the only place the algorithm lives. `packages/taxonomy/schemas/cft.json` is the data. The route loads the active taxonomy from the DB at runtime, so taxonomy edits don't require a redeploy — only a re-seed.

---

## Phase A — Repo & local setup (one-time)

```bash
# Clone + install
git clone git@github.com:platformps/Per-Scholas-Atlas.git
cd Per-Scholas-Atlas
pnpm install

# Verify the toolchain
pnpm --filter scoring test       # expect all green
pnpm --filter web typecheck      # expect no errors
```

If `pnpm install` fails with a corepack signature error, update corepack first:
```bash
npm install -g corepack@latest
```

---

## Phase B — Supabase (one-time per environment)

1. Create a Supabase project. Free tier is fine for v1 volumes.
2. Save these from **Project Settings → API**:
   - Project URL
   - `anon` (public) key
   - `service_role` (secret) key — **never expose to client**
3. Save these from **Project Settings → Database → Connection string** (URI format, **session pooler** port 5432, NOT direct or transaction pooler):
   - `DATABASE_URL`
4. Run migrations and seeds in order:
   - In Supabase SQL Editor: paste `packages/db/migrations/0001_initial.sql` → Run.
   - In SQL Editor: paste `packages/db/seeds/0001_seed.sql` → Run.
   - Locally:
     ```bash
     # Create .env.local at repo root (gitignored), one line:
     # DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-X-<region>.pooler.supabase.com:5432/postgres
     set -a; source .env.local; set +a
     pnpm tsx packages/db/seeds/seed-taxonomy.ts
     unset DATABASE_URL
     ```
5. **DB password gotcha:** generate a password with **alphanumerics only** (no `@`, `$`, `#`, `&`, `?`, `=`, `+`, `:`, `/`, `\`). Special chars break URL parsing in the postgres-js library.
6. Configure Google OAuth: Supabase → Authentication → Providers → Google → enable. Copy the callback URL Supabase shows. Then in Google Cloud Console:
   - Create or pick a project. Use any Google account (no Per Scholas IT involvement needed).
   - APIs & Services → OAuth consent screen → External → fill app name + support emails.
   - APIs & Services → Credentials → Create OAuth client ID → Web application.
   - Authorized redirect URIs: paste the Supabase callback URL.
   - Copy the Client ID and Client Secret back into Supabase's Google provider config.
   - Add `ashahparan@perscholas.org` (and any other staff) as **Test users** while the consent screen is in Testing status.

---

## Phase C — Vercel (one-time per environment)

1. Generate a `CRON_SECRET` value:
   ```bash
   openssl rand -hex 32
   ```
   Save it — you'll use the same value in three places.
2. New Vercel project → Import the GitHub repo → set **Root Directory** to `apps/web` (critical; this is a monorepo).
3. Add environment variables (apply to all environments):
   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon JWT |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role JWT — **never NEXT_PUBLIC_-prefix this** |
   | `RAPIDAPI_KEY` | from RapidAPI → My Apps → X-RapidAPI-Key |
   | `CRON_SECRET` | the 64-char hex from step 1 |
4. Deploy. The first deploy should succeed even before any data is in Supabase — the dashboard will render an empty state.
5. Sign in as `ashahparan@perscholas.org`. Verify in Supabase Table Editor that a row appeared in `public.users` with `role='admin'`. If it shows `viewer`, the trigger didn't fire correctly — see `## Common failures`.

Pro tier is required for `/api/fetch-jobs` because the route's `maxDuration` is 60s (Hobby caps at 10s).

---

## Phase D — GitHub Actions (one-time per environment)

In `github.com/platformps/Per-Scholas-Atlas/settings/secrets/actions`, add:
| Secret | Value |
|---|---|
| `VERCEL_FETCH_URL` | `https://<your-vercel-domain>/api/fetch-jobs` |
| `CRON_SECRET` | **byte-identical** to the value in Vercel env |

The workflow file is `.github/workflows/weekly-fetch.yml` (named "Atlas Job Fetch"; the filename is historical). It fires on cron `0 13 * * 1,3,5` (Mon/Wed/Fri 13:00 UTC ≈ 9am EDT). To test before the next scheduled run: Actions tab → Atlas Job Fetch → Run workflow → optionally pass `campus_id=atlanta` and `role_id=cft`.

---

## Recurring operations

### Manual fetch (admin)

Two options:

1. **From the dashboard:** sign in as admin → click `/admin` → "Manual Fetch" button on the Atlanta×CFT card. Throttled at 1 per pair per 24 hours. Refused if RapidAPI quota is below 15%.
2. **Via curl** (rare; for testing the cron path):
   ```bash
   URL='https://<your-vercel-domain>/api/fetch-jobs'
   SECRET='<the same CRON_SECRET value>'
   curl -X POST "$URL" \
     -H "Authorization: Bearer $SECRET" \
     -H "Content-Type: application/json" \
     -d '{"trigger_type":"manual","campus_id":"atlanta","role_id":"cft"}'
   ```

Expected response on success:
```json
{"trigger_type":"manual","pairs":1,"results":[{"campus_id":"atlanta","role_id":"cft","status":"success","fetch_run_id":"...","jobs_returned":N,"jobs_new":N,"scores_computed":N}]}
```

### Re-score existing jobs (no API spend)

Useful after a taxonomy bump — applies the new active taxonomy to jobs already in `jobs`, without calling RapidAPI. Inserts new immutable rows in `job_scores`.

```bash
URL='https://<your-vercel-domain>/api/rescore'
SECRET='<CRON_SECRET>'
curl -X POST "$URL" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"campus_id":"atlanta","role_id":"cft"}'
```

The dashboard reads from the latest successful `fetch_run`, so re-score creates a new fetch_run row with `trigger_type='rescore'` and the dashboard switches to it automatically.

To rescore all jobs (including `still_active=false`), pass `"include_inactive": true` in the body.

### Taxonomy update

The taxonomy lives in `packages/taxonomy/schemas/cft.json`. The route reads the **active taxonomy from the DB**, not the file — so changes need a re-seed.

```bash
# 1. Edit cft.json, bump `version` (semver: patch for tweaks, minor for additive
#    fields, major for shape changes). Update `version_notes`.
# 2. Locally:
cd "/path/to/per-scholas-job-intel"
pnpm --filter scoring test    # confirm tests pass
git add packages/taxonomy/schemas/cft.json
git commit -m "tune(vN.N.N): <one-line summary>"
git push                       # Vercel auto-redeploys (no taxonomy change yet)
# 3. Re-seed:
set -a; source .env.local; set +a
pnpm tsx packages/db/seeds/seed-taxonomy.ts
unset DATABASE_URL
# 4. Verify in Supabase SQL Editor:
#    SELECT role_id, version, active FROM taxonomies ORDER BY created_at DESC;
#    → new version active=true at top, prior versions active=false below
```

The seed script is idempotent: skips if `(role_id, version)` already exists, otherwise deactivates the previous active version and inserts the new one as active. Old versions are preserved for score-history audit.

### Activating another (campus, role) pair

```sql
UPDATE campus_roles
SET active = TRUE
WHERE campus_id = 'charlotte' AND role_id = 'cft';
```

The next scheduled fetch will pick it up automatically. No code change needed.

### Adding an admin

Edit `0001_initial.sql`'s `handle_new_user` trigger function and re-run via SQL Editor:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    CASE
      WHEN NEW.email IN ('ashahparan@perscholas.org', '<new-admin-email>')
        THEN 'admin'::user_role
      ELSE 'viewer'::user_role
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET last_sign_in_at = NOW();
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
```

The trigger only fires on **new** sign-ins. To promote an existing user:

```sql
UPDATE public.users SET role = 'admin' WHERE email = '<email>';
```

Also commit the change to `packages/db/migrations/0001_initial.sql` for future deploys.

---

## Secret rotation

All four secrets share the same pattern: rotate at the source, update everywhere it's stored, redeploy if needed.

### `CRON_SECRET`

```bash
# 1. Generate
openssl rand -hex 32   # copy output

# 2. Update in three places (must be byte-identical):
#    - Vercel project → Settings → Environment Variables → CRON_SECRET → Edit
#    - GitHub repo → Settings → Secrets and Variables → Actions → CRON_SECRET → Update
#    - Your password manager
# 3. Redeploy (Vercel does this automatically on env change)
```

If they ever drift, you'll see HTTP 401 with `"Bad bearer token"` in the workflow run logs.

### `RAPIDAPI_KEY`

1. RapidAPI dashboard → My Apps → Reset API Key.
2. Update Vercel env var.
3. Redeploy automatically. Next scheduled fetch validates.

### `SUPABASE_SERVICE_ROLE_KEY`

1. Supabase → Project Settings → API → "Reset" next to service_role.
2. Update Vercel env var. **Do NOT update `NEXT_PUBLIC_SUPABASE_ANON_KEY`** unless you also reset it.
3. Redeploy.

### Database password

1. Supabase → Project Settings → Database → "Reset database password". Generate alphanumeric only.
2. Update `.env.local` for future seed runs.
3. Update Vercel env var (if you use `DATABASE_URL` server-side; in our current setup the route doesn't need it, only seed scripts do).

---

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Workflow fails with `HTTP 401: Bad bearer token` | `CRON_SECRET` mismatch between GitHub and Vercel | Re-paste byte-identically; redeploy |
| `{"error":"Not signed in"}` from a curl | `Authorization: Bearer ...` header missing or malformed (often smart quotes from a copy/paste) | Use the multi-line `URL=...; SECRET=...; curl ...` recipe in this doc |
| Fetch returns `jobs_returned: 0` | Title filter or location filter isn't matching | Inspect `query_params` on the `fetch_runs` row; test the exact params via direct curl to RapidAPI |
| New user signs in but lands as `viewer` instead of `admin` | Either email mismatch in the trigger, or trigger never ran | Check `auth.users` for the row, then `public.users`. If only `auth.users` has the row, trigger failed — re-apply the `handle_new_user` SQL from this doc |
| Sign-in fails with `Database error saving new user` | The `handle_new_user` trigger function has a bug or missing grant | Re-run the trigger SQL from `## Adding an admin` (it includes `GRANT EXECUTE ... TO supabase_auth_admin`) |
| Sign-in redirects to `localhost:3000` | Supabase Auth → URL Configuration → Site URL is still default | Set Site URL to your Vercel domain; add it to the Redirect URLs allow-list with `/**` wildcard |
| `pnpm install` fails with corepack signature error | Outdated corepack with stale npm signing keys | `npm install -g corepack@latest` |
| Throttled manual fetch | One was triggered in the last 24h for this pair | Either wait, or `UPDATE fetch_runs SET started_at = NOW() - INTERVAL '25 hours' WHERE ...` to bump it past the window (don't DELETE — FK constraint blocks) |
| `connect ECONNREFUSED <ipv6>:5432` from a local script | Trying direct connection (`db.<ref>.supabase.co`) on free tier; that hostname is IPv6-only | Use the **session pooler** connection string instead (`aws-X-<region>.pooler.supabase.com:5432`) |
| Vercel build fails: "couldn't find Next.js" | Root Directory not set to `apps/web` | Vercel project → Settings → General → Root Directory → `apps/web` |
| `pnpm tsx --env-file=.env.local` doesn't load env | tsx version 4.16 lacks `--env-file` support | Use `set -a; source .env.local; set +a` pattern instead |

---

## Architecture decisions worth remembering

These aren't obvious from the code. Captured here so they don't have to be re-litigated.

### Why MWF 9am ET cron, not daily or weekly

RapidAPI Active Jobs DB only exposes `active-ats-7d` (7-day window) on the Ultra plan. There's no 30-day endpoint. To improve recall without raising the per-fetch cost, we run the same 7-day window query 3×/week. Quota math: ~80 jobs × 3 runs/week × 4.3 weeks/month ≈ 1,030 jobs/month per (campus, role) pair. Well under the 20,000 cap.

### Why scoring lives in the web API, not in a worker

BRIEF §14: single source of truth. The repo originally shipped with a Python worker (`workers/job-fetcher/fetch.py`) that re-implemented scoring. By the time we audited it, that Python implementation was already 4 sections behind the canonical TS scoring engine and would have crashed on the v1.1.0+ taxonomy shape. Removed in the initial commit. GitHub Actions is a thin curl-to-Vercel cron clock; nothing more.

### Why `jobs` is append-only, `job_scores` is immutable

Audit trail. We want to know "this job was a HIGH at v1.1.2 and a LOW at v1.1.3 — what changed?". Re-scoring inserts new rows; nothing mutates. The dashboard reads "scores tied to the latest successful `fetch_run`", which always reflects the current taxonomy version because each fetch (or rescore) creates a new fetch_run row.

### Why the location filter uses `City, FullStateName` not `City, ST`

RapidAPI's index stores `locations_derived` as `"City, <FullStateName>, United States"`. Two-letter state codes don't substring-match. We translate the campus's `state` column (2-letter, per the seed) to the full name in `buildLocationFilter`. See `apps/web/lib/rapidapi.ts`.

### Why `ai_employment_type_filter` and `ai_experience_level_filter` were dropped

Empirical observation in the first Atlanta fetch (2026-04-27): demanding AI-classified `FULL_TIME` and `0-2,2-5` excluded postings whose AI classification was null (which is most of them). Recall improved from 18 → 25 jobs after dropping these. The scoring engine still filters by `ai_experience_level` post-fetch via `experience_filter.auto_reject_levels` and the §A2 description regex, with the added benefit that we see WHY each rejection happened.

### Why Tier B requires industry-context match (v1.1.3)

The first fetch surfaced a Cushman & Wakefield "Maintenance Technician" posting that scored MEDIUM (68) — Tier B title + 4 generic building-trade skills (HVAC, EPA 608, EOP, Preventative Maintenance) + facilities_services watchlist hit. Confirmed by spot-check as a non-fit (apartment/office maintenance). Under v1.1.3, Tier B titles drop to score 0 if no DC-specific industry phrase appears in the description. Dropping a Tier B with no DC vocabulary is the cleanest precision fix without affecting Tier A or breaking legitimate Tier B hits at known DC employers.

### Why `EPA 608`, `NFPA 70E`, `OSHA 10` appear in both `core_skills` and `certifications`

Intentional double-count flagged in §A6 of `SCORING_ADDENDUM.md`. The reading is that "we taught the skill AND the cert was earned" represents a stronger signal than either alone. The validator emits a `console.warn` at taxonomy load time so an operator running the seed sees it. **Fix queued for post-fetch tuning when warranted by data.** As of v1.1.3, deferred.

### Why we use a CSS variable for fonts instead of importing Roboto directly

Per Scholas brand book mandates Nitti Grotesk (paid Adobe Fonts). Roboto is the documented free fallback. Loading Roboto via `next/font/google` with a CSS variable lets the Tailwind `font-sans` class chain it with `system-ui` and `Arial` for the brand book's stated "alternate typeface" fallback. No external CDN dependency.

---

## When in doubt

- **Code:** `git log` is the timeline. Every meaningful change has a commit message that explains why.
- **Data shape:** `packages/db/migrations/0001_initial.sql` is authoritative.
- **Scoring algorithm:** `packages/scoring/src/index.ts` is authoritative; the addendum is the rationale.
- **Taxonomy:** `packages/taxonomy/schemas/cft.json` is the source of truth; the DB copy is downstream.
- **Operational state:** Supabase `fetch_runs`, `job_scores`, `audit_log` tables are the live record.

If something doesn't behave the way this doc says, this doc is wrong. Update it.

---

## Notes for the next maintainer

- `docs/operations.md` predates the 2026-04-27 deployment session and references the wrong cron schedule, the wrong API endpoint name, and the rescore route as "Phase 2" when it's actually built. Either update or delete it; this runbook supersedes its content.
- `apps/web/public/per-scholas-logo.png` must exist for the headers to render correctly. Source: Per Scholas brand asset library (May 2025 brand book).
- The Google OAuth consent screen is in **Testing** status. To open access beyond the test-user list (currently capped at 100), publish the app and accept Google's verification flow (typically a few hours for basic-scopes apps).
- BRIEF.md and SCORING_ADDENDUM.md at the repo root capture the original design rationale; SCORING_ADDENDUM.md §F has the closeout summary of the pre-fetch §A/§B work.
