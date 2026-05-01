-- 0003_jobs_source.sql
--
-- Add a `source` column to jobs so we can attribute which data feed
-- brought each posting in. Until now all jobs came from Active Jobs DB
-- (the RapidAPI feed); the multi-source refactor introduces TheirStack
-- as a second feed and may add more (Apify, USAJOBS, …) over time.
--
-- Default 'active-jobs-db' for backfill — every existing row predates
-- the multi-source split. New rows from each source are tagged
-- explicitly during upsert.
--
-- Indexed because:
--   1. /admin/qa surfaces per-source counts on a hot path
--   2. We may want to filter the homepage view by source in the future

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'active-jobs-db';

CREATE INDEX IF NOT EXISTS idx_jobs_source ON public.jobs(source);

COMMENT ON COLUMN public.jobs.source IS
  'Which data feed first brought this job into our DB. One of: active-jobs-db, theirstack. Cross-source dedup happens by URL at fetch time; the first source to find a posting owns it.';
