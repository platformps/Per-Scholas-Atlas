'use client';

// Triggers POST /api/fetch-jobs with trigger_type=manual. Disabled while
// pending so a panicked admin double-clicking doesn't burn 2x quota
// (BRIEF §13). The route also enforces a 24h throttle per (campus, role) —
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
      // Refresh the server-rendered dashboard so new scores are visible.
      router.refresh();
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const isDisabled = disabled || phase === 'pending';

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={trigger}
        disabled={isDisabled}
        aria-busy={phase === 'pending'}
        className={[
          'inline-flex items-center gap-2 px-3 py-1.5 border text-[10px] font-mono uppercase tracking-widest transition-colors',
          isDisabled
            ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
            : 'border-emerald-700 text-emerald-300 hover:bg-emerald-950/30',
        ].join(' ')}
      >
        {phase === 'pending' ? 'Fetching…' : 'Manual Fetch'}
      </button>
      {disabled && disabledHint && (
        <span className="text-[10px] font-mono text-zinc-600">{disabledHint}</span>
      )}
      {message && (
        <span
          className={`text-[10px] font-mono ${
            phase === 'success' ? 'text-emerald-400' : phase === 'error' ? 'text-orange-400' : 'text-zinc-500'
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
