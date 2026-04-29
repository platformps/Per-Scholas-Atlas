// Top of the aggregate landing — six metric tiles giving a Managing
// Director an instant read on the overall opportunity landscape.
//
// Tiles: Seen · Still Active · Qualifying · Campuses · Roles · Employers.
// Vocabulary mirrors pipeline-stats.tsx (campus drilldown) so the same
// three primary numbers appear with the same labels everywhere — a request
// from Imran on 2026-04-28 after the homepage was showing a single
// ambiguous "Records" tile while the campus drilldown showed all three.
//
// All tiles use the shared <Card> primitive. Layout: 2-col on mobile,
// 6-col on desktop. The metric values use tabular-nums so column widths
// stay stable as numbers change.

import { Card } from '../ui/card';

interface HomeOverviewProps {
  totalRecords: number;
  liveRecords: number;
  qualifyingRecords: number;
  campusCount: number;
  campusTotal: number;
  roleCount: number;
  roleTotal: number;
  employerCount: number;
  lastUpdatedISO: string | null;
  windowDays: number;
}

export function HomeOverview({
  totalRecords,
  liveRecords,
  qualifyingRecords,
  campusCount,
  campusTotal,
  roleCount,
  roleTotal,
  employerCount,
  lastUpdatedISO,
  windowDays,
}: HomeOverviewProps) {
  // Pass rate against Still Active matches pipeline-stats.tsx semantics —
  // "of jobs currently hireable, what share clears the bar?"
  const qualifyPct = liveRecords ? Math.round((qualifyingRecords / liveRecords) * 100) : 0;
  const livePct = totalRecords ? Math.round((liveRecords / totalRecords) * 100) : 0;
  return (
    <section aria-label="Overview metrics">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <Tile
          label={`Seen · ${windowDays}d`}
          value={totalRecords.toLocaleString()}
          sublabel="unique postings"
          tone="neutral"
        />
        <Tile
          label="Still active"
          value={liveRecords.toLocaleString()}
          sublabel={totalRecords ? `${livePct}% of seen` : '—'}
          tone="navy"
        />
        <Tile
          label="Qualifying"
          value={qualifyingRecords.toLocaleString()}
          sublabel={liveRecords ? `${qualifyPct}% pass rate` : '—'}
          tone="royal"
        />
        <Tile
          label="Campuses"
          value={`${campusCount}`}
          sublabel={`of ${campusTotal} active`}
          tone="ocean"
        />
        <Tile
          label="Roles"
          value={`${roleCount}`}
          sublabel={`of ${roleTotal} active`}
          tone="ocean"
        />
        <Tile
          label="Employers"
          value={employerCount.toLocaleString()}
          sublabel={lastUpdatedISO ? `Updated ${formatRelative(lastUpdatedISO)}` : 'No fetches yet'}
          tone="neutral"
        />
      </div>
    </section>
  );
}

interface TileProps {
  label: string;
  value: string;
  sublabel?: string;
  tone: 'neutral' | 'navy' | 'royal' | 'ocean';
}

const TONE: Record<TileProps['tone'], string> = {
  neutral: 'text-night',
  navy: 'text-navy',
  royal: 'text-royal',
  ocean: 'text-ocean',
};

function Tile({ label, value, sublabel, tone }: TileProps) {
  return (
    <Card>
      <div className="p-4 sm:p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2 truncate">
          {label}
        </div>
        <div className={`text-3xl sm:text-4xl font-semibold tracking-tight leading-none tabular-nums ${TONE[tone]}`}>
          {value}
        </div>
        {sublabel && (
          <div className="text-xs text-gray-500 mt-2 truncate" title={sublabel}>
            {sublabel}
          </div>
        )}
      </div>
    </Card>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  const ageMs = Date.now() - d.valueOf();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 1) return 'just now';
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
  const days = Math.round(ageHours / 24);
  return `${days}d ago`;
}
