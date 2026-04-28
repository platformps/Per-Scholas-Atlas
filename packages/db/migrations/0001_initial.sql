-- ============================================================================
-- Per Scholas Job Intelligence — Initial Schema Migration
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'viewer');
CREATE TYPE confidence AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'REJECT');
CREATE TYPE trigger_type AS ENUM ('scheduled', 'manual', 'rescore');
CREATE TYPE fetch_status AS ENUM ('running', 'success', 'failed');

-- ============================================================================
-- USERS (mirrors Supabase auth.users)
-- ============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role user_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sign_in_at TIMESTAMPTZ
);

-- Auto-create user record on Supabase auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    CASE
      WHEN NEW.email = 'ashahparan@perscholas.org' THEN 'admin'::user_role
      ELSE 'viewer'::user_role
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET last_sign_in_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- CAMPUSES
-- ============================================================================
CREATE TABLE campuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  default_radius_miles INTEGER NOT NULL DEFAULT 50,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ROLES
-- ============================================================================
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  soc_codes JSONB,
  cip_codes JSONB,
  certifications JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- CAMPUS_ROLES
-- ============================================================================
CREATE TABLE campus_roles (
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  cohort_start_date TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campus_id, role_id)
);

-- ============================================================================
-- TAXONOMIES (versioned)
-- ============================================================================
CREATE TABLE taxonomies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id TEXT NOT NULL REFERENCES roles(id),
  version TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  schema JSONB NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_taxonomies_role_version ON taxonomies(role_id, version);
CREATE INDEX idx_taxonomies_active ON taxonomies(role_id, active);

-- Only one active taxonomy per role
CREATE UNIQUE INDEX idx_taxonomies_one_active_per_role
  ON taxonomies(role_id) WHERE active = TRUE;

-- ============================================================================
-- JOBS (append-only, immutable except for last_seen_at + still_active)
-- ============================================================================
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id TEXT NOT NULL UNIQUE,
  source_ats TEXT,
  url TEXT,
  title TEXT NOT NULL,
  organization TEXT,
  organization_logo TEXT,
  description_text TEXT,
  date_posted TIMESTAMPTZ,
  date_created TIMESTAMPTZ,
  locations_derived JSONB,
  cities_derived JSONB,
  regions_derived JSONB,
  countries_derived JSONB,
  lats_derived JSONB,
  lngs_derived JSONB,
  location_type TEXT,
  employment_type JSONB,
  ai_key_skills JSONB,
  ai_experience_level TEXT,
  ai_employment_type JSONB,
  ai_work_arrangement TEXT,
  ai_salary_min REAL,
  ai_salary_max REAL,
  ai_salary_unittext TEXT,
  linkedin_org_industry TEXT,
  linkedin_org_employees INTEGER,
  linkedin_org_recruitment_agency_derived BOOLEAN,
  raw_payload JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  still_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_jobs_source_id ON jobs(source_id);
CREATE INDEX idx_jobs_still_active ON jobs(still_active);
CREATE INDEX idx_jobs_title ON jobs(title);
CREATE INDEX idx_jobs_org ON jobs(organization);
CREATE INDEX idx_jobs_date_posted ON jobs(date_posted);

-- ============================================================================
-- FETCH_RUNS (forward-declare; job_scores references it)
-- ============================================================================
CREATE TABLE fetch_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trigger_type trigger_type NOT NULL,
  triggered_by UUID REFERENCES users(id),
  campus_id TEXT REFERENCES campuses(id),
  role_id TEXT REFERENCES roles(id),
  status fetch_status NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  jobs_returned INTEGER DEFAULT 0,
  jobs_new INTEGER DEFAULT 0,
  jobs_updated INTEGER DEFAULT 0,
  jobs_marked_inactive INTEGER DEFAULT 0,
  scores_computed INTEGER DEFAULT 0,
  requests_used INTEGER DEFAULT 0,
  quota_jobs_remaining INTEGER,
  quota_requests_remaining INTEGER,
  error_message TEXT,
  query_params JSONB
);
CREATE INDEX idx_fetch_runs_started_at ON fetch_runs(started_at);
CREATE INDEX idx_fetch_runs_campus_role ON fetch_runs(campus_id, role_id);

-- ============================================================================
-- JOB_SCORES (immutable; rescore = new row)
-- ============================================================================
CREATE TABLE job_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  taxonomy_id UUID NOT NULL REFERENCES taxonomies(id),
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  fetch_run_id UUID REFERENCES fetch_runs(id),
  confidence confidence NOT NULL,
  score INTEGER NOT NULL,
  title_tier TEXT,
  title_matched TEXT,
  title_score INTEGER NOT NULL DEFAULT 0,
  core_matched JSONB NOT NULL DEFAULT '[]'::jsonb,
  core_score INTEGER NOT NULL DEFAULT 0,
  specialized_matched JSONB NOT NULL DEFAULT '[]'::jsonb,
  specialized_score INTEGER NOT NULL DEFAULT 0,
  bonus_matched JSONB NOT NULL DEFAULT '[]'::jsonb,
  bonus_score INTEGER NOT NULL DEFAULT 0,
  industry_matched JSONB NOT NULL DEFAULT '[]'::jsonb,
  industry_score INTEGER NOT NULL DEFAULT 0,
  certs_matched JSONB NOT NULL DEFAULT '[]'::jsonb,
  certs_score INTEGER NOT NULL DEFAULT 0,
  employer_hit BOOLEAN NOT NULL DEFAULT FALSE,
  employer_score INTEGER NOT NULL DEFAULT 0,
  experience_penalty INTEGER NOT NULL DEFAULT 0,
  distance_miles REAL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason TEXT,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scores_job_campus ON job_scores(job_id, campus_id);
CREATE INDEX idx_scores_campus_conf ON job_scores(campus_id, confidence);
CREATE INDEX idx_scores_taxonomy ON job_scores(taxonomy_id);
CREATE INDEX idx_scores_scored_at ON job_scores(scored_at);

-- ============================================================================
-- API_USAGE
-- ============================================================================
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  jobs_remaining INTEGER,
  requests_remaining INTEGER,
  jobs_used_this_month INTEGER,
  requests_used_this_month INTEGER,
  bandwidth_mb_used REAL
);

-- ============================================================================
-- AUDIT_LOG
-- ============================================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before JSONB,
  after JSONB,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_occurred_at ON audit_log(occurred_at);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Helper: is current user admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- USERS: anyone authenticated can read; only admin can update roles
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_authenticated" ON users
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "users_update_self_or_admin" ON users
  FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin());

-- CAMPUSES: read for all authenticated; write only admin
ALTER TABLE campuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campuses_select_authenticated" ON campuses
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "campuses_write_admin" ON campuses
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ROLES: read for all; write admin
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_select_authenticated" ON roles
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "roles_write_admin" ON roles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- CAMPUS_ROLES: read all; write admin
ALTER TABLE campus_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campus_roles_select" ON campus_roles
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "campus_roles_write_admin" ON campus_roles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- TAXONOMIES: read all; write admin
ALTER TABLE taxonomies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "taxonomies_select" ON taxonomies
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "taxonomies_write_admin" ON taxonomies
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- JOBS: read all; write only via service role (worker)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_select" ON jobs
  FOR SELECT TO authenticated USING (TRUE);
-- (no write policy → only service_role can write)

-- JOB_SCORES: read all; write only via service role
ALTER TABLE job_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_scores_select" ON job_scores
  FOR SELECT TO authenticated USING (TRUE);

-- FETCH_RUNS: read all; write service role
ALTER TABLE fetch_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fetch_runs_select" ON fetch_runs
  FOR SELECT TO authenticated USING (TRUE);

-- API_USAGE: read admin only; write service role
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_usage_select_admin" ON api_usage
  FOR SELECT TO authenticated USING (public.is_admin());

-- AUDIT_LOG: read admin only; write authenticated
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_select_admin" ON audit_log
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "audit_log_insert_authenticated" ON audit_log
  FOR INSERT TO authenticated WITH CHECK (TRUE);
