# Operations

Day-2 reference: what happens during fetches, how to interpret quota, when to re-score, how to recover from failures.

---

## Quota model

RapidAPI Active Jobs DB Ultra plan limits (as of v1 build):

| Resource | Monthly limit | Notes |
|---|---|---|
| Jobs returned | 20,000 | Each row in any API response counts as 1 |
| Requests | 20,000 | Each HTTP call counts as 1 |
| Bandwidth | 10,240 MB | Rarely the bottleneck |
| Rate limit | 5 requests/sec | Hard cap |

The dashboard's "quota remaining" is read from the `x-ratelimit-jobs-remaining` header captured on the most recent fetch and stored in `api_usage`.

### Quota math at v1 scope

- 1 fetch/week × 4–5 weeks/month = ~5 fetches/month
- ~100 jobs returned per fetch (Atlanta CFT)
- ~500 jobs/month consumed → **2.5% of quota**

You have a lot of headroom. Even adding 5 more campuses + 3 more roles, you'd be at ~30% utilization.

### Quota guard behavior

The `/api/fetch` route refuses to fetch if `jobs_remaining < 3000` (15% of cap). This is conservative and intentional — it's better to skip a fetch than to overage and break billing.

To override the guard (one-time emergency), an admin can manually edit `api_usage` to set a higher `jobs_remaining`, but this is documented for traceability — don't make it a habit.

---

## Fetch types

### Scheduled fetch
Runs Mondays at 11am UTC via GitHub Actions. Calls `/api/fetch` with `trigger_type=scheduled` and `x-cron-secret` header. No throttle (relied upon to be the canonical weekly source).

### Manual fetch
Admin-only. Triggered from the dashboard button. Same code path; `trigger_type=manual`. Throttled to **max 1 per (campus, role) per 24 hours** to prevent quota waste.

### Re-score (Phase 2)
Will apply the active taxonomy to existing jobs without calling RapidAPI. Free in API quota terms. Useful when:
- You've edited the taxonomy and want to see new scores immediately
- You've fixed a campus's lat/lng and want to recompute distance-based filters

The scoring engine (`packages/scoring/`) is already standalone-callable; the API route just isn't wired yet.

---

## Reading a fetch_run

```sql
select * from public.fetch_runs order by started_at desc limit 1;
```

| Field | What it tells you |
|---|---|
| `status` | `running` (in progress), `success`, `failed` |
| `jobs_returned` | How many came back from RapidAPI |
| `jobs_new` | First-time-seen jobs |
| `jobs_updated` | Already-known jobs that re-appeared |
| `jobs_marked_inactive` | Previously-active jobs that didn't appear this fetch |
| `scores_computed` | Should equal `jobs_returned` (every returned job gets scored) |
| `quota_jobs_remaining` | Snapshot at end of fetch |
| `error_message` | Populated on failure |

If `status='running'` but `started_at` is hours ago, the route crashed without finalizing. Manually mark it failed:

```sql
update public.fetch_runs
set status='failed', finished_at=now(), error_message='Manual cleanup'
where id='<id>' and status='running';
```

---

## Common fetch failures

### `RapidAPI 429: rate limit exceeded`
You hit the per-second rate limit. Shouldn't happen at v1 scope (1 request per fetch). If it does, check whether multiple fetches are firing concurrently.

### `RapidAPI 403: not subscribed`
Subscription lapsed or key rotated. Check RapidAPI dashboard.

### `RapidAPI 500: server error`
Their problem. Wait 5 minutes and retry. If persistent, check status.rapidapi.com.

### `Quota too low`
Local quota guard tripped. Either:
- Wait for monthly reset (check RapidAPI dashboard for date)
- Upgrade plan
- Override (see Quota guard section above) if you're sure the local count is stale

### `No active taxonomy for role X`
Seed script wasn't run. From repo root:

```bash
pnpm seed
```

### `Failed to create fetch run: ...`
Database write failure. Check Supabase status. Check that service role key in Vercel env is correct.

---

## Daily/weekly operational checks

**Weekly (Monday afternoon):**
- Confirm Monday's scheduled fetch ran (`fetch_runs` has a row dated today, status=success)
- Glance at quota_jobs_remaining (should be steadily decreasing, not jumping)
- Spot-check 3 HIGH-confidence jobs for accuracy

**Monthly:**
- Review which jobs went `still_active=false` (employer pulled posting → demand signal)
- Compare top employers month-over-month
- Decide if taxonomy needs tuning (see [`taxonomy-guide.md`](taxonomy-guide.md))

**Quarterly:**
- Bump taxonomy version with refinements
- Review which campus_roles to activate
- Consider Phase 2 / Phase 3 work

---

## Backups

Supabase Pro tier includes daily backups with 7-day retention. Free tier doesn't — for v1 on Free tier, recommended:

- Weekly manual export of `jobs`, `job_scores`, `taxonomies`, `fetch_runs` to S3
- Or: upgrade to Pro ($25/mo) when you hit the free tier database size limit

Migrations and taxonomy JSONs live in git, so the schema and configuration are inherently backed up.

---

## Cost monitoring

Check monthly:
- RapidAPI dashboard: actual usage vs plan limit
- Vercel dashboard: function invocation count, bandwidth
- Supabase dashboard: database size, egress, monthly active users

Alerting on these is Phase 2.

---

## Disaster recovery

**Lost the Vercel deployment:**
- Re-import from GitHub
- Re-add env vars (Supabase keys, RAPIDAPI_KEY, CRON_SECRET, NEXT_PUBLIC_SITE_URL)
- Re-deploy

**Lost the Supabase project:**
- Create new Supabase project
- Apply migrations: `supabase db push`
- Run seed: `pnpm seed`
- Update Vercel env vars to new project URL/keys
- Update Google OAuth redirect URI to new Supabase URL
- ⚠️ Job history is lost unless you have backups

**Compromised admin email:**
- Revoke admin access in `public.users` (set role='viewer')
- Rotate Google OAuth client secret in Google Cloud
- Rotate Supabase service role key (Settings → API → Reset)
- Rotate RAPIDAPI_KEY in RapidAPI dashboard
- Update Vercel env vars
- Redeploy
