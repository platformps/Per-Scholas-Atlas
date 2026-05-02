// Generic comparison table — used for three flavors:
//
//   1. Aggregate "Top campuses" leaderboard       (rows are campuses)
//   2. Aggregate "Top roles" leaderboard          (rows are roles)
//   3. Role-first compare campuses for one role   (rows are campuses, scoped)
//   4. Campus-first compare roles for one campus  (rows are roles, scoped)
//
// Each row carries: name + (optional) subtitle, total job records, qualifying
// share (HIGH+MEDIUM+LOW), unique employers, top job titles (truncated), and
// a placement-readiness mini-bar. Clicking a row navigates with the
// appropriate URL params layered on the existing ones — that powers the
// drill-down flow ("see Atlanta for CFT", "see Cybersecurity for Newark",
// etc.).
//
// "Placement readiness" is the qualifying-share metric: of the postings live
// in this market, how many are placement-ready for graduates of this
// curriculum? Rendered as a 0-100 bar with a 5-step label (Strong / Healthy /
// Mixed / Light / Sparse). Heuristic, not a model — but it gives the MD an
// at-a-glance read of "where can my graduates land?" without forcing them
// to do mental percentage math. Naming history: was "Market signal" (too
// ambiguous), briefly "Curriculum match" (process-oriented), now
// "Placement readiness" (outcome-oriented, aligns with how Per Scholas
// already talks about graduate outcomes).

import Link from 'next/link';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { EmptyState } from '../ui/empty-state';

export interface ComparisonRow {
  /** Stable id for the row (campus_id or role_id). */
  id: string;
  /** Display name (e.g. "Atlanta" or "Critical Facilities Technician"). */
  name: string;
  /** Optional secondary line (e.g. campus state, role short code). */
  subtitle?: string;
  /** "Seen" — every scored record in the 30-day window. */
  total: number;
  /** "Still Active" — subset of total whose underlying job is still live
   *  on the source ATS (still_active !== false). */
  live: number;
  /** "Qualifying" — live AND non-REJECT. Mirrors pipeline-stats.tsx. */
  qualifying: number;
  /** Distinct employer organizations across qualifying jobs. */
  employers: number;
  /** Top job titles, already deduped by canonical title. */
  topTitles: string[];
  /** Confidence buckets (used for an inline distribution mini-bar). */
  buckets: { HIGH: number; MEDIUM: number; LOW: number; REJECT: number };
  /** Optional drill-down URL. Renders the row as a Link if present. */
  href?: string;
  /** Mark this row as the user's "home" / focused row (gets a star). */
  highlight?: boolean;
}

interface ComparisonTableProps {
  /** Section title (e.g. "Campus performance · Cybersecurity"). */
  title: string;
  /** Optional helper line under the title. */
  description?: string;
  /** Column header for the row name (e.g. "Campus" or "Role"). */
  rowLabel: string;
  /** All rows; pre-sorted by the parent so we don't re-sort. */
  rows: ComparisonRow[];
  /** Empty-state message when rows.length === 0. */
  emptyMessage?: string;
  /** Show numeric rank on the left (1, 2, 3…). Useful for leaderboards. */
  ranked?: boolean;
  /** Optional caption under the table — used to flag overlap caveats so
   *  readers understand why row counts can exceed the unique-postings tile. */
  footnote?: string;
}

export function ComparisonTable({
  title,
  description,
  rowLabel,
  rows,
  emptyMessage = 'No data in this window yet.',
  ranked = false,
  footnote,
}: ComparisonTableProps) {
  return (
    <Card>
      <div className="border-b border-gray-200 bg-cloud px-6 py-4 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-night">{title}</h3>
          {description && (
            <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
        <span className="text-xs text-gray-500 shrink-0">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState message={emptyMessage} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {ranked && <th className="px-6 py-2.5 text-left w-[44px]">#</th>}
                <th className="px-3 py-2.5 text-left">{rowLabel}</th>
                <th className="px-3 py-2.5 text-right w-[72px]">Seen</th>
                <th className="px-3 py-2.5 text-right w-[88px]">Still active</th>
                <th className="px-3 py-2.5 text-right w-[88px]">Qualifying</th>
                <th className="px-3 py-2.5 text-right w-[80px]">Employers</th>
                <th className="px-3 py-2.5 text-left min-w-[200px]">Top titles</th>
                <th className="px-6 py-2.5 text-left w-[200px]">
                  <span
                    title={
                      'Of the postings live in this market, how many are placement-ready for graduates of this curriculum? ' +
                      'Computed as HIGH+MEDIUM+LOW ÷ still-active.\n\n' +
                      '• Strong  ≥ 70% placement-ready\n' +
                      '• Healthy 50–69%\n' +
                      '• Mixed   30–49%\n' +
                      '• Light   15–29%\n' +
                      '• Sparse  < 15%\n\n' +
                      'The mini-bar shows the H/M/L breakdown; gray = ADJACENT (not placement-ready).'
                    }
                    className="cursor-help border-b border-dotted border-gray-400 hover:border-gray-600"
                  >
                    Placement readiness
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, idx) => (
                <ComparisonRowEl
                  key={r.id}
                  row={r}
                  rank={ranked ? idx + 1 : null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footnote && rows.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50 px-6 py-2.5">
          <p className="text-[11px] text-gray-500 leading-relaxed">{footnote}</p>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ComparisonRowEl({ row, rank }: { row: ComparisonRow; rank: number | null }) {
  const interactive = !!row.href;
  // total === 0 means this (campus, role) pair has zero scored records in
  // the 30-day window — distinct from "scored but all rejected." Shown
  // muted with a "Not yet fetched" hint so admins can tell the difference
  // between "no data because we haven't asked" and "no data because the
  // market is genuinely cold right now."
  const empty = row.total === 0;
  const Wrapper = interactive
    ? ({ children }: { children: React.ReactNode }) => (
        <Link href={row.href!} className="contents">
          {children}
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => <>{children}</>;

  return (
    <tr
      className={[
        'transition-colors duration-150',
        interactive ? 'hover:bg-gray-50 cursor-pointer' : '',
        row.highlight ? 'bg-royal/[0.04]' : '',
      ].join(' ')}
    >
      <Wrapper>
        {rank !== null && (
          <td className="px-6 py-3 align-top text-xs font-semibold text-gray-400 tabular-nums">
            {rank}
          </td>
        )}
        <td className="px-3 py-3 align-top">
          <div className="flex items-center gap-2 min-w-0">
            {row.highlight && (
              <span className="text-royal text-sm leading-none" title="Your campus">
                ★
              </span>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-night truncate">{row.name}</div>
              {row.subtitle && (
                <div className="text-xs text-gray-500 truncate">{row.subtitle}</div>
              )}
            </div>
          </div>
        </td>
        <td className="px-3 py-3 align-top text-sm text-night text-right tabular-nums">
          {empty ? <span className="text-gray-300">—</span> : row.total.toLocaleString()}
        </td>
        <td className="px-3 py-3 align-top text-sm text-night text-right tabular-nums">
          {empty ? (
            <span className="text-gray-300">—</span>
          ) : (
            <>
              <span>{row.live.toLocaleString()}</span>
              {row.total ? (
                <span className="text-gray-400 ml-1">
                  · {Math.round((row.live / row.total) * 100)}%
                </span>
              ) : null}
            </>
          )}
        </td>
        <td className="px-3 py-3 align-top text-sm text-right tabular-nums">
          {empty ? (
            <span className="text-gray-300">—</span>
          ) : (
            <>
              <span className="text-royal font-medium">{row.qualifying.toLocaleString()}</span>
              {row.live ? (
                <span className="text-gray-400 ml-1">
                  · {Math.round((row.qualifying / row.live) * 100)}%
                </span>
              ) : null}
            </>
          )}
        </td>
        <td className="px-3 py-3 align-top text-sm text-gray-700 text-right tabular-nums">
          {empty ? <span className="text-gray-300">—</span> : row.employers.toLocaleString()}
        </td>
        <td className="px-3 py-3 align-top text-xs text-gray-700">
          {empty ? (
            <span className="text-[11px] text-gray-500 italic">
              Not yet fetched · trigger a manual fetch
            </span>
          ) : row.topTitles.length === 0 ? (
            <span className="text-gray-400">—</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {row.topTitles.slice(0, 3).map(t => (
                <Badge key={t} tone="gray" variant="soft" size="sm">
                  {t}
                </Badge>
              ))}
              {row.topTitles.length > 3 && (
                <span className="text-[11px] text-gray-400 self-center">
                  +{row.topTitles.length - 3}
                </span>
              )}
            </div>
          )}
        </td>
        <td className="px-6 py-3 align-top">
          <PlacementReadiness buckets={row.buckets} total={row.live} />
        </td>
      </Wrapper>
    </tr>
  );
}

// ─── placement-readiness mini-bar ──────────────────────────────────────────
function PlacementReadiness({
  buckets,
  total,
}: {
  buckets: ComparisonRow['buckets'];
  total: number;
}) {
  if (total === 0) return <span className="text-xs text-gray-400">No data</span>;
  const qualifying = buckets.HIGH + buckets.MEDIUM + buckets.LOW;
  const pct = (qualifying / total) * 100;
  const label =
    pct >= 70 ? 'Strong' :
    pct >= 50 ? 'Healthy' :
    pct >= 30 ? 'Mixed' :
    pct >= 15 ? 'Light' :
                'Sparse';
  const tip =
    `${qualifying} of ${total} qualifying (${Math.round(pct)}%) — ${label}\n` +
    `HIGH ${buckets.HIGH} · MEDIUM ${buckets.MEDIUM} · LOW ${buckets.LOW} · ADJACENT ${buckets.REJECT}`;
  return (
    <div className="flex flex-col gap-1.5 min-w-[120px]" title={tip}>
      <div className="flex h-1.5 rounded-sm overflow-hidden bg-gray-100">
        {buckets.HIGH > 0 && (
          <div className="bg-royal" style={{ width: `${(buckets.HIGH / total) * 100}%` }} />
        )}
        {buckets.MEDIUM > 0 && (
          <div className="bg-ocean" style={{ width: `${(buckets.MEDIUM / total) * 100}%` }} />
        )}
        {buckets.LOW > 0 && (
          <div className="bg-yellow" style={{ width: `${(buckets.LOW / total) * 100}%` }} />
        )}
      </div>
      <div className="text-[11px] text-gray-500 leading-tight">
        {label} <span className="text-gray-400">· {Math.round(pct)}%</span>
      </div>
    </div>
  );
}
