// Three side-by-side panels rendered in the dashboard:
//   • TopSkillsPanel — most common matched skills across qualifying jobs
//   • TopEmployersPanel — most common employers across qualifying jobs
//   • ConfidenceDistributionPanel — visual confidence breakdown
//
// All three are pure rendering components. They receive pre-aggregated data
// from the server component (apps/web/app/(dashboard)/page.tsx) and have no
// data-fetching of their own.

interface PanelShellProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function PanelShell({ label, hint, children }: PanelShellProps) {
  return (
    <div className="border border-zinc-800 bg-zinc-950/40 p-4 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          {label}
        </div>
        {hint && (
          <div className="text-[10px] font-mono text-zinc-600">{hint}</div>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top skills
// ─────────────────────────────────────────────────────────────────────────────
interface TopSkillsPanelProps {
  skills: Array<[string, number]>;
}

export function TopSkillsPanel({ skills }: TopSkillsPanelProps) {
  // noUncheckedIndexedAccess: skills[0] is `[string, number] | undefined` even
  // after a length check, so narrow via destructure.
  const head = skills[0];
  if (!head) {
    return (
      <PanelShell label="Top Skills">
        <EmptyState text="No matched skills yet." />
      </PanelShell>
    );
  }
  const max = head[1] || 1; // guard against zero (would NaN the bar width)
  return (
    <PanelShell label="Top Skills" hint={`top ${skills.length}`}>
      <ul className="space-y-1.5">
        {skills.map(([skill, count]) => (
          <li key={skill} className="flex items-center gap-2 text-xs">
            <span
              className="block h-1 bg-emerald-500/30"
              style={{ width: `${Math.max(8, (count / max) * 100)}%` }}
              aria-hidden
            />
            <span className="text-zinc-300 truncate flex-1">{skill}</span>
            <span className="text-zinc-500 font-mono tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top employers
// ─────────────────────────────────────────────────────────────────────────────
interface TopEmployersPanelProps {
  employers: Array<[string, number]>;
}

export function TopEmployersPanel({ employers }: TopEmployersPanelProps) {
  if (employers.length === 0) {
    return (
      <PanelShell label="Top Employers">
        <EmptyState text="No qualifying jobs yet." />
      </PanelShell>
    );
  }
  return (
    <PanelShell label="Top Employers" hint={`top ${employers.length}`}>
      <ul className="space-y-1.5">
        {employers.map(([org, count]) => (
          <li key={org} className="flex items-center justify-between text-xs">
            <span className="text-zinc-300 truncate pr-2">{org}</span>
            <span className="text-zinc-500 font-mono tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence distribution
// ─────────────────────────────────────────────────────────────────────────────
interface ConfidenceDistributionPanelProps {
  counts: { HIGH: number; MEDIUM: number; LOW: number; REJECT: number };
  total: number;
  // `scores` is accepted but optional — kept for extensibility (e.g., median
  // score per bucket in a follow-up). Currently we only render counts.
  scores?: unknown[];
}

export function ConfidenceDistributionPanel({
  counts,
  total,
}: ConfidenceDistributionPanelProps) {
  const buckets: Array<{ key: keyof typeof counts; label: string; color: string }> = [
    { key: 'HIGH',   label: 'High',   color: 'bg-emerald-500/60' },
    { key: 'MEDIUM', label: 'Medium', color: 'bg-amber-500/60'   },
    { key: 'LOW',    label: 'Low',    color: 'bg-orange-500/60'  },
    { key: 'REJECT', label: 'Reject', color: 'bg-zinc-700/60'    },
  ];

  if (total === 0) {
    return (
      <PanelShell label="Confidence Distribution">
        <EmptyState text="No scores yet." />
      </PanelShell>
    );
  }

  return (
    <PanelShell label="Confidence Distribution" hint={`${total} scored`}>
      {/* Horizontal stacked bar */}
      <div className="flex h-1.5 overflow-hidden mb-3" role="img" aria-label="Confidence distribution">
        {buckets.map(b => {
          const pct = (counts[b.key] / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={b.key}
              className={b.color}
              style={{ width: `${pct}%` }}
              title={`${b.label}: ${counts[b.key]} (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <ul className="space-y-1 text-xs">
        {buckets.map(b => (
          <li key={b.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className={`block w-1.5 h-1.5 ${b.color}`} aria-hidden />
              <span className="text-zinc-400">{b.label}</span>
            </span>
            <span className="font-mono text-zinc-500 tabular-nums">
              {counts[b.key]}
              <span className="text-zinc-700">
                {' · '}
                {((counts[b.key] / total) * 100).toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-xs text-zinc-600 font-mono py-4 text-center">{text}</div>
  );
}
