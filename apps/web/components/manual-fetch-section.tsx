'use client';

// Admin manual fetch — collapsible role groups, each with a roster of active
// campuses underneath. Each campus row shows last-fetch info (when + how
// triggered) and its own Manual Fetch button. The role header has a
// "Fetch all" button that triggers a single multi-pair API call covering
// every active campus for that role.
//
// Inactive (campus, role) pairs aren't shown here — activation is the Pair
// Manager section's job. Showing only active pairs keeps the operational
// scope obvious: these are the ones the cron is actually running.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from './ui/card';
import { Button } from './ui/button';

interface LastFetch {
  at: string;
  trigger_type: 'scheduled' | 'manual' | 'rescore';
}

interface CampusInfo {
  campus_id: string;
  campus_name: string;
  last_fetch: LastFetch | null;
}

export interface RoleGroup {
  role_id: string;
  role_name: string;
  campuses: CampusInfo[]; // already filtered to active pairs only
}

interface ManualFetchSectionProps {
  roles: RoleGroup[];
  quotaBlocked: boolean;
  quotaHint?: string;
}

export function ManualFetchSection({ roles, quotaBlocked, quotaHint }: ManualFetchSectionProps) {
  if (roles.length === 0) {
    return (
      <Card>
        <div className="p-6 text-sm text-gray-500">
          No active campus×role pairs. Activate one in the section below first.
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {roles.map(r => (
        <RoleCard key={r.role_id} role={r} quotaBlocked={quotaBlocked} quotaHint={quotaHint} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function RoleCard({
  role,
  quotaBlocked,
  quotaHint,
}: {
  role: RoleGroup;
  quotaBlocked: boolean;
  quotaHint?: string;
}) {
  const [open, setOpen] = useState(false); // default: closed — admin page lands compact

  return (
    <Card>
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-3 text-left flex-1 min-w-0 hover:bg-gray-100 -mx-2 px-2 py-1 rounded-sm transition-colors duration-150"
        >
          <span
            className="text-gray-400 text-sm transition-transform duration-150"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
            aria-hidden
          >
            ▶
          </span>
          <h3 className="text-sm font-semibold text-night truncate">{role.role_name}</h3>
          <span className="text-xs text-gray-500 shrink-0">
            {role.campuses.length} active {role.campuses.length === 1 ? 'campus' : 'campuses'}
          </span>
        </button>
        <RoleFetchAllButton
          roleId={role.role_id}
          campusCount={role.campuses.length}
          disabled={quotaBlocked || role.campuses.length === 0}
          disabledHint={quotaBlocked ? quotaHint : undefined}
        />
      </div>

      {open && (
        <ul className="divide-y divide-gray-100">
          {role.campuses.map(c => (
            <CampusRow
              key={c.campus_id}
              campus={c}
              roleId={role.role_id}
              quotaBlocked={quotaBlocked}
              quotaHint={quotaHint}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Single-campus row ──────────────────────────────────────────────────────
function CampusRow({
  campus,
  roleId,
  quotaBlocked,
  quotaHint,
}: {
  campus: CampusInfo;
  roleId: string;
  quotaBlocked: boolean;
  quotaHint?: string;
}) {
  return (
    <li className="grid grid-cols-[minmax(180px,1.5fr)_minmax(180px,1.5fr)_minmax(140px,1fr)] gap-4 items-center px-6 py-3 hover:bg-gray-50 transition-colors duration-150">
      <span className="text-sm font-medium text-night truncate">{campus.campus_name}</span>
      <LastFetchInfo lastFetch={campus.last_fetch} />
      <div className="flex justify-end">
        <SingleFetchButton
          roleId={roleId}
          campusId={campus.campus_id}
          disabled={quotaBlocked}
          disabledHint={quotaBlocked ? quotaHint : undefined}
        />
      </div>
    </li>
  );
}

function LastFetchInfo({ lastFetch }: { lastFetch: LastFetch | null }) {
  if (!lastFetch) {
    return <span className="text-xs text-gray-400 italic">Never fetched</span>;
  }
  const tone =
    lastFetch.trigger_type === 'manual' ? 'text-orange' :
    lastFetch.trigger_type === 'scheduled' ? 'text-royal' :
                                              'text-gray-500';
  return (
    <span className="text-xs text-gray-600 truncate">
      Last fetched <span className="text-gray-800">{formatDateTime(lastFetch.at)}</span>
      <span className="text-gray-400"> · </span>
      <span className={`uppercase tracking-wider font-semibold ${tone}`}>
        {lastFetch.trigger_type}
      </span>
    </span>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  const now = Date.now();
  const ageMs = now - d.valueOf();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 24) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
      ' (' + Math.round(ageHours) + 'h ago)';
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' (' + Math.round(ageHours / 24) + 'd ago)';
}

// ─── Buttons (per-row + per-role) ────────────────────────────────────────────
type Phase = 'idle' | 'pending' | 'success' | 'error';

interface RouteResponse {
  trigger_type?: string;
  pairs?: number;
  results?: Array<{
    campus_id: string;
    role_id: string;
    status: string;
    jobs_returned?: number;
    error?: string;
  }>;
  error?: string;
}

function SingleFetchButton({
  roleId,
  campusId,
  disabled,
  disabledHint,
}: {
  roleId: string;
  campusId: string;
  disabled: boolean;
  disabledHint?: string;
}) {
  return (
    <FetchButton
      label="Fetch"
      payload={{ trigger_type: 'manual', role_id: roleId, campus_id: campusId }}
      disabled={disabled}
      disabledHint={disabledHint}
      filled={false}
    />
  );
}

function RoleFetchAllButton({
  roleId,
  campusCount,
  disabled,
  disabledHint,
}: {
  roleId: string;
  campusCount: number;
  disabled: boolean;
  disabledHint?: string;
}) {
  return (
    <FetchButton
      label={`Fetch all (${campusCount})`}
      payload={{ trigger_type: 'manual', role_id: roleId }}
      disabled={disabled || campusCount === 0}
      disabledHint={disabledHint}
      filled
    />
  );
}

interface FetchButtonProps {
  label: string;
  payload: { trigger_type: 'manual'; role_id: string; campus_id?: string };
  disabled: boolean;
  disabledHint?: string;
  /** filled = orange CTA (action variant); !filled = orange outline */
  filled: boolean;
}

function FetchButton({ label, payload, disabled, disabledHint, filled }: FetchButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [_, startTransition] = useTransition();
  const router = useRouter();

  async function trigger(e: React.MouseEvent) {
    e.stopPropagation(); // don't toggle the parent <details> if any
    setPhase('pending');
    setMessage('');
    try {
      const resp = await fetch('/api/fetch-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
          ? `${totalJobs} jobs · ${ok.length} pair${ok.length === 1 ? '' : 's'}`
          : `${ok.length}/${ok.length + fail.length} ok: ${fail.slice(0, 2).map(f => `${f.campus_id} (${f.status})`).join(', ')}${fail.length > 2 ? '…' : ''}`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  // For the outline variant we use a custom button (action-secondary doesn't
  // exist as a Button variant — orange outline is an action-CTA-only pattern).
  const outlineClass =
    'inline-flex items-center justify-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded-sm border border-orange text-orange hover:bg-orange/5 active:bg-orange/10 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors duration-150';

  return (
    <div className="inline-flex flex-col items-end gap-1 min-w-0">
      {filled ? (
        <Button
          variant="action"
          size="sm"
          onClick={trigger}
          disabled={disabled}
          loading={phase === 'pending'}
        >
          {label}
        </Button>
      ) : (
        <button
          type="button"
          onClick={trigger}
          disabled={disabled || phase === 'pending'}
          aria-busy={phase === 'pending'}
          className={outlineClass}
        >
          {phase === 'pending' ? 'Fetching…' : label}
        </button>
      )}
      {disabled && disabledHint && (
        <span className="text-[11px] text-gray-500">{disabledHint}</span>
      )}
      {message && (
        <span
          className={`text-[11px] truncate max-w-[260px] ${
            phase === 'success' ? 'text-royal' : phase === 'error' ? 'text-orange' : 'text-gray-500'
          }`}
          title={message}
        >
          {message}
        </span>
      )}
    </div>
  );
}
