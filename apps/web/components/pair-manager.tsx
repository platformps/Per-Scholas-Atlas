'use client';

// Admin: pair management — list of all (campus, role) rows with
// activate/deactivate toggles, plus an "add new pair" form for combinations
// that don't exist yet. Soft-delete only (no DELETE button) — pairs that
// have ever scheduled fetches stay in the table for history.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface CampusRow {
  campus_id: string;
  campus_name: string;
  role_id: string;
  role_name: string;
  active: boolean;
  notes: string | null;
}

interface CampusOption { id: string; name: string; }
interface RoleOption   { id: string; name: string; }

interface PairManagerProps {
  pairs: CampusRow[];
  /** All campuses + roles in the DB — used to populate the "add new pair" dropdowns. */
  allCampuses: CampusOption[];
  allRoles: RoleOption[];
}

export function PairManager({ pairs, allCampuses, allRoles }: PairManagerProps) {
  return (
    <div className="space-y-6">
      <PairList pairs={pairs} />
      <AddPairForm pairs={pairs} allCampuses={allCampuses} allRoles={allRoles} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function PairList({ pairs }: { pairs: CampusRow[] }) {
  if (pairs.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4">
        No (campus, role) pairs yet. Add one below.
      </div>
    );
  }
  return (
    <div className="border border-gray-200 rounded-md bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-[minmax(200px,2fr)_minmax(180px,1.5fr)_100px_minmax(120px,1fr)] gap-3 px-5 py-2.5 border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        <div>Campus</div>
        <div>Role</div>
        <div>State</div>
        <div className="text-right">Action</div>
      </div>
      <ul className="divide-y divide-gray-100">
        {pairs.map(p => (
          <PairRow key={`${p.campus_id}-${p.role_id}`} row={p} />
        ))}
      </ul>
    </div>
  );
}

function PairRow({ row }: { row: CampusRow }) {
  const [active, setActive] = useState(row.active);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function toggle() {
    const next = !active;
    setActive(next); // optimistic
    setError(null);
    startTransition(async () => {
      const resp = await fetch('/api/campus-roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campus_id: row.campus_id,
          role_id: row.role_id,
          active: next,
        }),
      });
      if (!resp.ok) {
        setActive(!next); // revert
        const j = await resp.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${resp.status}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="grid grid-cols-[minmax(200px,2fr)_minmax(180px,1.5fr)_100px_minmax(120px,1fr)] gap-3 px-5 py-3 text-sm items-center">
      <span className="text-night font-medium">{row.campus_name}</span>
      <span className="text-gray-700">{row.role_name}</span>
      <span>
        <ActiveBadge active={active} />
      </span>
      <span className="text-right">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={[
            'inline-flex items-center px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors',
            pending
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : active
                ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                : 'bg-royal text-white hover:bg-navy',
          ].join(' ')}
        >
          {pending ? '…' : active ? 'Deactivate' : 'Activate'}
        </button>
        {error && (
          <span className="block text-[11px] text-orange mt-1">{error}</span>
        )}
      </span>
    </li>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-block bg-royal/10 text-royal border border-royal/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded-sm">
      Active
    </span>
  ) : (
    <span className="inline-block bg-cloud text-gray-600 border border-gray-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded-sm">
      Inactive
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function AddPairForm({
  pairs,
  allCampuses,
  allRoles,
}: {
  pairs: CampusRow[];
  allCampuses: CampusOption[];
  allRoles: RoleOption[];
}) {
  const [campusId, setCampusId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [active, setActive] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  // Disallow combinations that already exist.
  const existingKeys = new Set(pairs.map(p => `${p.campus_id}|${p.role_id}`));
  const isExisting = campusId && roleId && existingKeys.has(`${campusId}|${roleId}`);

  function submit() {
    setError(null);
    setSuccess(null);
    if (!campusId || !roleId) {
      setError('pick a campus and a role');
      return;
    }
    if (isExisting) {
      setError('that pair already exists — use the toggle above to activate it');
      return;
    }
    startTransition(async () => {
      const resp = await fetch('/api/campus-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campus_id: campusId, role_id: roleId, active }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${resp.status}`);
        return;
      }
      setSuccess(`Added ${campusId} × ${roleId}${active ? ' (active)' : ''}`);
      setCampusId('');
      setRoleId('');
      router.refresh();
    });
  }

  return (
    <div className="border border-gray-200 rounded-md bg-white shadow-sm p-5">
      <h3 className="text-sm font-semibold text-night mb-1">Add a new pair</h3>
      <p className="text-xs text-gray-500 mb-4">
        Combine a seeded campus with a seeded role to schedule fetches for it. Existing pairs
        appear in the list above.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-gray-700">Campus</span>
          <select
            value={campusId}
            onChange={e => setCampusId(e.target.value)}
            className="border border-gray-300 rounded-sm px-2 py-1.5 bg-white text-night focus:outline-none focus:border-royal min-w-[180px]"
          >
            <option value="">— pick —</option>
            {allCampuses.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-gray-700">Role</span>
          <select
            value={roleId}
            onChange={e => setRoleId(e.target.value)}
            className="border border-gray-300 rounded-sm px-2 py-1.5 bg-white text-night focus:outline-none focus:border-royal min-w-[180px]"
          >
            <option value="">— pick —</option>
            {allRoles.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm self-end pb-1.5">
          <input
            type="checkbox"
            checked={active}
            onChange={e => setActive(e.target.checked)}
            className="rounded-sm"
          />
          <span className="text-gray-700">Activate immediately</span>
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !campusId || !roleId || !!isExisting}
          className={[
            'self-end px-4 py-2 text-sm font-semibold rounded-sm transition-colors',
            pending || !campusId || !roleId || !!isExisting
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-royal text-white hover:bg-navy',
          ].join(' ')}
        >
          {pending ? 'Adding…' : 'Add pair'}
        </button>
      </div>

      {isExisting && (
        <div className="text-xs text-gray-500 mt-3">
          {campusId} × {roleId} already exists in the list above. Toggle it instead.
        </div>
      )}
      {error && <div className="text-xs text-orange mt-3">{error}</div>}
      {success && <div className="text-xs text-royal mt-3">{success}</div>}
    </div>
  );
}

export type { CampusRow, CampusOption, RoleOption };
