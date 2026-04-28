'use client';

// Top-of-page filter bar — drives the four homepage modes via URL params.
//
// State model:
//   /                         → aggregate (no filters)
//   /?role=cft                → role-first (compare campuses for a role)
//   /?campus=atlanta          → campus-first (roles for a campus)
//   /?campus=atlanta&role=cft → focused detail (existing dashboard view)
//
// The bar is rendered immediately under the brand-accent supergraphic. Two
// dropdowns plus a "Clear" pill when any filter is active. We keep this
// client-side so changes feel instant — selection does a router.push() to
// update the URL, and the server component re-renders the view.

import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '../ui/badge';

export interface CampusOpt {
  id: string;
  name: string;
}

export interface RoleOpt {
  id: string;
  name: string;
}

interface HomeFilterBarProps {
  campuses: CampusOpt[];
  roles: RoleOpt[];
  activeCampusId: string | null;
  activeRoleId: string | null;
}

export function HomeFilterBar({
  campuses,
  roles,
  activeCampusId,
  activeRoleId,
}: HomeFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(next: { campus?: string | null; role?: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.campus !== undefined) {
      if (next.campus) params.set('campus', next.campus);
      else params.delete('campus');
    }
    if (next.role !== undefined) {
      if (next.role) params.set('role', next.role);
      else params.delete('role');
    }
    // Clearing a filter shouldn't drag the confidence drilldown along.
    if ((next.campus === null || next.role === null) && !next.campus && !next.role) {
      params.delete('confidence');
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  }

  const hasFilter = !!(activeCampusId || activeRoleId);

  return (
    <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Filter
          </span>
        </div>

        <FilterSelect
          label="Role"
          ariaLabel="Filter by role"
          value={activeRoleId ?? ''}
          options={roles}
          allLabel="All roles"
          onChange={value => navigate({ role: value || null })}
        />

        <FilterSelect
          label="Campus"
          ariaLabel="Filter by campus"
          value={activeCampusId ?? ''}
          options={campuses}
          allLabel="All campuses"
          onChange={value => navigate({ campus: value || null })}
        />

        {hasFilter && (
          <button
            type="button"
            onClick={() => navigate({ campus: null, role: null })}
            className="text-xs text-gray-600 hover:text-night underline transition-colors duration-150"
          >
            Clear filters
          </button>
        )}

        <ModeBadge campusId={activeCampusId} roleId={activeRoleId} />
      </div>
    </div>
  );
}

// ─── select primitive (compact, label-prefixed) ─────────────────────────────
function FilterSelect({
  label,
  ariaLabel,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: { id: string; name: string }[];
  allLabel: string;
  onChange: (next: string) => void;
}) {
  const active = !!value;
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-xs text-gray-500">{label}:</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={[
          'border rounded-sm px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-royal/30 transition-colors duration-150',
          active
            ? 'border-royal text-night font-semibold'
            : 'border-gray-300 text-gray-700',
        ].join(' ')}
      >
        <option value="">{allLabel}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── mode tag — gives the user a clear read of which view they're in ───────
function ModeBadge({
  campusId,
  roleId,
}: {
  campusId: string | null;
  roleId: string | null;
}) {
  const [tone, label]: ['gray' | 'royal' | 'ocean' | 'navy', string] =
    !campusId && !roleId ? ['gray', 'Overview · all campuses · all roles'] :
    campusId && roleId ? ['navy', 'Focused detail'] :
    roleId ? ['royal', 'Compare campuses'] :
              ['ocean', 'Compare roles'];
  return (
    <div className="ml-auto">
      <Badge tone={tone} variant="soft" size="sm">
        {label}
      </Badge>
    </div>
  );
}
