import { pgTable, uuid, text, timestamp, integer, real, boolean, jsonb, pgEnum, primaryKey, index } from 'drizzle-orm/pg-core';

// ============================================================================
// ENUMS
// ============================================================================
export const userRoleEnum = pgEnum('user_role', ['admin', 'viewer']);
export const confidenceEnum = pgEnum('confidence', ['HIGH', 'MEDIUM', 'LOW', 'REJECT']);
export const triggerTypeEnum = pgEnum('trigger_type', ['scheduled', 'manual', 'rescore']);
export const fetchStatusEnum = pgEnum('fetch_status', ['running', 'success', 'failed']);

// ============================================================================
// USERS — mirrors Supabase auth.users for FK; role drives authorization
// ============================================================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // matches auth.users.id
  email: text('email').notNull().unique(),
  fullName: text('full_name'),
  role: userRoleEnum('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
});

// ============================================================================
// CAMPUSES — all Per Scholas locations
// ============================================================================
export const campuses = pgTable('campuses', {
  id: text('id').primaryKey(), // slug e.g. 'atlanta', 'bronx'
  name: text('name').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  defaultRadiusMiles: integer('default_radius_miles').notNull().default(50),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// ROLES — curriculum-aligned role families (CFT, Cyber, IT Support, ...)
// ============================================================================
export const roles = pgTable('roles', {
  id: text('id').primaryKey(), // slug e.g. 'cft', 'cyber', 'it-support'
  name: text('name').notNull(),
  description: text('description'),
  socCodes: jsonb('soc_codes').$type<string[]>(),
  cipCodes: jsonb('cip_codes').$type<string[]>(),
  certifications: jsonb('certifications').$type<string[]>(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// CAMPUS_ROLES — which campuses run which roles
// ============================================================================
export const campusRoles = pgTable('campus_roles', {
  campusId: text('campus_id').notNull().references(() => campuses.id),
  roleId: text('role_id').notNull().references(() => roles.id),
  active: boolean('active').notNull().default(true),
  cohortStartDate: timestamp('cohort_start_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.campusId, t.roleId] }),
}));

// ============================================================================
// TAXONOMIES — versioned mappings from curriculum to job-data signal
// ============================================================================
export const taxonomies = pgTable('taxonomies', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: text('role_id').notNull().references(() => roles.id),
  version: text('version').notNull(),
  active: boolean('active').notNull().default(false),
  schema: jsonb('schema').notNull(), // the full taxonomy JSON
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  roleVersionIdx: index('idx_taxonomies_role_version').on(t.roleId, t.version),
  activeIdx: index('idx_taxonomies_active').on(t.roleId, t.active),
}));

// ============================================================================
// JOBS — append-only, immutable; matched on source_id from API
// ============================================================================
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: text('source_id').notNull().unique(), // The API's id field
  sourceAts: text('source_ats'), // greenhouse, lever, workday, etc.
  url: text('url'),

  // Core fields
  title: text('title').notNull(),
  organization: text('organization'),
  organizationLogo: text('organization_logo'),
  descriptionText: text('description_text'),
  datePosted: timestamp('date_posted', { withTimezone: true }),
  dateCreated: timestamp('date_created', { withTimezone: true }),

  // Location
  locationsDerived: jsonb('locations_derived').$type<string[]>(),
  citiesDerived: jsonb('cities_derived').$type<string[]>(),
  regionsDerived: jsonb('regions_derived').$type<string[]>(),
  countriesDerived: jsonb('countries_derived').$type<string[]>(),
  latsDerived: jsonb('lats_derived').$type<number[]>(),
  lngsDerived: jsonb('lngs_derived').$type<number[]>(),
  locationType: text('location_type'),
  employmentType: jsonb('employment_type').$type<string[]>(),

  // AI enrichments
  aiKeySkills: jsonb('ai_key_skills').$type<string[]>(),
  aiExperienceLevel: text('ai_experience_level'),
  aiEmploymentType: jsonb('ai_employment_type').$type<string[]>(),
  aiWorkArrangement: text('ai_work_arrangement'),
  aiSalaryMin: real('ai_salary_min'),
  aiSalaryMax: real('ai_salary_max'),
  aiSalaryUnittext: text('ai_salary_unittext'),

  // LinkedIn enrichments
  linkedinOrgIndustry: text('linkedin_org_industry'),
  linkedinOrgEmployees: integer('linkedin_org_employees'),
  linkedinOrgRecruitmentAgencyDerived: boolean('linkedin_org_recruitment_agency_derived'),

  // Forensic / raw
  rawPayload: jsonb('raw_payload'),

  // Reconciliation
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  stillActive: boolean('still_active').notNull().default(true),
}, (t) => ({
  sourceIdIdx: index('idx_jobs_source_id').on(t.sourceId),
  stillActiveIdx: index('idx_jobs_still_active').on(t.stillActive),
  titleIdx: index('idx_jobs_title').on(t.title),
  orgIdx: index('idx_jobs_org').on(t.organization),
  datePostedIdx: index('idx_jobs_date_posted').on(t.datePosted),
}));

// ============================================================================
// JOB_SCORES — immutable per (job, taxonomy_version, campus); append on rescore
// ============================================================================
export const jobScores = pgTable('job_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  taxonomyId: uuid('taxonomy_id').notNull().references(() => taxonomies.id),
  campusId: text('campus_id').notNull().references(() => campuses.id),
  fetchRunId: uuid('fetch_run_id').references(() => fetchRuns.id),

  confidence: confidenceEnum('confidence').notNull(),
  score: integer('score').notNull(),
  titleTier: text('title_tier'), // 'A' | 'B' | 'C' | 'D' | null
  titleMatched: text('title_matched'),
  titleScore: integer('title_score').notNull().default(0),

  coreMatched: jsonb('core_matched').$type<string[]>().notNull().default([]),
  coreScore: integer('core_score').notNull().default(0),
  specializedMatched: jsonb('specialized_matched').$type<string[]>().notNull().default([]),
  specializedScore: integer('specialized_score').notNull().default(0),
  bonusMatched: jsonb('bonus_matched').$type<string[]>().notNull().default([]),
  bonusScore: integer('bonus_score').notNull().default(0),
  industryMatched: jsonb('industry_matched').$type<string[]>().notNull().default([]),
  industryScore: integer('industry_score').notNull().default(0),
  certsMatched: jsonb('certs_matched').$type<string[]>().notNull().default([]),
  certsScore: integer('certs_score').notNull().default(0),
  employerHit: boolean('employer_hit').notNull().default(false),
  employerScore: integer('employer_score').notNull().default(0),
  experiencePenalty: integer('experience_penalty').notNull().default(0),

  distanceMiles: real('distance_miles'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  rejectionReason: text('rejection_reason'),

  scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  jobCampusIdx: index('idx_scores_job_campus').on(t.jobId, t.campusId),
  campusConfIdx: index('idx_scores_campus_conf').on(t.campusId, t.confidence),
  taxonomyIdx: index('idx_scores_taxonomy').on(t.taxonomyId),
  scoredAtIdx: index('idx_scores_scored_at').on(t.scoredAt),
}));

// ============================================================================
// FETCH_RUNS — every API pull is logged
// ============================================================================
export const fetchRuns = pgTable('fetch_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  triggerType: triggerTypeEnum('trigger_type').notNull(),
  triggeredBy: uuid('triggered_by').references(() => users.id),
  campusId: text('campus_id').references(() => campuses.id),
  roleId: text('role_id').references(() => roles.id),
  status: fetchStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  jobsReturned: integer('jobs_returned').default(0),
  jobsNew: integer('jobs_new').default(0),
  jobsUpdated: integer('jobs_updated').default(0),
  jobsMarkedInactive: integer('jobs_marked_inactive').default(0),
  scoresComputed: integer('scores_computed').default(0),
  requestsUsed: integer('requests_used').default(0),
  quotaJobsRemaining: integer('quota_jobs_remaining'),
  quotaRequestsRemaining: integer('quota_requests_remaining'),
  errorMessage: text('error_message'),
  queryParams: jsonb('query_params'),
}, (t) => ({
  startedAtIdx: index('idx_fetch_runs_started_at').on(t.startedAt),
  campusRoleIdx: index('idx_fetch_runs_campus_role').on(t.campusId, t.roleId),
}));

// ============================================================================
// API_USAGE — quota tracking over time
// ============================================================================
export const apiUsage = pgTable('api_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  jobsRemaining: integer('jobs_remaining'),
  requestsRemaining: integer('requests_remaining'),
  jobsUsedThisMonth: integer('jobs_used_this_month'),
  requestsUsedThisMonth: integer('requests_used_this_month'),
  bandwidthMbUsed: real('bandwidth_mb_used'),
});

// ============================================================================
// AUDIT_LOG — every admin action recorded
// ============================================================================
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  userEmail: text('user_email'),
  action: text('action').notNull(), // 'taxonomy.update', 'fetch.manual', 'campus.create', etc.
  entityType: text('entity_type'), // 'taxonomy', 'campus', 'role', 'fetch_run'
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('idx_audit_user').on(t.userId),
  actionIdx: index('idx_audit_action').on(t.action),
  occurredAtIdx: index('idx_audit_occurred_at').on(t.occurredAt),
}));
