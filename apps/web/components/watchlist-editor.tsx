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

  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-night">Employer watchlist — {roleName}</h3>
        <span className="text-xs text-gray-400">
          active: v{taxonomyVersion} · +{weightPerMatch} pts per match
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Known CFT-relevant employers. A score gets +{weightPerMatch} when the job's organization
        substring-matches any entry below. Categories with <span className="font-mono text-night">is_healthcare: true</span>{' '}
        also satisfy the §A4 Tier D healthcare gate.
        Adding/renaming categories is JSON-edit-only for now.
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
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
  const [input, setInput] = useState('');
  function commit() {
    if (!input.trim()) return;
    onAdd(input);
    setInput('');
  }
  return (
    <div className="border border-gray-200 rounded-sm p-3 bg-gray-50/50">
      <div className="flex items-baseline justify-between mb-2.5">
        <div>
          <span className="text-sm font-semibold text-night font-mono">{name}</span>
          {category.is_healthcare && (
            <span className="ml-2 inline-block bg-yellow/20 text-night text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm">
              healthcare
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{category.employers.length}</span>
      </div>

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
  );
}
