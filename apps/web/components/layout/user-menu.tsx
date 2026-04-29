'use client';

// User menu dropdown — replaces the static UserPill in the header.
//
// Click → opens a panel below the pill with:
//   • email (small label, truncates if long)
//   • Home campus row: shows currently pinned campus + select to change
//   • Sign out link (mirrors the existing icon button so it's discoverable
//     from inside the menu too)
//
// Campus list is lazy-fetched from /api/campuses on first open so the
// dropdown doesn't require threading the list through every page that
// renders <Header>. Cached per session — no refetch on subsequent opens.

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Campus {
  id: string;
  name: string;
  state: string | null;
}

interface Props {
  email: string;
  pinnedCampusId: string | null;
}

export function UserMenu({ email, pinnedCampusId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [campuses, setCampuses] = useState<Campus[] | null>(null);
  const [loadingCampuses, setLoadingCampuses] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const initial = email.trim().charAt(0).toUpperCase() || '?';

  // Lazy-load campuses on first open.
  useEffect(() => {
    if (!open || campuses !== null || loadingCampuses) return;
    setLoadingCampuses(true);
    fetch('/api/campuses')
      .then(r => r.json())
      .then((d: { campuses?: Campus[] }) => setCampuses(d.campuses ?? []))
      .catch(() => setCampuses([]))
      .finally(() => setLoadingCampuses(false));
  }, [open, campuses, loadingCampuses]);

  // Click-outside / Escape to close.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (
        panelRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pinnedCampus = campuses?.find(c => c.id === pinnedCampusId) ?? null;
  const pinnedLabel =
    pinnedCampusId === null
      ? 'No campus pinned'
      : pinnedCampus
        ? pinnedCampus.name
        : pinnedCampusId; // fallback to id while campuses still loading

  function setHome(value: string | null) {
    setError(null);
    startTransition(async () => {
      const r = await fetch('/api/me/home-campus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campus_id: value }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Failed (${r.status})`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        className="inline-flex items-center gap-2 rounded-sm py-1 pl-1 md:pr-3 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-royal/30 transition-colors duration-150"
      >
        <span
          aria-hidden
          className="inline-flex items-center justify-center h-7 w-7 rounded-sm bg-royal/10 text-royal text-xs font-semibold"
        >
          {initial}
        </span>
        <span className="hidden md:inline text-sm text-gray-700 truncate max-w-[180px]">
          {email}
        </span>
        <span aria-hidden className="hidden md:inline text-gray-400 text-[10px]">
          ▼
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          className="absolute right-0 mt-1.5 w-[280px] rounded-sm border border-gray-200 bg-white shadow-lg z-30"
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">
              Signed in
            </div>
            <div className="text-sm text-night truncate" title={email}>
              {email}
            </div>
          </div>

          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Home campus
            </div>
            <div className="text-xs text-gray-600 mb-2">
              {pinnedCampusId ? (
                <>
                  Currently <span className="text-night font-medium">{pinnedLabel}</span>.
                  Atlas auto-anchors here on every visit.
                </>
              ) : (
                <>None set. Atlas opens to the all-campus overview by default.</>
              )}
            </div>

            <select
              aria-label="Set home campus"
              disabled={loadingCampuses || pending || campuses === null}
              value={pinnedCampusId ?? ''}
              onChange={e => setHome(e.target.value || null)}
              className="w-full text-sm border border-gray-300 rounded-sm px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-royal/30"
            >
              <option value="">— No home campus —</option>
              {(campuses ?? []).map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.state ? ` · ${c.state}` : ''}
                </option>
              ))}
            </select>

            {loadingCampuses && (
              <div className="text-[11px] text-gray-400 mt-1.5">Loading campuses…</div>
            )}
            {pending && (
              <div className="text-[11px] text-gray-500 mt-1.5">Saving…</div>
            )}
            {error && (
              <div className="text-[11px] text-orange mt-1.5">{error}</div>
            )}
          </div>

          <a
            href="/auth/signout"
            className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 hover:text-night transition-colors duration-150"
          >
            Sign out
          </a>
        </div>
      )}
    </div>
  );
}
