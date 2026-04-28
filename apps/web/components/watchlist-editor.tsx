'use client';

// Employer watchlist editor. Per category, the admin can add or remove
// employer names. Save replaces the entire watchlist block in the active
// taxonomy and bumps to a new patch version. Add-category and toggling
// `is_healthcare` are deferred to a future session — for now those are
// initial-seed-only and edited via the JSON file.
//
// All employer names are normalized to lowercase trimmed strings on save.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Category {
  is_healthcare: boolean;
  employers: string[];
}

interface WatchlistEditorProps {
  roleId: string;
  roleName: string;
  taxonomyVersion: string;
  weightPerMatch: number;
  categories: Record<string, Category>;
}

export function WatchlistEditor({
  roleId,
  roleName,
  taxonomyVersion,
  weightPerMatch,
  categories,
}: WatchlistEditorProps) {
  // Deep-copy the incoming categories so local state can mutate freely.
  const [draft, setDraft] = useState<Record<string, Category>>(() =>
    Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [
        k,
        { is_healthcare: v.is_healthcare, employers: [...v.employers] },
      ]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  // Detect whether the local draft differs from the prop snapshot
  const dirty = JSON.stringify(draft) !== JSON.stringify(categories);
  const totalEmployers = Object.values(draft).reduce((acc, c) => acc + c.employers.length, 0);

  function addEmployer(category: string, employer: string) {
    const trimmed = employer.trim().toLowerCase();
    if (!trimmed) return;
    setDraft(prev => {
      const next = { ...prev };
      const cat = next[category];
      if (!cat) return prev;
      if (cat.employers.includes(trimmed)) return prev;
      next[category] = { ...cat, employers: [...cat.employers, trimmed] };
      return next;
    });
  }

  function removeEmployer(category: string, employer: string) {
    setDraft(prev => {
      const next = { ...prev };
      const cat = next[category];
      if (!cat) return prev;
      next[category] = { ...cat, employers: cat.employers.filter(e => e !== employer) };
      return next;
    });
  }

  function reset() {
    setDraft(
      Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [
          k,
          { is_healthcare: v.is_healthcare, employers: [...v.employers] },
        ]),
      ),
    );
    setError(null);
    setSuccess(null);
  }

  function save() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const resp = await fetch(`/api/taxonomy/${roleId}/watchlist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_per_match: weightPerMatch, categories: draft }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(j.error ?? `HTTP ${resp.status}`);
        return;
      }
      setSuccess(`Saved as ${roleId} v${j.newVersion}`);
      router.refresh();
    });
  }

  // Outer collapse — matches the role-grouped pattern used by Manual Fetch
  // and Pair Manager. Default open so the editor is immediately usable; the
  // admin can collapse roles they aren't editing.
  const [open, setOpen] = useState(true);
  const categoryCount = Object.keys(draft).length;

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
          <h3 className="text-sm font-semibold text-night truncate">
            Employer watchlist — {roleName}
          </h3>
          <span className="text-xs text-gray-500 shrink-0">
            {totalEmployers} employers · {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}
          </span>
        </button>
        <span className="text-xs text-gray-400 shrink-0">
          v{taxonomyVersion} · +{weightPerMatch} pts/match
        </span>
      </header>

      {open && (
        <div className="p-5">
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Known CFT-relevant employers. A score gets +{weightPerMatch} when the job's
            organization substring-matches any entry below. Categories flagged as{' '}
            <span className="font-mono text-night">is_healthcare</span> also satisfy the §A4
            Tier D healthcare gate. Adding/renaming categories is JSON-edit-only for now.
          </p>

          <div className="space-y-4">
            {Object.entries(draft).map(([catName, cat]) => (
              <CategoryBlock
                key={catName}
                name={catName}
                category={cat}
                onAdd={emp => addEmployer(catName, emp)}
                onRemove={emp => removeEmployer(catName, emp)}
                disabled={pending}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className={[
                'px-4 py-2 text-sm font-semibold rounded-sm transition-colors',
                pending || !dirty
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-royal text-white hover:bg-navy',
              ].join(' ')}
            >
              {pending ? 'Saving…' : 'Save watchlist'}
            </button>
            {dirty && !pending && (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-gray-500 hover:text-gray-800 underline"
              >
                Reset
              </button>
            )}
            <span className="ml-auto text-xs text-gray-400">{totalEmployers} employers total</span>
            {error && <span className="text-xs text-orange">{error}</span>}
            {success && <span className="text-xs text-royal">{success}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-category collapsible. Same caret pattern as the role-level outer
// collapse — admin can drill in/out of individual categories independently.
// Default closed so the watchlist editor opens compact; user clicks the
// category they want to edit. (Inverted from the role-level default-open
// because each role only has one watchlist editor visible, but a watchlist
// has 5 categories — keeping all categories open by default would defeat
// the purpose of the outer collapse.)
function CategoryBlock({
  name,
  category,
  onAdd,
  onRemove,
  disabled,
}: {
  name: string;
  category: Category;
  onAdd: (emp: string) => void;
  onRemove: (emp: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  function commit() {
    if (!input.trim()) return;
    onAdd(input);
    setInput('');
  }
  return (
    <div className="border border-gray-200 rounded-sm bg-gray-50/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className="text-gray-400 text-xs transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
            aria-hidden
          >
            ▶
          </span>
          <span className="text-sm font-semibold text-night font-mono truncate">{name}</span>
          {category.is_healthcare && (
            <span className="inline-block bg-yellow/20 text-night text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm shrink-0">
              healthcare
            </span>
          )}
        </span>
        <span className="text-xs text-gray-500 shrink-0">
          {category.employers.length} {category.employers.length === 1 ? 'employer' : 'employers'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-0">
          <ul className="flex flex-wrap gap-1.5 mb-2">
            {category.employers.map(emp => (
              <li key={emp}>
                <span className="inline-flex items-center gap-1 bg-white border border-gray-300 rounded-sm pl-2 pr-1 py-0.5 text-xs">
                  <span className="text-gray-800">{emp}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(emp)}
                    disabled={disabled}
                    aria-label={`Remove ${emp}`}
                    className="text-gray-400 hover:text-orange disabled:opacity-30 px-1"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
            {category.employers.length === 0 && (
              <li className="text-xs text-gray-400 italic">no employers in this category</li>
            )}
          </ul>

          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              placeholder="Add employer (lowercased on save)…"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                }
              }}
              disabled={disabled}
              className="flex-1 border border-gray-300 rounded-sm px-2 py-1 text-xs bg-white focus:outline-none focus:border-royal"
            />
            <button
              type="button"
              onClick={commit}
              disabled={disabled || !input.trim()}
              className="px-3 py-1 text-xs font-semibold border border-gray-300 text-gray-700 rounded-sm hover:bg-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
