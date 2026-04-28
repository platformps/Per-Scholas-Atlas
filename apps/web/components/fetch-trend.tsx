// Fetch-by-fetch trend chart — stacked bars showing HIGH/MEDIUM/LOW/REJECT
// counts per fetch_run over the trailing window. Each bar is one cron run
// (or manual trigger). Rescores are excluded from the trend because they
// don't represent a new data point in time — they're re-evaluations of
// existing data. Including them would produce misleading bars where the
// taxonomy version changed but the underlying labor market didn't.
//
// CSS-only rendering (no chart library). Sized to fit comfortably below
// the pipeline stat row at 1600px max-width.

import { Card } from './ui/card';
import { EmptyState } from './ui/empty-state';

interface TrendPoint {
  fetchRunId: string;
  date: string; // ISO string
  triggerType: 'scheduled' | 'manual' | 'rescore';
  high: number;
  medium: number;
  low: number;
  reject: number;
}

interface FetchTrendProps {
  data: TrendPoint[];
  windowDays: number;
}

export function FetchTrend({ data, windowDays }: FetchTrendProps) {
  // Filter out rescores — they don't represent new market data.
  const points = data.filter(p => p.triggerType !== 'rescore');

  if (points.length === 0) {
    return (
      <Card>
        <div className="p-6">
          <SectionHeader windowDays={windowDays} count={0} />
          <div className="mt-4">
            <EmptyState message="No fetches in this window yet. The cron runs Mon/Wed/Fri at 9am ET — first bar lands then." />
          </div>
        </div>
      </Card>
    );
  }

  // Total height of each bar is proportional to total jobs returned in that fetch.
  // Use the max across the window so bars are comparable.
  const maxTotal = Math.max(
    1,
    ...points.map(p => p.high + p.medium + p.low + p.reject),
  );

  return (
    <Card>
      <div className="p-6">
        <SectionHeader windowDays={windowDays} count={points.length} />

        <div
          className="grid gap-3 mt-4"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
          role="img"
          aria-label="Per-fetch confidence breakdown over time"
        >
          {points.map(p => {
            const total = p.high + p.medium + p.low + p.reject;
            const heightPct = (total / maxTotal) * 100;
            return (
              <div key={p.fetchRunId} className="flex flex-col items-center gap-2">
                {/* Bar container (fixed height; the stack fills bottom-up) */}
                <div className="w-full h-32 bg-gray-50 rounded-sm flex flex-col-reverse overflow-hidden">
                  <div
                    className="w-full flex flex-col-reverse"
                    style={{ height: `${Math.max(8, heightPct)}%` }}
                    title={`${total} jobs · ${formatLabel(p)}`}
                  >
                    {p.reject > 0 && (
                      <div
                        className="bg-gray-300 border-t border-gray-200"
                        style={{ height: `${(p.reject / total) * 100}%` }}
                        title={`Adjacent: ${p.reject}`}
                      />
                    )}
                    {p.low > 0 && (
                      <div
                        className="bg-yellow"
                        style={{ height: `${(p.low / total) * 100}%` }}
                        title={`Low: ${p.low}`}
                      />
                    )}
                    {p.medium > 0 && (
                      <div
                        className="bg-ocean"
                        style={{ height: `${(p.medium / total) * 100}%` }}
                        title={`Medium: ${p.medium}`}
                      />
                    )}
                    {p.high > 0 && (
                      <div
                        className="bg-royal"
                        style={{ height: `${(p.high / total) * 100}%` }}
                        title={`High: ${p.high}`}
                      />
                    )}
                  </div>
                </div>

                {/* Label below the bar */}
                <div className="text-[11px] font-mono text-gray-500 text-center leading-tight">
                  <div>{formatDate(p.date)}</div>
                  <div className="text-gray-400">{total} jobs</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
          <LegendDot color="bg-royal" label="High" />
          <LegendDot color="bg-ocean" label="Medium" />
          <LegendDot color="bg-yellow" label="Low" />
          <LegendDot color="bg-gray-300" label="Adjacent" />
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({ windowDays, count }: { windowDays: number; count: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <h3 className="text-sm font-semibold text-night">Detection trend</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Last {windowDays} days · scheduled and manual fetches
        </p>
      </div>
      {count > 0 && (
        <div className="text-xs text-gray-400">{count} fetch{count === 1 ? '' : 'es'}</div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`block w-2 h-2 rounded-sm ${color}`} aria-hidden />
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatLabel(p: TrendPoint): string {
  const d = new Date(p.date);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${p.triggerType})`;
}

export type { TrendPoint };
