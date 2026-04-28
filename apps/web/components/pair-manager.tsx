'use client';

// Admin: pair management — role-grouped collapsible structure mirroring the
// Manual Fetch section. Each role section lists its campuses with per-row
// activate/deactivate toggles, plus role-level bulk operations:
//   • "Activate inactive (N)" — flips all currently-inactive pairs to active
//     (skips campuses whose own `campus.active=false`, e.g. Tampa)
//   • "Deactivate active (N)" — flips all active pairs off
//
// "Add new pair" form below covers combinations not already in the list.
// Soft-delete only — pairs that have ever scheduled fetches stay in the
// table for history.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface CampusRow {
  campus_id: string;
  campus_name: string;
  campus_active: boolean;
  role_id: string;
  role_name: string;
  active: boolean;
  notes: string | null;
}

interface CampusOption { id: string; name: string; active: boolean; }
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
      <PairsByRole pairs={pairs} />
      <AddPairForm pairs={pairs} allCampuses={allCampuses} allRoles={allRoles} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function PairsByRole({ pairs }: { pairs: CampusRow[] }) {
  if (pairs.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-md p-6 text-sm text-gray-500">
        No pairs yet. Add one below.
      </div>
    );
  }
  // Group by role
  const byRole = new Map<string, { role_name: string; pairs: CampusRow[] }>();
  for (const p of pairs) {
    if (!byRole.has(p.role_id)) {
      byRole.set(p.role_id, { role_name: p.role_name, pairs: [] });
    }
    byRole.get(p.role_id)!.pairs.push(p);
  }
  // Sort: active first, then alpha by campus name within
  for (const g of byRole.values()) {
    g.pairs.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.campus_name.localeCompare(b.campus_name);
    });
  }
  const groups = Array.from(byRole.entries())
    .map(([role_id, v]) => ({ role_id, ...v }))
    .sort((a, b) => a.role_name.localeCompare(b.role_name));

  return (
    <div className="space-y-3">
      {groups.map(g => (
        <RoleSection key={g.role_id} roleId={g.role_id} roleName={g.role_name} pairs={g.pairs} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function RoleSection({
  roleId,
  roleName,
  pairs,
}: {
  roleId: string;
  roleName: string;
  pairs: CampusRow[];
}) {
  const [open, setOpen] = useState(false); // default: closed — admin page lands compact
  const activeCount = pairs.filter(p => p.active).length;
  const total = pairs.length;
  const inactiveCount = total - activeCount;

  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-3 text-left flex-1 min-w-0 hover:opacity-80 transition-opacity"
        >
          <span
            className="text-gray-400 text-sm transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
            aria-hidden
          >
            ▶
          </span>
          <h3 className="text-sm font-semibold text-night truncate">{roleName}</h3>
          <span className="text-xs text-gray-500 shrink-0">
            {activeCount} active · {inactiveCount} inactive
          </span>
        </button>
        <BulkRoleButtons pairs={pairs} />
      </header>

      {open && (
        <div>
          <div className="grid grid-cols-[minmax(200px,2fr)_100px_minmax(120px,1fr)] gap-3 px-5 py-2 border-b border-gray-100 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            <div>Campus</div>
            <div>State</div>
            <div className="text-right">Action</div>
          </div>
          <ul className="divide-y divide-gray-100">
            {pairs.map(p => (
              <PairRow key={`${p.campus_id}-${p.role_id}`} row={p} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Bulk operations at role level ───────────────────────────────────────────
function BulkRoleButtons({ pairs }: { pairs: CampusRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Activate-targets: inactive pairs whose campus is also active (skip Tampa-like).
  const activateTargets = pairs.filter(p => !p.active && p.campus_active);
  const deactivateTargets = pairs.filter(p => p.active);

  async function bulk(targets: CampusRow[], active: boolean) {
    setError(null);
    if (targets.length === 0) return;
    startTransition(async () => {
      const results = await Promise.all(
        targets.map(p =>
          fetch('/api/campus-roles', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campus_id: p.campus_id, role_id: p.role_id, active }),
          }).then(r => ({ ok: r.ok, p })),
        ),
      );
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        setError(`${failed.length}/${results.length} failed`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={() => bulk(activateTargets, true)}
        disabled={pending || activateTargets.length === 0}
        className={[
          'px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors',
          pending || activateTargets.length === 0
            ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
            : 'bg-royal text-white hover:bg-navy shadow-sm',
        ].join(' ')}
      >
        Activate inactive ({activateTargets.length})
      </button>
      <button
        type="button"
        onClick={() => bulk(deactivateTargets, false)}
        disabled={pending || deactivateTargets.length === 0}
        className={[
          'px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors',
          pending || deactivateTargets.length === 0
            ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
            : 'border border-gray-300 text-gray-700 hover:bg-gray-50',
        ].join(' ')}
      >
        Deactivate active ({deactivateTargets.length})
      </button>
      {error && <span className="text-xs text-orange ml-2">{error}</span>}
    </div>
  );
}

// ─── Single pair toggle row ──────────────────────────────────────────────────
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

  const campusInactive = !row.campus_active;
  const buttonDisabled = pending || campusInactive;

  return (
    <li className="grid grid-cols-[minmax(200px,2fr)_100px_minmax(120px,1fr)] gap-3 px-5 py-3 text-sm items-center hover:bg-gray-50 transition-colors">
      <span className={`font-medium truncate ${campusInactive ? 'text-gray-400 line-through' : 'text-night'}`}>
        {row.campus_name}
        {campusInactive && (
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 no-underline">
            (campus inactive)
          </span>
        )}
      </span>
      <span>
        <ActiveBadge active={active} />
      </span>
      <span className="text-right">
        <button
          type="button"
          onClick={toggle}
          disabled={buttonDisabled}
          title={campusInactive ? 'Campus itself is inactive — re-activate the campus before scheduling' : undefined}
          className={[
            'inline-flex items-center px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors',
            buttonDisabled
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

// ─── Add-pair form (unchanged from prior version) ────────────────────────────
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
      setError('that pair already exists — toggle it from the role section above');
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
        Combine a seeded campus with a seeded role. Existing combinations appear in the role
        sections above.
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
              <option key={c.id} value={c.id}>
                {c.name}{c.active ? '' : ' (inactive)'}
              </option>
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
          {campusId} × {roleId} already exists. Toggle it from the role section above.
        </div>
      )}
      {error && <div className="text-xs text-orange mt-3">{error}</div>}
      {success && <div className="text-xs text-royal mt-3">{success}</div>}
    </div>
  );
}

export type { CampusRow, CampusOption, RoleOption };
