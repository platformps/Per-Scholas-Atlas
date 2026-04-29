// /admin/taxonomies/diff — compare two taxonomy versions for a role.
//
// Answers "what actually changed in cft v1.1.4 vs v1.1.3?" without grepping
// commit logs. CFT has 5 versions; LVFT has 3; future taxonomy work will
// add more, and the version_notes field is helpful but doesn't always
// itemize. This page diffs the schemas directly.
//
// URL contract: /admin/taxonomies/diff?role=cft&from=1.1.3&to=1.1.4
//   role  — required; the taxonomy role_id
//   from  — version on the LEFT (older)
//   to    — version on the RIGHT (newer); defaults to active version
//
// If from/to aren't provided we render the role + version pickers; otherwise
// we render the diff. The pickers post a GET to the same URL with query
// params so the diff is bookmarkable / shareable.
//
// What's diffed (in order):
//   • Version notes (full text, both columns)
//   • Thresholds (HIGH / MEDIUM / LOW)
//   • Geography (default radius)
//   • Title tier A phrases — added / removed
//   • Title tier B phrases — added / removed
//   • Title exclusions — added / removed (split by sub-list)
//   • Description disqualifiers (credentials)
//   • Industry context phrases
//   • Employer watchlist (per category)
//
// Tier C/D phrases are skipped — currently unused on every active taxonomy.

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { AppShell } from '@/components/layout/app-shell';
import { Header, NavLinks } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { role?: string; from?: string; to?: string };
}

export default async function TaxonomyDiffPage({ searchParams }: PageProps) {
  const user = await requireAdmin('/admin/taxonomies/diff');
  const sb = createClient();

  const roleId = searchParams.role?.trim() || null;
  const fromVersion = searchParams.from?.trim() || null;
  const toVersion = searchParams.to?.trim() || null;

  // Load the role list + all versions for the chosen role (for the pickers).
  const { data: rolesRaw } = await sb.from('roles').select('id, name').order('name');
  const roles = (rolesRaw ?? []) as Array<{ id: string; name: string }>;

  let versions: Array<{ id: string; version: string; active: boolean; created_at: string }> = [];
  if (roleId) {
    const { data: vs } = await sb
      .from('taxonomies')
      .select('id, version, active, created_at')
      .eq('role_id', roleId)
      .order('created_at', { ascending: false });
    versions = (vs ?? []) as Array<{ id: string; version: string; active: boolean; created_at: string }>;
  }

  // Fetch the two schemas if both are picked.
  let fromSchema: TaxonomySchema | null = null;
  let toSchema: TaxonomySchema | null = null;
  if (roleId && fromVersion && toVersion) {
    const { data: pair } = await sb
      .from('taxonomies')
      .select('version, schema')
      .eq('role_id', roleId)
      .in('version', [fromVersion, toVersion]);
    for (const row of (pair ?? []) as Array<{ version: string; schema: TaxonomySchema }>) {
      if (row.version === fromVersion) fromSchema = row.schema;
      if (row.version === toVersion) toSchema = row.schema;
    }
  }

  const ready = roleId && fromVersion && toVersion && fromSchema && toSchema;
  const roleName = roleId ? (roles.find(r => r.id === roleId)?.name ?? roleId) : null;

  return (
    <AppShell
      header={
        <Header
          subtitle={<span className="text-sm text-gray-500">Admin · Taxonomy diff</span>}
          meta={roleName ? `Comparing ${roleName} versions` : 'Pick a role and two versions to diff.'}
          nav={
            <NavLinks
              email={user.email}
              active="admin"
              showAdminLink
              pinnedCampusId={user.homeCampusId}
            />
          }
        />
      }
      footer={<Footer />}
    >
      <div className="space-y-5">
        <PickerCard
          roles={roles}
          versions={versions}
          roleId={roleId}
          fromVersion={fromVersion}
          toVersion={toVersion}
        />

        {ready && fromSchema && toSchema && (
          <DiffBody
            roleName={roleName ?? roleId!}
            fromVersion={fromVersion!}
            toVersion={toVersion!}
            fromSchema={fromSchema}
            toSchema={toSchema}
          />
        )}
      </div>
    </AppShell>
  );
}

// ─── Picker (form) ──────────────────────────────────────────────────────────
function PickerCard({
  roles,
  versions,
  roleId,
  fromVersion,
  toVersion,
}: {
  roles: Array<{ id: string; name: string }>;
  versions: Array<{ id: string; version: string; active: boolean; created_at: string }>;
  roleId: string | null;
  fromVersion: string | null;
  toVersion: string | null;
}) {
  return (
    <Card>
      <div className="px-5 sm:px-6 py-4 border-b border-gray-200 bg-cloud">
        <h3 className="text-sm font-semibold text-night">Pick a role and two versions</h3>
        <p className="text-xs text-gray-600 mt-0.5">
          The diff renders below. Bookmark the URL to share a specific comparison.
        </p>
      </div>
      <form method="GET" className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5 block">
            Role
          </span>
          <select
            name="role"
            defaultValue={roleId ?? ''}
            className="w-full text-sm border border-gray-300 rounded-sm px-2 py-1.5"
          >
            <option value="">— Pick a role —</option>
            {roles.map(r => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.id})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5 block">
            From version (older)
          </span>
          <select
            name="from"
            defaultValue={fromVersion ?? ''}
            className="w-full text-sm border border-gray-300 rounded-sm px-2 py-1.5"
            disabled={versions.length === 0}
          >
            <option value="">— Pick a version —</option>
            {versions.map(v => (
              <option key={v.id} value={v.version}>
                v{v.version}
                {v.active ? ' · active' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5 block">
            To version (newer)
          </span>
          <select
            name="to"
            defaultValue={toVersion ?? ''}
            className="w-full text-sm border border-gray-300 rounded-sm px-2 py-1.5"
            disabled={versions.length === 0}
          >
            <option value="">— Pick a version —</option>
            {versions.map(v => (
              <option key={v.id} value={v.version}>
                v{v.version}
                {v.active ? ' · active' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-3 flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center px-4 py-2 text-sm font-semibold uppercase tracking-wider rounded-sm bg-royal text-white hover:bg-navy transition-colors duration-150"
          >
            Compare
          </button>
          {versions.length === 0 && roleId && (
            <span className="text-xs text-gray-500">
              No taxonomy versions found for this role.
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

// ─── Diff body ──────────────────────────────────────────────────────────────
interface TaxonomySchema {
  version_notes?: string;
  scoring?: { thresholds?: { high?: number; medium?: number; low?: number } };
  geography?: { default_radius_miles?: number };
  title_tiers?: {
    A?: { phrases?: string[] };
    B?: { phrases?: string[] };
  };
  title_exclusions?: Record<string, unknown>;
  description_disqualifiers?: { credentials?: string[] };
  industry_context?: { phrases?: string[] };
  employer_watchlist?: {
    categories?: Record<string, { is_healthcare?: boolean; employers?: string[] }>;
  };
}

function DiffBody({
  roleName,
  fromVersion,
  toVersion,
  fromSchema,
  toSchema,
}: {
  roleName: string;
  fromVersion: string;
  toVersion: string;
  fromSchema: TaxonomySchema;
  toSchema: TaxonomySchema;
}) {
  const tA = phraseDiff(fromSchema.title_tiers?.A?.phrases, toSchema.title_tiers?.A?.phrases);
  const tB = phraseDiff(fromSchema.title_tiers?.B?.phrases, toSchema.title_tiers?.B?.phrases);
  const ic = phraseDiff(
    fromSchema.industry_context?.phrases,
    toSchema.industry_context?.phrases,
  );
  const credsDiff = phraseDiff(
    fromSchema.description_disqualifiers?.credentials,
    toSchema.description_disqualifiers?.credentials,
  );

  // Title exclusions can have arbitrary sub-lists (seniority, wrong_discipline,
  // controls_programming, etc). Diff each list separately so changes are
  // attributed to the right category.
  const exclusionsFrom = fromSchema.title_exclusions ?? {};
  const exclusionsTo = toSchema.title_exclusions ?? {};
  const exclusionKeys = new Set<string>([
    ...Object.keys(exclusionsFrom),
    ...Object.keys(exclusionsTo),
  ]);
  exclusionKeys.delete('description'); // schema field, not a list
  const exclusionsDiffs = Array.from(exclusionKeys)
    .sort()
    .map(k => ({
      key: k,
      diff: phraseDiff(
        Array.isArray(exclusionsFrom[k]) ? (exclusionsFrom[k] as string[]) : undefined,
        Array.isArray(exclusionsTo[k]) ? (exclusionsTo[k] as string[]) : undefined,
      ),
    }))
    .filter(x => x.diff.added.length + x.diff.removed.length > 0);

  // Watchlist categories — diff each category's employer list.
  const wlFrom = fromSchema.employer_watchlist?.categories ?? {};
  const wlTo = toSchema.employer_watchlist?.categories ?? {};
  const wlKeys = new Set<string>([...Object.keys(wlFrom), ...Object.keys(wlTo)]);
  const watchlistDiffs = Array.from(wlKeys)
    .sort()
    .map(k => ({
      key: k,
      diff: phraseDiff(wlFrom[k]?.employers, wlTo[k]?.employers),
      from_present: !!wlFrom[k],
      to_present: !!wlTo[k],
    }));
  const watchlistChanged = watchlistDiffs.filter(
    w => w.diff.added.length + w.diff.removed.length > 0 || w.from_present !== w.to_present,
  );

  const fromThresh = fromSchema.scoring?.thresholds ?? {};
  const toThresh = toSchema.scoring?.thresholds ?? {};
  const thresholdsChanged =
    fromThresh.high !== toThresh.high ||
    fromThresh.medium !== toThresh.medium ||
    fromThresh.low !== toThresh.low;

  const fromRadius = fromSchema.geography?.default_radius_miles ?? null;
  const toRadius = toSchema.geography?.default_radius_miles ?? null;
  const radiusChanged = fromRadius !== toRadius;

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <Card>
        <div className="px-5 sm:px-6 py-4 flex flex-wrap items-baseline gap-3">
          <Badge tone="navy" variant="soft" size="md">
            {roleName}
          </Badge>
          <span className="text-sm text-gray-700">
            <span className="text-gray-500">v{fromVersion}</span>
            <span className="mx-2 text-gray-400">→</span>
            <span className="text-night font-semibold">v{toVersion}</span>
          </span>
        </div>
      </Card>

      {/* Version notes (read-only, side-by-side) */}
      <DiffSection title="Version notes">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <NotesPanel header={`v${fromVersion}`} text={fromSchema.version_notes ?? ''} />
          <NotesPanel header={`v${toVersion}`} text={toSchema.version_notes ?? ''} />
        </div>
      </DiffSection>

      {/* Scalar deltas */}
      {(thresholdsChanged || radiusChanged) && (
        <DiffSection title="Scalar settings">
          <ul className="text-sm text-gray-800 space-y-1.5">
            {thresholdsChanged && (
              <>
                <ScalarDelta
                  label="HIGH threshold"
                  from={fromThresh.high}
                  to={toThresh.high}
                />
                <ScalarDelta
                  label="MEDIUM threshold"
                  from={fromThresh.medium}
                  to={toThresh.medium}
                />
                <ScalarDelta
                  label="LOW threshold"
                  from={fromThresh.low}
                  to={toThresh.low}
                />
              </>
            )}
            {radiusChanged && (
              <ScalarDelta
                label="Default radius (miles)"
                from={fromRadius}
                to={toRadius}
              />
            )}
          </ul>
        </DiffSection>
      )}

      {/* Title tier A */}
      <PhraseDiffSection title="Title Tier A phrases" diff={tA} />

      {/* Title tier B */}
      <PhraseDiffSection title="Title Tier B phrases" diff={tB} />

      {/* Title exclusions */}
      {exclusionsDiffs.length > 0 && (
        <DiffSection title="Title exclusions">
          <div className="space-y-4">
            {exclusionsDiffs.map(({ key, diff }) => (
              <div key={key}>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  {key.replace(/_/g, ' ')}
                </div>
                <PhrasePillRow tone="royal" label="Added" items={diff.added} />
                <PhrasePillRow tone="orange" label="Removed" items={diff.removed} />
              </div>
            ))}
          </div>
        </DiffSection>
      )}

      {/* Description disqualifiers */}
      <PhraseDiffSection
        title="Description disqualifiers · credentials"
        diff={credsDiff}
      />

      {/* Industry context */}
      <PhraseDiffSection title="Industry context phrases" diff={ic} />

      {/* Watchlist */}
      {watchlistChanged.length > 0 && (
        <DiffSection title="Employer watchlist">
          <div className="space-y-4">
            {watchlistChanged.map(({ key, diff, from_present, to_present }) => (
              <div key={key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {key.replace(/_/g, ' ')}
                  </span>
                  {!from_present && (
                    <Badge tone="royal" variant="soft" size="sm">
                      new category
                    </Badge>
                  )}
                  {!to_present && (
                    <Badge tone="orange" variant="soft" size="sm">
                      removed category
                    </Badge>
                  )}
                </div>
                <PhrasePillRow tone="royal" label="Added" items={diff.added} />
                <PhrasePillRow tone="orange" label="Removed" items={diff.removed} />
              </div>
            ))}
          </div>
        </DiffSection>
      )}
    </div>
  );
}

// ─── Section primitives ─────────────────────────────────────────────────────
function DiffSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="px-5 sm:px-6 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-night">{title}</h3>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </Card>
  );
}

function NotesPanel({ header, text }: { header: string; text: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        {header}
      </div>
      <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-sm p-3 max-h-[420px] overflow-y-auto">
        {text || <span className="text-gray-400 italic">no notes</span>}
      </div>
    </div>
  );
}

function ScalarDelta({
  label,
  from,
  to,
}: {
  label: string;
  from: number | null | undefined;
  to: number | null | undefined;
}) {
  if (from === to) return null;
  return (
    <li className="flex items-baseline gap-3">
      <span className="text-gray-500 w-[180px] flex-shrink-0">{label}</span>
      <span className="text-gray-400 tabular-nums">{from ?? '—'}</span>
      <span className="text-gray-300">→</span>
      <span className="text-night font-medium tabular-nums">{to ?? '—'}</span>
    </li>
  );
}

function PhraseDiffSection({
  title,
  diff,
}: {
  title: string;
  diff: { added: string[]; removed: string[]; unchanged: number };
}) {
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return (
      <DiffSection title={title}>
        <p className="text-sm text-gray-500">
          No changes — {diff.unchanged} phrase{diff.unchanged === 1 ? '' : 's'} unchanged.
        </p>
      </DiffSection>
    );
  }
  return (
    <DiffSection title={title}>
      <p className="text-xs text-gray-500 mb-3">
        {diff.added.length} added · {diff.removed.length} removed · {diff.unchanged} unchanged
      </p>
      <PhrasePillRow tone="royal" label="Added" items={diff.added} />
      <PhrasePillRow tone="orange" label="Removed" items={diff.removed} />
    </DiffSection>
  );
}

function PhrasePillRow({
  tone,
  label,
  items,
}: {
  tone: 'royal' | 'orange';
  label: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label} ({items.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(p => (
          <Badge key={p} tone={tone} variant="soft" size="sm">
            {p}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ─── Utility ────────────────────────────────────────────────────────────────
// Diff two phrase lists. Case-insensitive comparison (matches scoring engine
// behavior) but the displayed text uses the casing from the side that has it.
function phraseDiff(
  fromList: string[] | null | undefined,
  toList: string[] | null | undefined,
): { added: string[]; removed: string[]; unchanged: number } {
  const fromSet = new Map<string, string>();
  const toSet = new Map<string, string>();
  for (const p of fromList ?? []) fromSet.set(p.toLowerCase(), p);
  for (const p of toList ?? []) toSet.set(p.toLowerCase(), p);
  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  for (const [k, v] of toSet) {
    if (!fromSet.has(k)) added.push(v);
    else unchanged += 1;
  }
  for (const [k, v] of fromSet) {
    if (!toSet.has(k)) removed.push(v);
  }
  added.sort();
  removed.sort();
  return { added, removed, unchanged };
}
