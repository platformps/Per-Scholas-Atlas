'use client';

// Dashboard campus/role picker — small dropdown(s) in the header that update
// the URL searchParams. The page is a server component that re-renders on
// navigation, so changing the dropdown causes a fresh fetch with the new
// active pair.
//
// Two dropdowns when more than one role exists, otherwise just the campus
// dropdown. Hidden entirely when only one active pair (the v1 case).

import { useRouter, useSearchParams } from 'next/navigation';

interface PairOption {
  campus_id: string;
  campus_name: string;
  role_id: string;
  role_name: string;
}

interface CampusRolePickerProps {
  pairs: PairOption[];
  activeCampusId: string;
  activeRoleId: string;
}

export function CampusRolePicker({ pairs, activeCampusId, activeRoleId }: CampusRolePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Hide entirely if only one active pair — there's nothing to pick.
  if (pairs.length <= 1) return null;

  // Distinct lists for the two dropdowns. Roles available for the active
  // campus only; campuses available for the active role only — keeps the
  // dropdowns to legal combinations.
  const campusesForRole = Array.from(
    new Map(
      pairs.filter(p => p.role_id === activeRoleId).map(p => [p.campus_id, p]),
    ).values(),
  );
  const rolesForCampus = Array.from(
    new Map(
      pairs.filter(p => p.campus_id === activeCampusId).map(p => [p.role_id, p]),
    ).values(),
  );

  function navigate(nextCampus: string, nextRole: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('campus', nextCampus);
    params.set('role', nextRole);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {campusesForRole.length > 1 && (
        <select
          value={activeCampusId}
          onChange={e => navigate(e.target.value, activeRoleId)}
          className="border border-gray-300 rounded-sm px-2 py-1 text-sm bg-white text-night focus:outline-none focus:ring-2 focus:ring-royal/30 focus:border-royal transition-colors duration-150"
          aria-label="Select campus"
        >
          {campusesForRole.map(p => (
            <option key={p.campus_id} value={p.campus_id}>
              {p.campus_name}
            </option>
          ))}
        </select>
      )}
      {rolesForCampus.length > 1 && (
        <select
          value={activeRoleId}
          onChange={e => navigate(activeCampusId, e.target.value)}
          className="border border-gray-300 rounded-sm px-2 py-1 text-sm bg-white text-night focus:outline-none focus:ring-2 focus:ring-royal/30 focus:border-royal transition-colors duration-150"
          aria-label="Select role"
        >
          {rolesForCampus.map(p => (
            <option key={p.role_id} value={p.role_id}>
              {p.role_name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export type { PairOption };
