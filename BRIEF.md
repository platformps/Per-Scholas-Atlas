# Per Scholas Job Intelligence Platform — Claude Code Handoff Brief

> **How to use this document:** Paste this entire file as your first message to Claude Code, or save it as `BRIEF.md` in your project root and tell Claude Code "read BRIEF.md and let's continue from there." Companion ZIP archive contains partially-built scaffold to import.

---

## 1. Project summary

**What it is:** An internal job-demand intelligence platform for Per Scholas (workforce training nonprofit, ~17 campuses across the US). It pulls live job postings from RapidAPI's Active Jobs DB, scores them against curriculum-derived taxonomies, and surfaces a confidence-scored dashboard so curriculum/program teams can see what employers in each campus's commute radius are *actually* hiring for relative to what Per Scholas teaches.

**Problem it solves:** "Title saturation" — graduate roles like *Critical Facilities Technician* are posted under 30+ different job titles (Data Center Tech, Mission Critical Engineer, Building Engineer, etc.). A simple keyword search either misses 70% of relevant postings or floods the results with irrelevant ones (Senior roles, Engineer roles requiring a PE license, etc.). The platform fixes this by mapping each curriculum to a **taxonomy** — a structured definition of titles, skills, exclusions, and weights derived from curriculum hours.

**Owner:** Imran Hasnat (Per Scholas employee). Admin emails: `shahparan.hasnat@gmail.com` (personal, primary admin), `ashahparan@perscholas.org` (work, optional secondary).

---

## 2. Tech stack (locked decisions)

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | Next.js 14 App Router, TypeScript, Tailwind | Single Vercel deploy hosts both |
| Database | Supabase Postgres | Hosted; we'll use the free tier to start, upgrade as needed |
| Auth | Supabase Auth + Google OAuth | Open sign-in for any Google account |
| Worker | GitHub Actions (cron) | Free tier of org GitHub Actions; calls back to Vercel `/api/fetch` route |
| Hosting | Vercel Pro | Per Scholas org account |
| External API | RapidAPI Active Jobs DB (Fantastic Jobs) | Ultra plan, $95/mo, 20,000 jobs/mo + 20,000 requests/mo, 5 req/sec, up to 100 jobs per call |
| Repo | New private GitHub repo `per-scholas-job-intel` in Per Scholas org | Monorepo with pnpm workspaces |

**Why these choices:** Supabase gives us Postgres + Auth + RLS in one tool. Next.js on Vercel keeps deployment simple — one platform, no Docker, no separate worker hosting. GitHub Actions is free for org-private repos within reasonable cron use. RapidAPI Active Jobs DB was specifically researched and selected; it's the only affordable API that returns ATS-direct postings (not aggregated noise) with skills extraction.

---

## 3. v1 scope — what ships first

### Pilot configuration
- **One active campus**: Atlanta (233 Peachtree St NE, Suite 650, Atlanta, GA 30303 — lat 33.7596, lng -84.3880)
- **One active role**: Critical Facilities Technician (CFT, internal course code UCI 2137)
- **Search radius**: 100 miles from Atlanta address
- **All 17 campuses are seeded in the database** (Atlanta, Baltimore, Boston, Bronx, Charlotte, Chicago, Cincinnati, Columbus, Dallas, Denver, Detroit, Newark, Philadelphia, Phoenix, Seattle, St-Louis, Washington-DC) but only the Atlanta-CFT pairing has `active=true` for v1.

### Auth model
- Google OAuth via Supabase Auth — anyone with any Gmail or Google Workspace account can sign in.
- **Admin = `shahparan.hasnat@gmail.com` only** (hardcoded admin seeding via DB trigger).
- Everyone else = `viewer` role by default.
- Admins can: trigger manual fetches, edit taxonomies (Phase 2 UI; Phase 1 is JSON-file-based), view audit log, view quota dashboard.
- Viewers can: see dashboard, filter, search, export CSV.

### Triggers (when fresh data gets fetched)
1. **Scheduled fetch** — every Monday 11:00 UTC, GitHub Actions cron hits a Vercel route with a `CRON_SECRET` header. Fetches active CFT postings within 100mi of Atlanta.
2. **Manual fetch** — admin-only button in the UI. Throttled: max 1 per 24 hours per (campus, role) pair. Blocked if RapidAPI quota is below 15% remaining.
3. **Re-score** — admin button that re-runs the scoring engine on already-fetched jobs without spending API quota. Free operation. Useful when the taxonomy is updated.

### Data lifecycle (this is important and non-obvious)
- **`jobs` table is append-only**: when we see a job ID we already have, we update its `last_seen_at` and `still_active` fields, but we never delete it. This preserves the historical record — we want to know that a job existed even if it's no longer hiring.
- **`job_scores` is immutable**: re-scoring inserts new rows with a new `taxonomy_version` reference. The dashboard shows the latest score per job via a view (`latest_job_scores`). This means we can audit how scoring decisions changed over time when we tune the taxonomy.
- **`still_active` reconciliation**: after each scheduled fetch, jobs that were in our DB but didn't appear in this batch get their `still_active` flipped to `false`. (This logic must respect pagination — only mark inactive after we've confirmed we fetched all pages.)

### What's intentionally NOT in v1 (deferred to later phases)
- Pagination beyond 100 jobs per fetch (we accept this limit for v1; Atlanta CFT volume estimated at 50–80/week)
- Taxonomy editor UI (taxonomies edited as JSON files + PR for v1)
- Re-score UI button (engine works, button is stubbed)
- Trend / longitudinal views ("show me CFT demand over the last 6 months")
- Slack / email alerting on quota warnings or fetch failures
- Multi-campus rollout (Charlotte, DC, Bronx, etc. come in Phase 2 once we validate Atlanta)
- Additional roles (Cybersecurity Analyst, Cloud Practitioner, etc. come after CFT validation)

---

## 4. The CFT taxonomy — central artifact

The taxonomy is the heart of this system. It's how we encode "what does Per Scholas's Critical Facilities Technician curriculum actually qualify a graduate for?" into something a scoring engine can evaluate.

**File location**: `packages/taxonomy/schemas/cft.json` (already built — see ZIP).

### Structure overview

```
{
  "version": "1.0.0",
  "role_code": "CFT",
  "course_code": "UCI 2137",
  "search": {
    "radius_miles": 100,
    "title_filter_keywords": [...]   // sent to RapidAPI's title_filter
  },
  "title_tiers": {
    "A": { "weight": 40, "titles": [...] },
    "B": { "weight": 25, "titles": [...], "demote_to": 10, "demote_if_core_skills_below": 4 },
    "C": { "weight": 20, "titles": [...], "track_tag": "BAS_TRACK" },
    "D": { "weight": 25, "titles": [...], "track_tag": "HEALTHCARE_TRACK" }
  },
  "exclusions": {
    "title": [...],         // Senior, Lead, Manager, etc.
    "description": [...]    // PE required, Bachelor's required, 5+/7+/10+ years
  },
  "skills": {
    "core":         { "weight_each": 8, "max": 40, "items": [...] },
    "specialized":  { "weight_each": 4, "max": 20, "items": [...] },
    "bonus":        { "weight_each": 1, "max": 5,  "items": [...], "guard": "require_core_or_industry" },
    "industry_context": { "weight_each": 3, "max": 10, "items": [...] },
    "certs":        { "weight_each": 5, "max": 15, "items": [...] }
  },
  "employer_watchlist": { "weight": 5, "items": [...] },
  "thresholds": { "high": 75, "medium": 50, "low": 30 }
}
```

### Title tiers (the most important part)

| Tier | Weight | Examples | Logic |
|---|---|---|---|
| **A** | 40 pts | Critical Facilities Technician, Data Center Facilities Technician, Mission Critical Technician, Critical Environment Technician | Direct match — the core target titles |
| **B** | 25 pts (or **demoted to 10** if <4 core skills matched) | Facilities Technician, Building Engineer, MEP Technician, Maintenance Technician | Adjacent titles — could be a great fit or could be janitorial, depends on the skill content |
| **C** | 20 pts + `BAS_TRACK` tag | Building Automation Technician, BAS Technician, Controls Technician | Specialized subset of CFT — relevant but narrower |
| **D** | 25 pts + `HEALTHCARE_TRACK` tag | Hospital Engineering Technician, Plant Operations Engineer, Stationary Engineer | Healthcare facilities subset — same skills, different industry |

The `track_tag` field lets us slice the dashboard later ("show only BAS-track jobs"). The Tier B demotion is critical — without it, "Facilities Technician" matches everything from data center ops (great fit) to school custodian (terrible fit).

### Hard exclusions (auto-reject before scoring)

**Title contains any of these → instant reject (score = 0, status = REJECTED):**
- Senior, Sr., Lead, Principal, Manager, Director, Supervisor
- III, IV, V (roman numerals indicating senior levels)
- Electrical Engineer, Network Engineer, Software Engineer, Controls Engineer, Mechanical Engineer
- PLC Programmer, Systems Engineer, Solutions Architect

**Description contains any of these → instant reject:**
- "PE license required", "Professional Engineer required"
- "Bachelor's degree required", "BS in [Engineering] required" (note: "preferred" is OK, "required" is not)
- "5+ years", "7+ years", "10+ years" (with regex tolerance for variations)

### Skill scoring buckets (weights derived from curriculum hours in UCI 2137)

| Bucket | Per-skill | Cap | Examples |
|---|---|---|---|
| Core (40 pts cap) | 8 pts | 40 | UPS, Generator, ATS, PDU, RPP, HVAC, EPA 608, Chiller, CRAC, CRAH, BMS/BAS, EPMS, NFPA 70E, OSHA 10, LOTO, SOP/MOP/EOP, Multimeter |
| Specialized (20 pts cap) | 4 pts | 20 | PLC, Ladder Logic, VFD, BACnet, Modbus, P&ID, Hot Aisle, Cold Aisle, Containment |
| Bonus (5 pts cap, gated) | 1 pt | 5 | Pumps, Valves, Pneumatics, Hydraulics, Sensors, Motors, CMMS |
| Industry context (10 pts cap) | 3 pts | 10 | mission critical, data center, hyperscale, colocation, Tier III, Tier IV, 24/7, uptime |
| Certs (15 pts cap) | 5 pts | 15 | OSHA 10, NFPA 70E, EPA 608 |

**Bonus guard:** Bonus skills only count if at least 1 core skill OR 1 industry context match was found. This prevents false positives on generic manufacturing maintenance jobs (which list pumps/valves/sensors but aren't data-center-relevant).

### Employer watchlist (5 pts bonus)

40+ known employers that hire CFT-aligned roles in the Atlanta market: Microsoft, Google, QTS, Equinix, Switch, Digital Realty, Iron Mountain, Aligned, CyrusOne, Vantage, Stack Infrastructure, Compass Datacenters, Emory Healthcare, Piedmont, Northside Hospital, JLL, CBRE, Cushman & Wakefield, Jacobs, Turner & Townsend, etc. Full list in `cft.json`.

### Score thresholds → confidence labels

| Score | Label | Meaning |
|---|---|---|
| 75–100 | **HIGH** | Strong fit; recruit reach-out / curriculum reinforcement candidate |
| 50–74 | **MEDIUM** | Plausible fit; worth a human review |
| 30–49 | **LOW** | Probably not a fit, but logged for trend analysis |
| <30 | **REJECTED** | Filtered out from default dashboard view |

---

## 5. Database schema (Supabase Postgres)

Full SQL is in `packages/db/migrations/0001_initial.sql` in the ZIP. Here's the conceptual layout:

```
users           — mirrors Supabase auth.users; stores role (admin|viewer)
campuses        — 17 Per Scholas campuses with lat/lng + address
roles           — graduate roles (CFT for v1; Cybersec, Cloud later)
campus_roles    — join table; only Atlanta×CFT has active=true for v1
taxonomies      — versioned JSON blobs; each (role_id, version) is one row
jobs            — append-only; primary key job_id from RapidAPI; tracks first_seen, last_seen, still_active
job_scores      — immutable; (job_id, taxonomy_version, scored_at) composite key
fetch_runs      — audit of every fetch attempt: scheduled vs manual, success/fail, jobs returned
api_usage       — per-fetch quota counter for the rolling 30-day window
audit_log       — admin actions (taxonomy edits, manual fetches, role changes)
```

### Key views
- `latest_job_scores` — for each job_id, returns the most recent score row. Dashboard reads from this.

### Row-Level Security policies
- `users`: anyone authenticated can read their own row; only admins can update roles
- `jobs` / `job_scores` / `latest_job_scores`: any authenticated user can SELECT
- `taxonomies` / `campus_roles` / `roles` / `campuses`: SELECT for all auth'd; INSERT/UPDATE for admins only
- `fetch_runs` / `api_usage` / `audit_log`: admins only

### Auto-admin trigger
A Postgres trigger `handle_new_user` runs on `auth.users` INSERT. It creates the corresponding `users` row and assigns role `admin` if the email matches `shahparan.hasnat@gmail.com` (or the secondary admin email if you add it). Everyone else gets `viewer`.

---

## 6. Scoring engine

**Location**: `packages/scoring/src/index.ts` (already built — see ZIP).

**Pure function, deterministic, fully testable:**

```typescript
score(job: NormalizedJob, taxonomy: Taxonomy): ScoreResult
```

`ScoreResult` includes:
- `total_score` (0–100, capped)
- `confidence` (HIGH | MEDIUM | LOW | REJECTED)
- `tier_matched` (A | B | C | D | null)
- `track_tags` (array — e.g., ["BAS_TRACK"])
- `breakdown` — full audit of every contributor: which titles, skills, certs, employers matched and how many points each added
- `rejection_reason` — if rejected, why (e.g., "title contains 'Senior'")

**Why immutable scoring matters:** when we tune the taxonomy (add a skill, adjust a weight), we re-run scoring on existing jobs. The new scores get inserted as new rows in `job_scores`. Dashboard reads via `latest_job_scores` view. This means we have a complete audit: "this job was a HIGH at v1.0.0 but a MEDIUM at v1.1.0, here's exactly which skill weight changed."

**Tests** (`packages/scoring/tests/scoring.test.ts`) cover:
- Tier A title with full skills → HIGH score
- Senior in title → REJECTED
- Bachelor's required → REJECTED
- Outside 100mi radius → REJECTED
- "5–10 years experience" → REJECTED
- Tier B with <4 core skills → demoted from 25 to 10
- BAS title → BAS_TRACK tag applied
- Healthcare title → HEALTHCARE_TRACK tag applied
- Bonus skills with no core/industry hit → bonus zeroed (guard works)
- Watchlist employer → +5 applied

---

## 7. RapidAPI integration details

**Endpoint**: `GET https://active-jobs-db.p.rapidapi.com/active-ats-7d`

**Key query params for our use case:**
- `title_filter` — comma-separated; we build this from Tier A + Tier B titles only (Tier C/D filtered post-fetch to avoid query-string noise)
- `location_filter` — `"Atlanta, GA, USA"` (their location filtering does the radius work; we pass radius via `distance` param when supported, or post-filter by lat/lng using haversine)
- `limit` — max 100 per request
- `description_type` — `"text"` (we want the full description for skill matching)
- `include_ai` — `false` (we do our own scoring; their AI fields are irrelevant)

**Headers**:
```
X-RapidAPI-Key: $RAPIDAPI_KEY     (from Vercel env)
X-RapidAPI-Host: active-jobs-db.p.rapidapi.com
```

**Quota math for v1**: One fetch per week × ~80 jobs returned = ~320 jobs/month. Well under the 20k jobs / 20k requests / 10GB bandwidth ceiling. Budget supports adding all 17 campuses on CFT alone before quota becomes a concern.

**Rate limiting**: 5 req/sec hard limit. Worker sleeps 250ms between paginated requests to be safe.

---

## 8. Repository structure

```
per-scholas-job-intel/
├── apps/
│   └── web/                          Next.js 14 app
│       ├── app/
│       │   ├── (dashboard)/          Auth-gated routes
│       │   │   ├── layout.tsx
│       │   │   └── page.tsx          Main dashboard
│       │   ├── api/
│       │   │   ├── fetch/route.ts    POST: triggers fetch (scheduled or manual)
│       │   │   └── quota/route.ts    GET: admin quota dashboard
│       │   ├── auth/
│       │   │   └── callback/route.ts OAuth callback
│       │   ├── login/page.tsx        Google sign-in page
│       │   ├── globals.css
│       │   └── layout.tsx            Root layout
│       ├── components/
│       │   ├── DashboardHeader.tsx
│       │   ├── ConfidenceBadge.tsx
│       │   ├── StatCard.tsx
│       │   ├── ManualFetchButton.tsx (admin only)
│       │   └── JobTable.tsx          Expandable rows w/ score breakdown
│       ├── lib/
│       │   ├── supabase-browser.ts
│       │   ├── supabase-server.ts
│       │   └── auth.ts               getCurrentUser, requireAdmin, etc.
│       ├── middleware.ts             Supabase session refresh
│       ├── next.config.mjs
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 0001_initial.sql      Schema + RLS + triggers + views
│   │   ├── seeds/
│   │   │   ├── 0001_seed.sql         17 campuses + CFT role + Atlanta×CFT active
│   │   │   └── seed-taxonomy.ts      Loads cft.json into taxonomies table
│   │   └── schema.ts                 TypeScript types matching schema
│   ├── scoring/
│   │   ├── src/
│   │   │   ├── index.ts              Main score() function
│   │   │   └── types.ts              ScoreResult, NormalizedJob, etc.
│   │   ├── tests/
│   │   │   └── scoring.test.ts       Vitest unit tests
│   │   └── package.json
│   └── taxonomy/
│       ├── schemas/
│       │   └── cft.json              ⭐ The CFT taxonomy
│       ├── src/
│       │   └── index.ts              Zod schema validation
│       └── package.json
├── workers/
│   └── job-fetcher/                  (Optional Python alt — we're using GitHub Actions instead)
├── .github/
│   └── workflows/
│       ├── ci.yml                    typecheck, lint, test on PR
│       └── weekly-fetch.yml          Mon 11am UTC cron + manual workflow_dispatch
├── docs/
│   ├── runbook.md                    Step-by-step deployment guide
│   ├── taxonomy-guide.md             How taxonomies work; how to add a new role
│   ├── data-model.md                 DB schema reference
│   └── operations.md                 Day-to-day ops: fetches, re-scores, quota
├── .env.example                      Template for required env vars
├── .gitignore
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json                      Root workspace package
```

---

## 9. Required environment variables

`.env.local` (Next.js dev) and Vercel production env both need:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...           # Server-side only! Never NEXT_PUBLIC_
SUPABASE_DB_URL=postgresql://...           # For migrations

# RapidAPI
RAPIDAPI_KEY=xxxxx                          # Server-side only

# Cron auth (shared secret between Vercel + GitHub Actions)
CRON_SECRET=<generate a random 32-char string>

# App
NEXT_PUBLIC_APP_URL=https://your-vercel-url.vercel.app
```

GitHub Actions secrets (in repo settings):
- `VERCEL_FETCH_URL` = `https://your-vercel-url.vercel.app/api/fetch`
- `CRON_SECRET` = same as Vercel env

---

## 10. Deployment runbook (high-level — full version in `docs/runbook.md`)

### Phase A: Repo setup
1. Create private repo `per-scholas-job-intel` in Per Scholas GitHub org
2. Clone the partial scaffold from the ZIP attached to this handoff
3. `pnpm install` at root
4. Verify `pnpm typecheck` and `pnpm test` pass

### Phase B: Supabase setup
1. Create new Supabase project (free tier OK to start)
2. In Supabase dashboard → Authentication → Providers → enable Google
3. Configure Google OAuth (Google Cloud Console → OAuth consent screen → Create credentials → add Supabase callback URL)
4. Run `packages/db/migrations/0001_initial.sql` via Supabase SQL editor
5. Run `packages/db/seeds/0001_seed.sql`
6. Run `pnpm tsx packages/db/seeds/seed-taxonomy.ts` to load the CFT taxonomy

### Phase C: Vercel setup
1. Create new Vercel project, import the GitHub repo
2. Set root directory to `apps/web`
3. Add all env vars from §9 above to Vercel project settings
4. Deploy. Should succeed even before fetch is wired (dashboard will just show empty state).
5. Configure custom domain if desired

### Phase D: GitHub Actions setup
1. In repo settings → Secrets → add `VERCEL_FETCH_URL` and `CRON_SECRET`
2. Workflow `weekly-fetch.yml` is already in repo; will auto-activate on next Monday 11:00 UTC
3. Test manually: GitHub → Actions → Weekly Fetch → Run workflow

### Phase E: First fetch + verification
1. Sign in to deployed app with `shahparan.hasnat@gmail.com` — confirm admin role badge shows
2. Click Manual Fetch button (admin only)
3. Verify jobs appear in dashboard with scores
4. Spot-check 5–10 high-scoring jobs by clicking through to source URL — do they look right?
5. Spot-check 5 rejected jobs — were they correctly rejected?

### Phase F: Tuning (week 2+)
- Review false positives/negatives weekly for first month
- Adjust taxonomy weights, add titles, refine exclusions
- Each taxonomy version = new row in DB; re-score is free
- Once Atlanta CFT scoring is reliable (~90% precision on HIGH), start activating other campus_role pairs

---

## 11. What's already built (in attached ZIP)

**Fully complete:**
- ✅ `packages/taxonomy/schemas/cft.json` — full CFT taxonomy v1.0.0
- ✅ `packages/taxonomy/src/index.ts` — Zod schema validator
- ✅ `packages/scoring/src/index.ts` + `types.ts` — scoring engine (TS port from artifact)
- ✅ `packages/scoring/tests/scoring.test.ts` — vitest tests
- ✅ `packages/db/migrations/0001_initial.sql` — full schema with RLS, triggers, views
- ✅ `packages/db/seeds/0001_seed.sql` — 17 campuses + CFT role + Atlanta×CFT active
- ✅ `packages/db/seeds/seed-taxonomy.ts` — loader script
- ✅ `apps/web/` — Next.js scaffold (config files, supabase clients)
- ✅ `.github/workflows/weekly-fetch.yml` + `ci.yml`
- ✅ `docs/data-model.md`, `docs/taxonomy-guide.md`, `docs/operations.md`
- ✅ `.env.example`, `.gitignore`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- ✅ Root `package.json` with workspace config

**Partially built / stubbed (needs Claude Code finishing):**
- ⚠️ `apps/web/app/(dashboard)/page.tsx` — main dashboard; needs to query `latest_job_scores` view and render
- ⚠️ `apps/web/app/api/fetch/route.ts` — fetch endpoint logic; needs RapidAPI call + scoring + DB writes
- ⚠️ `apps/web/app/api/quota/route.ts` — quota dashboard endpoint
- ⚠️ `apps/web/components/*` — JobTable, ConfidenceBadge, etc.; some stubs only
- ⚠️ `apps/web/middleware.ts` — Supabase session refresh
- ⚠️ `apps/web/lib/auth.ts` — auth helpers
- ⚠️ `docs/runbook.md` — partially written

**Not yet built:**
- ❌ `apps/web/app/login/page.tsx` — Google sign-in page
- ❌ `apps/web/app/auth/callback/route.ts` — OAuth callback handler
- ❌ `apps/web/app/layout.tsx` + `globals.css` polish

---

## 12. Recommended Claude Code workflow

When you start the Claude Code session:

1. **Drop the ZIP contents into a fresh local repo directory.**
2. **First message to Claude Code**: "I have a partially-built Next.js + Supabase project. Read `BRIEF.md` (this file) for full context. Then run `find . -type f | head -50` to inventory what's already built. Then propose a sequenced plan to finish v1, starting with whatever's most foundational."
3. **Suggested sequence** (Claude Code will likely propose this or similar):
   1. Verify monorepo installs (`pnpm install`, fix any version conflicts)
   2. Verify scoring engine tests pass (`pnpm --filter scoring test`)
   3. Wire up Supabase clients + auth helpers + middleware
   4. Build login + OAuth callback
   5. Build dashboard page reading from `latest_job_scores` view
   6. Build `/api/fetch` route end-to-end (RapidAPI call → normalize → score → upsert)
   7. Build `ManualFetchButton` + `/api/quota` route
   8. Wire GitHub Actions to call `/api/fetch` with cron secret
   9. End-to-end test: deploy to Vercel preview, run manual fetch, verify dashboard populates
4. **Don't let Claude Code skip the verification steps.** After each module is done, run the relevant tests / type checks before moving on.

---

## 13. Key things to double-check during build

- **RLS policies are easy to mis-configure.** After running migrations, log in as a non-admin Google account and verify they can read jobs but not write taxonomies / trigger fetches.
- **`SUPABASE_SERVICE_ROLE_KEY` must never appear in any `NEXT_PUBLIC_*` env var or any client-side bundle.** It bypasses RLS. Only use in server-side route handlers.
- **CRON_SECRET timing-safe comparison.** Use `crypto.timingSafeEqual` not `===` to avoid timing-attack leaks.
- **Pagination + `still_active`.** Don't mark jobs inactive until you've fetched all pages of the current run. The fetch route needs a "fetch complete" flag before reconciling.
- **Idempotency.** Manual fetch button should be debounced / disabled-while-pending so a panicked admin double-clicking doesn't burn 2x quota.

---

## 14. Project decisions log (so Claude Code doesn't re-litigate)

| Question | Decision | Why |
|---|---|---|
| Monorepo or polyrepo? | Monorepo (pnpm workspaces) | Scoring engine + taxonomy schemas are shared between worker and web |
| Drizzle/Prisma or raw SQL? | Raw SQL migrations + hand-typed schema in `packages/db/schema.ts` | Migrations are linear and few; ORM overhead not worth it for v1 |
| Worker on GitHub Actions vs Vercel Cron vs separate service? | GitHub Actions cron → calls Vercel `/api/fetch` | Free, separates concerns, gives us audit log via Actions UI |
| Where does scoring run — worker or web API? | Web API (in the fetch route) | Single source of truth for scoring; worker is just a trigger |
| Re-score on every taxonomy save? | No. Manual admin button. | Avoids surprise quota burn; gives admin control over when scores change |
| Open Google OAuth or domain-restricted? | Open for v1 | Faster to ship; data is non-sensitive (aggregated public job postings); easy to lock down later |
| Two admins now or one? | One (`shahparan.hasnat@gmail.com`) | User's call. Recommend adding `ashahparan@perscholas.org` as backup before going to prod. |

---

## 15. Contact / handoff context

This brief was generated at the end of a multi-turn design + partial-build session in Claude.ai web chat. The chat hit its useful ceiling for this kind of work (lots of files, lots of cross-references) and we're moving to Claude Code for the remainder. The companion ZIP archive contains the partial scaffold — Claude Code should treat it as authoritative starting state and finish from there rather than rebuilding from scratch.

Good luck. Ship it. 🚀
