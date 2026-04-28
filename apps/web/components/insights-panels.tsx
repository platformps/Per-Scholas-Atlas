// Three insight panels for the dashboard — Top Skills, Top Employers,
// Confidence Distribution. All three use the shared <Card> primitive
// and the shared <EmptyState> for empty cases.

import { Card } from './ui/card';
import { EmptyState } from './ui/empty-state';

interface PanelShellProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function PanelShell({ label, hint, children }: PanelShellProps) {
  return (
    <Card>
      <div className="p-6 flex flex-col h-full">
        <div className="flex items-baseline justify-between mb-4">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {label}
          </div>
          {hint && <div className="text-xs text-gray-400">{hint}</div>}
        </div>
        <div className="flex-1">{children}</div>
      </div>
    </Card>
  );
}

// ─── Top skills ──────────────────────────────────────────────────────────────
interface TopSkillsPanelProps {
  skills: Array<[string, number]>;
}

export function TopSkillsPanel({ skills }: TopSkillsPanelProps) {
  const head = skills[0];
  if (!head) {
    return (
      <PanelShell label="Top Skills">
        <EmptyState message="No matched skills yet." />
      </PanelShell>
    );
  }
  const max = head[1] || 1;
  return (
    <PanelShell label="Top Skills" hint={`top ${skills.length}`}>
      <ul className="space-y-2.5">
        {skills.map(([skill, count]) => (
          <li key={skill} className="flex items-center gap-3 text-sm">
            <span className="text-gray-800 truncate flex-1 min-w-0">{skill}</span>
            <span
              className="block h-1.5 bg-royal rounded-sm shrink-0"
              style={{ width: `${Math.max(8, (count / max) * 80)}px` }}
              aria-hidden
            />
            <span className="text-gray-500 tabular-nums w-6 text-right text-xs">{count}</span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

// ─── Top employers ──────────────────────────────────────────────────────────
interface TopEmployersPanelProps {
  employers: Array<[string, number]>;
}

export function TopEmployersPanel({ employers }: TopEmployersPanelProps) {
  if (employers.length === 0) {
    return (
      <PanelShell label="Top Employers">
        <EmptyState message="No qualifying jobs yet." />
      </PanelShell>
    );
  }
  return (
    <PanelShell label="Top Employers" hint={`top ${employers.length}`}>
      <ul className="space-y-2 text-sm">
        {employers.map(([org, count]) => (
          <li key={org} className="flex items-center justify-between">
            <span className="text-gray-800 truncate pr-2">{org}</span>
            <span className="text-gray-500 tabular-nums text-xs">{count}</span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

// ─── Confidence distribution ────────────────────────────────────────────────
interface ConfidenceDistributionPanelProps {
  counts: { HIGH: number; MEDIUM: number; LOW: number; REJECT: number };
  total: number;
  scores?: unknown[];
}

export function ConfidenceDistributionPanel({
  counts,
  total,
}: ConfidenceDistributionPanelProps) {
  const buckets: Array<{
    key: keyof typeof counts;
    label: string;
    bar: string;
    dot: string;
  }> = [
    { key: 'HIGH',   label: 'High',   bar: 'bg-royal',  dot: 'bg-royal'  },
    { key: 'MEDIUM', label: 'Medium', bar: 'bg-ocean',  dot: 'bg-ocean'  },
    { key: 'LOW',    label: 'Low',    bar: 'bg-yellow', dot: 'bg-yellow' },
    { key: 'REJECT', label: 'Reject', bar: 'bg-gray-300', dot: 'bg-gray-300' },
  ];

  if (total === 0) {
    return (
      <PanelShell label="Confidence Distribution">
        <EmptyState message="No scores yet." />
      </PanelShell>
    );
  }

  return (
    <PanelShell label="Confidence Distribution" hint={`${total} scored`}>
      <div
        className="flex h-2 rounded-sm overflow-hidden mb-4 bg-gray-100"
        role="img"
        aria-label="Confidence distribution"
      >
        {buckets.map(b => {
          const pct = (counts[b.key] / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={b.key}
              className={b.bar}
              style={{ width: `${pct}%` }}
              title={`${b.label}: ${counts[b.key]} (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <ul className="space-y-2 text-sm">
        {buckets.map(b => (
          <li key={b.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <span className={`block w-2 h-2 rounded-sm ${b.dot}`} aria-hidden />
              <span className="text-gray-700">{b.label}</span>
            </span>
            <span className="tabular-nums text-xs text-gray-500">
              {counts[b.key]}
              <span className="text-gray-400 ml-1">
                · {((counts[b.key] / total) * 100).toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
