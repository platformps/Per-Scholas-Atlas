-- 0002_home_campus.sql
--
-- Add a per-user "home campus" preference. When set, /atlas auto-anchors
-- on this campus on every visit instead of showing the all-campus aggregate.
-- An MD assigned to Newark wants to land directly on Newark, not on the
-- 25-campus overview, every time they open the dashboard.
--
-- Nullable: not every user has a home campus (admins, observers).
-- ON DELETE SET NULL: if a campus is deleted, the user's preference is
-- cleared rather than leaving them stuck on a phantom campus_id.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS home_campus_id text
  REFERENCES public.campuses(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.users.home_campus_id IS
  'Optional pinned campus. When set, the homepage auto-redirects to ?campus=<id> on / with no params.';
