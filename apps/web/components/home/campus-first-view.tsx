// Campus-first view — answers "what roles are strongest in my campus
// market, and what specific intelligence do I need to act on?"
//
// Shows:
//   • Context banner: this campus, address, last fetch, total jobs in window
//   • Comparison table: rows are roles, scoped to this campus
//   • Sidebar: top employers, common titles for the campus across all roles
//
// User can drill into a role row to land in the focused detail view, or
// clear the campus filter to go back to overview.

import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { ComparisonTable, type ComparisonRow } from './comparison-table';

interface CampusFirstViewProps {
  campusId: string;
  campusName: string;
  campusAddress: string | null;
  windowDays: number;
  totals: { records: number; qualifying: number; employers: number };
  lastFetchISO: string | null;
  topEmployers: Array<[string, number]>;
  topTitles: string[];
  rows: ComparisonRow[];
}

export function CampusFirstView({
  campusId,
  campusName,
  campusAddress,
  windowDays,
  totals,
  lastFetchISO,
  topEmployers,
  topTitles,
  rows,
}: CampusFirstViewProps) {
  return (
    <div className="space-y-5">
      <ContextBanner
        campusId={campusId}
        campusName={campusName}
        campusAddress={campusAddress}
        windowDays={windowDays}
        totals={totals}
        lastFetchISO={lastFetchISO}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <ComparisonTable
          title={`Roles in ${campusName}`}
          description="Click any role to see the focused detail view — employer pool, score breakdown, and the full job table."
          rowLabel="Role"
          rows={rows}
          emptyMessage={`No active roles for ${campusName} yet. Activate a role on the Admin → Pair manager page.`}
          ranked
        />
        <div className="space-y-4">
          <SidePanel title="Top employers · all roles" empty="No employers yet.">
            {topEmployers.length > 0 && (
              <ul className="space-y-2 text-sm">
                {topEmployers.slice(0, 8).map(([org, n]) => (
                  <li key={org} className="flex items-center justify-between gap-3">
                    <span className="text-gray-800 truncate">{org}</span>
                    <span className="text-gray-500 tabular-nums text-xs">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </SidePanel>
          <SidePanel title="Common titles · all roles" empty="No titles yet.">
            {topTitles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {topTitles.slice(0, 12).map(t => (
                  <Badge key={t} tone="gray" variant="soft" size="sm">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </SidePanel>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ContextBanner({
  campusId,
  campusName,
  campusAddress,
  windowDays,
  totals,
  lastFetchISO,
}: {
  campusId: string;
  campusName: string;
  campusAddress: string | null;
  windowDays: number;
  totals: { records: number; qualifying: number; employers: number };
  lastFetchISO: string | null;
}) {
  return (
    <Card>
      <div className="p-5 sm:p-6 flex flex-col lg:flex-row gap-5 lg:items-center">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Badge tone="ocean" variant="soft" size="sm">Path B · Campus first</Badge>
            <span className="text-[11px] text-gray-400 font-mono">{campusId}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-night tracking-tight leading-tight">
            {campusName}
          </h2>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            {campusAddress ? <>{campusAddress} · </> : null}
            Local labor-market view over the last {windowDays} days.{' '}
            {lastFetchISO ? <>Last fetch {formatRelative(lastFetchISO)}.</> : 'No fetches yet.'}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:w-[420px]">
          <Stat label="Records" value={totals.records} tone="navy" />
          <Stat label="Qualifying" value={totals.qualifying} tone="royal" />
          <Stat label="Employers" value={totals.employers} tone="ocean" />
        </div>
      </div>
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

function SidePanel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  // We render the children only if non-empty; otherwise show the empty message.
  // The check is shallow — caller is expected to omit children for empty state.
  const isEmpty =
    children == null ||
    (Array.isArray(children) && children.length === 0) ||
    children === false;
  return (
    <Card>
      <div className="p-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          {title}
        </h4>
        {isEmpty ? <div className="text-sm text-gray-400">{empty}</div> : children}
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
  return `${Math.round(ageHours / 24)}d ago`;
}
