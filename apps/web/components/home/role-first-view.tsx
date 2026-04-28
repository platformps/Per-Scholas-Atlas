// Role-first view — answers "for this role, which campuses have the
// strongest opportunity signal, and how does my campus compare?"
//
// Shows:
//   • Big context banner explaining the active role + window
//   • Comparison table: rows are campuses, scoped to this role
//   • Quick stats inline (total qualifying jobs, top employers, top titles)
//
// User flows from here either by clicking a row (→ focused detail), or by
// clearing the role filter from the top filter bar (→ back to overview),
// or by adding their campus from the bar to land in focused detail.

import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { ComparisonTable, type ComparisonRow } from './comparison-table';

interface RoleFirstViewProps {
  roleId: string;
  roleName: string;
  windowDays: number;
  totals: { records: number; qualifying: number; employers: number };
  topTitles: string[];
  rows: ComparisonRow[];
}

export function RoleFirstView({
  roleId,
  roleName,
  windowDays,
  totals,
  topTitles,
  rows,
}: RoleFirstViewProps) {
  return (
    <div className="space-y-5">
      <ContextBanner
        roleId={roleId}
        roleName={roleName}
        windowDays={windowDays}
        totals={totals}
        topTitles={topTitles}
      />
      <ComparisonTable
        title={`Campus performance · ${roleName}`}
        description="Click any campus to see local-market intelligence — employers, titles, and the full job table."
        rowLabel="Campus"
        rows={rows}
        emptyMessage={`No ${roleName} jobs scored in the last ${windowDays} days yet.`}
        ranked
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ContextBanner({
  roleId,
  roleName,
  windowDays,
  totals,
  topTitles,
}: {
  roleId: string;
  roleName: string;
  windowDays: number;
  totals: { records: number; qualifying: number; employers: number };
  topTitles: string[];
}) {
  return (
    <Card>
      <div className="p-5 sm:p-6 flex flex-col lg:flex-row gap-5 lg:items-center">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Badge tone="royal" variant="soft" size="sm">Path A · Role first</Badge>
            <span className="text-[11px] text-gray-400 font-mono">{roleId}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-night tracking-tight leading-tight">
            {roleName}
          </h2>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            Comparing campus performance for {roleName} over the last {windowDays} days. Pick a
            campus to drill into local-market intelligence, or clear the filter to return to the
            overview.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:w-[420px]">
          <Stat label="Records" value={totals.records} tone="navy" />
          <Stat label="Qualifying" value={totals.qualifying} tone="royal" />
          <Stat label="Employers" value={totals.employers} tone="ocean" />
        </div>
      </div>
      {topTitles.length > 0 && (
        <div className="border-t border-gray-100 px-5 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Top titles
          </span>
          <div className="flex flex-wrap gap-1.5">
            {topTitles.slice(0, 8).map(t => (
              <Badge key={t} tone="gray" variant="soft" size="sm">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'navy' | 'royal' | 'ocean';
}) {
  const color = tone === 'navy' ? 'text-navy' : tone === 'royal' ? 'text-royal' : 'text-ocean';
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className={`text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums ${color}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
