'use client';

// Score threshold editor. Three numeric inputs for HIGH / MEDIUM / LOW
// cutoffs of the active taxonomy. Save creates a new patch-version row in
// `taxonomies`. Constraint: 0 ≤ low < medium < high ≤ 100.
//
// Don't ship without giving the admin a chance to undo: the change cascades
// to every future score (and a follow-up rescore would re-classify everything
// already in the DB). Keep the UX deliberate — explicit Save button, never
// auto-submit on change.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface ThresholdEditorProps {
  roleId: string;
  roleName: string;
  taxonomyVersion: string;
  current: { high: number; medium: number; low: number };
}

export function ThresholdEditor({
  roleId,
  roleName,
  taxonomyVersion,
  current,
}: ThresholdEditorProps) {
  const [high, setHigh] = useState(current.high);
  const [medium, setMedium] = useState(current.medium);
  const [low, setLow] = useState(current.low);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  const dirty = high !== current.high || medium !== current.medium || low !== current.low;
  const valid = low >= 0 && low < medium && medium < high && high <= 100;

  function reset() {
    setHigh(current.high);
    setMedium(current.medium);
    setLow(current.low);
    setError(null);
    setSuccess(null);
  }

  function save() {
    setError(null);
    setSuccess(null);
    if (!valid) {
      setError('must satisfy 0 ≤ LOW < MEDIUM < HIGH ≤ 100');
      return;
    }
    startTransition(async () => {
      const resp = await fetch(`/api/taxonomy/${roleId}/thresholds`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ high, medium, low }),
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
        <h3 className="text-sm font-semibold text-night">Score thresholds — {roleName}</h3>
        <span className="text-xs text-gray-400">active: v{taxonomyVersion}</span>
      </div>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        Cutoffs that determine HIGH / MEDIUM / LOW / REJECT. A score of <em>n</em> is HIGH if{' '}
        <em>n ≥ HIGH</em>, MEDIUM if <em>n ≥ MEDIUM</em>, LOW if <em>n ≥ LOW</em>, otherwise REJECT.
        Saving creates a new patch version of the active taxonomy.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ThresholdField
          label="HIGH"
          value={high}
          onChange={setHigh}
          color="text-royal"
          hint={`scored ≥ ${high} → HIGH`}
        />
        <ThresholdField
          label="MEDIUM"
          value={medium}
          onChange={setMedium}
          color="text-ocean"
          hint={`${medium} – ${high - 1} → MEDIUM`}
        />
        <ThresholdField
          label="LOW"
          value={low}
          onChange={setLow}
          color="text-yellow"
          hint={`${low} – ${medium - 1} → LOW; below ${low} → REJECT`}
        />
      </div>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty || !valid}
          className={[
            'px-4 py-2 text-sm font-semibold rounded-sm transition-colors',
            pending || !dirty || !valid
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-royal text-white hover:bg-navy',
          ].join(' ')}
        >
          {pending ? 'Saving…' : 'Save thresholds'}
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
        {error && <span className="text-xs text-orange">{error}</span>}
        {success && <span className="text-xs text-royal">{success}</span>}
      </div>
    </div>
  );
}

function ThresholdField({
  label,
  value,
  onChange,
  color,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  color: string;
  hint: string;
}) {
  return (
    <label className="block">
      <span className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 ${color}`}>
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full border border-gray-300 rounded-sm px-3 py-2 text-lg font-semibold text-night bg-white focus:outline-none focus:border-royal"
      />
      <span className="block text-[11px] text-gray-500 mt-1.5">{hint}</span>
    </label>
  );
}
