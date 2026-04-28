'use client';

// Employer watchlist editor.
//
// Hierarchy: Watchlist → role (e.g. CFT) → industries (e.g. hyperscale_cloud,
// telecom, healthcare_atlanta) → employer entries.
//
// Note on terminology: the JSON schema field is named `categories`
// (employer_watchlist.categories) for backward compatibility with v1 — the
// scoring engine, API route, and validator all reference that name. The UI
// surfaces them as "industries" because that's what they actually represent
// (industry groupings of CFT-relevant employers). When you read code: the
// internal variable name is "category"; when you read the UI: it says
// "industry". Same thing.
//
// Save replaces the entire watchlist block in the active taxonomy and bumps
// to a new patch version. All employer names are normalized to lowercase
// trimmed strings on save. Empty industries are dropped at save time
// (so deleting an industry = empty its employers + save).

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

  // Outer collapse — matches the role-grouped pattern used by Manual Fetch
  // and Pair Manager. Default closed so the admin page lands compact.
  const [open, setOpen] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(categories);
  const totalEmployers = Object.values(draft).reduce((acc, c) => acc + c.employers.length, 0);
  const industryCount = Object.keys(draft).length;

  // ─── industry-level mutations ───────────────────────────────────────
  function addEmployer(industry: string, employer: string) {
    const trimmed = employer.trim().toLowerCase();
    if (!trimmed) return;
    setDraft(prev => {
      const next = { ...prev };
      const cat = next[industry];
      if (!cat) return prev;
      if (cat.employers.includes(trimmed)) return prev;
      next[industry] = { ...cat, employers: [...cat.employers, trimmed] };
      return next;
    });
  }

  function removeEmployer(industry: string, employer: string) {
    setDraft(prev => {
      const next = { ...prev };
      const cat = next[industry];
      if (!cat) return prev;
      next[industry] = { ...cat, employers: cat.employers.filter(e => e !== employer) };
      return next;
    });
  }

  function toggleHealthcare(industry: string) {
    setDraft(prev => {
      const next = { ...prev };
      const cat = next[industry];
      if (!cat) return prev;
      next[industry] = { ...cat, is_healthcare: !cat.is_healthcare };
      return next;
    });
  }

  function addIndustry(name: string, isHealthcare: boolean): string | null {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!trimmed) return 'industry name is required';
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      return 'industry name must be alphanumeric/underscore (spaces auto-converted)';
    }
    if (draft[trimmed]) return `"${trimmed}" already exists`;
    setDraft(prev => ({ ...prev, [trimmed]: { is_healthcare: isHealthcare, employers: [] } }));
    return null;
  }

  function removeIndustry(industry: string) {
    setDraft(prev => {
      const next = { ...prev };
      delete next[industry];
      return next;
    });
  }

  // ─── reset / save ───────────────────────────────────────────────────
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

  // ─── render ─────────────────────────────────────────────────────────
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
            {totalEmployers} employers · {industryCount} industr{industryCount === 1 ? 'y' : 'ies'}
          </span>
        </button>
        <span className="text-xs text-gray-400 shrink-0">
          v{taxonomyVersion} · +{weightPerMatch} pts/match
        </span>
      </header>

      {open && (
        <div className="p-5">
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Industry-grouped list of CFT-relevant employers. A score gets +{weightPerMatch} when
            the job's organization substring-matches any entry below. Industries flagged as{' '}
            <span className="font-mono text-night">healthcare</span> also satisfy the §A4 Tier D
            healthcare gate. Removing all employers from an industry will delete that industry
            on save.
          </p>

          <div className="space-y-3">
            {Object.entries(draft).map(([industryName, cat]) => (
              <IndustryBlock
                key={industryName}
                name={industryName}
                category={cat}
                onAddEmployer={emp => addEmployer(industryName, emp)}
                onRemoveEmployer={emp => removeEmployer(industryName, emp)}
                onToggleHealthcare={() => toggleHealthcare(industryName)}
                onRemoveIndustry={() => removeIndustry(industryName)}
                disabled={pending}
              />
            ))}
          </div>

          <AddIndustryForm onAdd={addIndustry} disabled={pending} />

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
// Per-industry collapsible. Same caret pattern as the role-level outer
// collapse. Default closed — user clicks into the industry they want to edit.
function IndustryBlock({
  name,
  category,
  onAddEmployer,
  onRemoveEmployer,
  onToggleHealthcare,
  onRemoveIndustry,
  disabled,
}: {
  name: string;
  category: Category;
  onAddEmployer: (emp: string) => void;
  onRemoveEmployer: (emp: string) => void;
  onToggleHealthcare: () => void;
  onRemoveIndustry: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');

  function commit() {
    if (!input.trim()) return;
    onAddEmployer(input);
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
        <div className="px-3 pb-3 pt-0 space-y-2.5">
          {/* Healthcare toggle + remove-industry control */}
          <div className="flex items-center justify-between text-xs gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={category.is_healthcare}
                onChange={onToggleHealthcare}
                disabled={disabled}
                className="rounded-sm"
              />
              <span className="text-gray-700">Counts as healthcare context (§A4 Tier D gate)</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (
                  category.employers.length === 0 ||
                  window.confirm(`Remove industry "${name}" and its ${category.employers.length} employer(s)? Save to commit.`)
                ) {
                  onRemoveIndustry();
                }
              }}
              disabled={disabled}
              className="text-[11px] text-gray-500 hover:text-orange underline disabled:opacity-40"
            >
              Remove industry
            </button>
          </div>

          {/* Employer pills */}
          <ul className="flex flex-wrap gap-1.5">
            {category.employers.map(emp => (
              <li key={emp}>
                <span className="inline-flex items-center gap-1 bg-white border border-gray-300 rounded-sm pl-2 pr-1 py-0.5 text-xs">
                  <span className="text-gray-800">{emp}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveEmployer(emp)}
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
              <li className="text-xs text-gray-400 italic">no employers — add below or remove industry</li>
            )}
          </ul>

          {/* Add employer */}
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

// ─────────────────────────────────────────────────────────────────────────────
// Add-new-industry inline form. Lives at the bottom of the industry list.
// Name is normalized to lowercase + underscores; alphanumeric/underscore only.
// Healthcare flag set at creation time (toggle later via the industry block).
function AddIndustryForm({
  onAdd,
  disabled,
}: {
  onAdd: (name: string, isHealthcare: boolean) => string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [isHealthcare, setIsHealthcare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function commit() {
    setError(null);
    const err = onAdd(name, isHealthcare);
    if (err) {
      setError(err);
      return;
    }
    setName('');
    setIsHealthcare(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-royal hover:text-navy disabled:opacity-50"
      >
        + Add industry
      </button>
    );
  }

  return (
    <div className="mt-3 border border-royal/30 rounded-sm bg-royal/5 p-3">
      <div className="text-xs font-semibold text-night mb-2.5">New industry</div>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]">
          <span className="text-gray-600">Name (lowercase, underscores)</span>
          <input
            type="text"
            value={name}
            placeholder="e.g. ai_infrastructure"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
            disabled={disabled}
            className="border border-gray-300 rounded-sm px-2 py-1 bg-white focus:outline-none focus:border-royal"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700 self-end pb-1.5">
          <input
            type="checkbox"
            checked={isHealthcare}
            onChange={e => setIsHealthcare(e.target.checked)}
            disabled={disabled}
            className="rounded-sm"
          />
          Healthcare
        </label>
        <button
          type="button"
          onClick={commit}
          disabled={disabled || !name.trim()}
          className="px-3 py-1.5 text-xs font-semibold bg-royal text-white rounded-sm hover:bg-navy disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName('');
            setIsHealthcare(false);
            setError(null);
          }}
          disabled={disabled}
          className="text-xs text-gray-500 hover:text-gray-800 underline"
        >
          Cancel
        </button>
      </div>
      {error && <div className="text-xs text-orange mt-2">{error}</div>}
    </div>
  );
}
