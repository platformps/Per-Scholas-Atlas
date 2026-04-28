'use client';

// Manual fetch button — admin CTA. This is the ONE place ORANGE is used in
// the dashboard, per the brand book ("Use color with restraint... orange or
// royal for emphasis"). Reserving brand orange for this single action
// preserves its signal value: the button means "spend RapidAPI quota now."
//
// Disabled while pending so a panicked admin double-clicking doesn't burn
// 2× quota (BRIEF §13). The route also enforces a 24h throttle per pair —
// this button is the user-side half of that contract.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ManualFetchButtonProps {
  campusId?: string;
  roleId?: string;
  disabled?: boolean;
  /** Hint message for why the button is disabled (quota, throttle, etc.). */
  disabledHint?: string;
}

interface RouteResponse {
  trigger_type?: string;
  pairs?: number;
  results?: Array<{
    campus_id: string;
    role_id: string;
    status: string;
    jobs_returned?: number;
    scores_computed?: number;
    error?: string;
  }>;
  error?: string;
  quota?: { jobs_remaining: number | null; requests_remaining: number | null };
}

type Phase = 'idle' | 'pending' | 'success' | 'error';

export function ManualFetchButton({
  campusId,
  roleId,
  disabled = false,
  disabledHint,
}: ManualFetchButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string>('');
  const router = useRouter();

  async function trigger() {
    setPhase('pending');
    setMessage('');
    try {
      const resp = await fetch('/api/fetch-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger_type: 'manual',
          campus_id: campusId,
          role_id: roleId,
        }),
      });
      const json: RouteResponse = await resp.json().catch(() => ({} as RouteResponse));
      if (!resp.ok) {
        setPhase('error');
        setMessage(json.error ?? `HTTP ${resp.status}`);
        return;
      }
      const ok = json.results?.filter(r => r.status === 'success') ?? [];
      const fail = json.results?.filter(r => r.status !== 'success') ?? [];
      const totalJobs = ok.reduce((acc, r) => acc + (r.jobs_returned ?? 0), 0);
      setPhase(fail.length === 0 ? 'success' : 'error');
      setMessage(
        fail.length === 0
          ? `Fetched ${totalJobs} jobs across ${ok.length} pair${ok.length === 1 ? '' : 's'}.`
          : `${ok.length} ok, ${fail.length} failed: ${fail.map(f => `${f.campus_id}/${f.role_id} (${f.status})`).join(', ')}`,
      );
      router.refresh();
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const isDisabled = disabled || phase === 'pending';

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={trigger}
        disabled={isDisabled}
        aria-busy={phase === 'pending'}
        className={[
          'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-sm transition-colors',
          isDisabled
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-orange text-white hover:bg-orange/90 active:bg-orange/80 shadow-sm',
        ].join(' ')}
      >
        {phase === 'pending' ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Fetching…
          </>
        ) : (
          'Manual Fetch'
        )}
      </button>
      {disabled && disabledHint && (
        <span className="text-xs text-gray-500">{disabledHint}</span>
      )}
      {message && (
        <span
          className={`text-xs ${
            phase === 'success' ? 'text-royal' : phase === 'error' ? 'text-orange' : 'text-gray-500'
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
