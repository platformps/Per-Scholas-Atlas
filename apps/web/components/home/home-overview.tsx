// Top of the aggregate landing — five metric tiles giving a Managing
// Director an instant read on the overall opportunity landscape.
//
// Tiles: Total records · Campuses represented · Roles represented · Unique
// employers · Last updated. The "Last updated" tile uses the most recent
// successful fetch_run timestamp across all pairs so the user can see how
// fresh the picture is.
//
// All tiles use the shared <Card> primitive. Layout: 2-col on mobile,
// 5-col on desktop. The metric values use tabular-nums so column widths
// stay stable as numbers change.

import { Card } from '../ui/card';

interface HomeOverviewProps {
  totalRecords: number;
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
  qualifyingRecords,
  campusCount,
  campusTotal,
  roleCount,
  roleTotal,
  employerCount,
  lastUpdatedISO,
  windowDays,
}: HomeOverviewProps) {
  const qualifyPct = totalRecords ? Math.round((qualifyingRecords / totalRecords) * 100) : 0;
  return (
    <section aria-label="Overview metrics">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <Tile
          label={`Job records · ${windowDays}d`}
          value={totalRecords.toLocaleString()}
          sublabel="unique postings seen"
          tone="navy"
        />
        <Tile
          label="Qualifying"
          value={qualifyingRecords.toLocaleString()}
          sublabel={totalRecords ? `${qualifyPct}% pass rate` : '—'}
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
