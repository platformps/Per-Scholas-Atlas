'use client';

// Expandable jobs table — Per Scholas brand redesign.
//
// Refactored from a grid-of-divs layout to a real <table> element so the
// row content can scroll horizontally on narrow viewports without crushing
// the title column. The table sits inside an `overflow-x-auto` wrapper with
// a `min-w-[840px]` floor so columns stay legible at any width.
//
// Click a row to reveal the full score breakdown — the detail panel is
// rendered as a second <tr> with colspan covering the full row width. We
// keep the same Per Scholas chrome: white surface, gray hairlines,
// restrained color use (Royal/Ocean/Yellow/Gray via ConfidenceBadge).

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { ConfidenceBadge, type Confidence } from './confidence-badge';
import { Card } from './ui/card';
import { Badge } from './ui/badge';

interface JoinedJob {
  id?: string;
  source_id?: string;
  title?: string;
  organization?: string | null;
  url?: string | null;
  date_posted?: string | null;
  cities_derived?: string[] | null;
  regions_derived?: string[] | null;
  ai_salary_min?: number | null;
  ai_salary_max?: number | null;
  description_text?: string | null;
  ai_key_skills?: string[] | null;
  ai_experience_level?: string | null;
  still_active?: boolean | null;
}

interface ScoreRow {
  id: string;
  job_id: string;
  confidence: Confidence;
  score: number;
  title_tier: 'A' | 'B' | 'C' | 'D' | null;
  title_matched: string | null;
  title_score: number;
  core_matched: string[];
  core_score: number;
  specialized_matched: string[];
  specialized_score: number;
  bonus_matched: string[];
  bonus_score: number;
  industry_matched: string[];
  industry_score: number;
  certs_matched: string[];
  certs_score: number;
  employer_hit: boolean;
  employer_score: number;
  experience_penalty: number;
  distance_miles: number | null;
  tags: string[];
  rejection_reason: string | null;
  scored_at: string;
  jobs: JoinedJob | null;
}

interface JobsTableProps {
  scores: ScoreRow[];
}

export function JobsTable({ scores }: JobsTableProps) {
  if (scores.length === 0) {
    return (
      <Card>
        <div className="p-12 text-center">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">
            No results
          </div>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            No scored jobs for this view yet. The next scheduled fetch runs Mon/Wed/Fri at 9am ET,
            or an admin can trigger a manual fetch from the Admin panel.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="border-b border-gray-200 bg-cloud px-6 py-4 flex items-center justify-between">
        <div className="text-sm font-semibold text-night">
          Jobs <span className="text-gray-600 font-normal ml-1">· {scores.length} scored</span>
        </div>
        <div className="text-xs text-gray-500 hidden sm:block">
          Click a row to see the score breakdown.
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] border-collapse">
          <colgroup>
            <col style={{ width: '80px' }} />
            <col />
            <col style={{ width: '220px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '70px' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-6 py-2.5 text-left font-semibold">Conf</th>
              <th className="px-3 py-2.5 text-left font-semibold">Title</th>
              <th className="px-3 py-2.5 text-left font-semibold">Employer</th>
              <th className="px-3 py-2.5 text-left font-semibold">Location</th>
              <th className="px-3 py-2.5 text-left font-semibold">Posted</th>
              <th className="px-6 py-2.5 text-right font-semibold">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {scores.map(row => (
              <JobRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function JobRow({ row }: { row: ScoreRow }) {
  const [open, setOpen] = useState(false);
  const job = row.jobs ?? {};
  const location = formatLocation(job.cities_derived, job.regions_derived);
  const datePosted = formatDate(job.date_posted);

  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
      >
        <td className="px-6 py-3 align-top">
          <ConfidenceBadge value={row.confidence} />
        </td>
        <td className="px-3 py-3 align-top min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium text-night truncate">{job.title ?? '—'}</span>
            {job.url && (
              // stopPropagation so clicking the link doesn't also toggle the
              // row-expand drawer behind it. Open in new tab so the MD can
              // scan the JD without losing their place in the dashboard.
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                aria-label="Open posting in new tab"
                title="Open posting"
                className="shrink-0 text-gray-400 hover:text-royal focus:text-royal focus:outline-none focus:ring-2 focus:ring-royal/30 rounded-sm transition-colors duration-150"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </div>
          {row.title_tier && (
            <div className="text-xs text-gray-500 mt-0.5">
              <span className="font-medium text-navy">Tier {row.title_tier}</span>
              {row.title_matched ? (
                <span className="text-gray-400"> · {row.title_matched}</span>
              ) : null}
              {row.tags?.length ? (
                <span className="ml-2 inline-flex flex-wrap gap-1">
                  {row.tags.map(t => (
                    <Badge key={t} tone="gray" variant="soft" size="sm">
                      {t}
                    </Badge>
                  ))}
                </span>
              ) : null}
            </div>
          )}
          {/* Inline rejection-reason hint for ADJACENT rows. The full
             "Why this is adjacent" panel still lives in the expand
             drawer, but surfacing the one-liner here saves the
             reviewer-pattern question of "why is this 'Field
             Technician' showing as 0 points?" — they can read the
             reason without opening the row. */}
          {row.confidence === 'REJECT' && (
            <div className="text-[11px] text-orange/80 mt-0.5 italic">
              {humanizeRejection(row)}
            </div>
          )}
        </td>
        <td className="px-3 py-3 align-top text-sm text-gray-700 truncate max-w-0">
          <span className="truncate inline-block max-w-full align-bottom">
            {job.organization ?? '—'}
            {row.employer_hit && (
              <span className="ml-1.5 text-royal" title="On employer watchlist">
                ★
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-3 align-top text-sm text-gray-600 truncate max-w-0">
          <span className="truncate inline-block max-w-full align-bottom">{location}</span>
        </td>
        <td className="px-3 py-3 align-top text-xs text-gray-500">{datePosted}</td>
        <td className="px-6 py-3 align-top text-sm font-semibold text-night text-right tabular-nums">
          {row.score}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="p-0">
            <JobDetail row={row} job={job} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function JobDetail({ row, job }: { row: ScoreRow; job: JoinedJob }) {
  return (
    <div className="px-6 py-5 bg-gray-50 border-t border-gray-200">
      {row.confidence === 'REJECT' && (
        <div className="mb-5 bg-white border border-orange/30 border-l-4 border-l-orange rounded-sm p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-orange mb-1">
            Why this is adjacent
          </div>
          <div className="text-sm text-gray-800">
            {row.rejection_reason ?? (
              <>
                Below qualifying threshold — total <strong>{row.score} points</strong>,
                needs at least <strong>30</strong> to qualify as LOW. Title matched but
                the description didn&apos;t accumulate enough curriculum-aligned skills,
                certifications, or industry context.
              </>
            )}
          </div>
        </div>
      )}
      {row.confidence !== 'REJECT' && (
        <QualifyingReasonPanel row={row} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
            Score breakdown
          </div>
          <ul className="text-sm space-y-2">
            <ScoreLine label={`Title (Tier ${row.title_tier ?? '—'})`} value={row.title_score} />
            <ScoreLine label="Core skills" value={row.core_score} />
            <ScoreLine label="Specialized" value={row.specialized_score} />
            <ScoreLine label="Bonus" value={row.bonus_score} />
            <ScoreLine label="Industry context" value={row.industry_score} />
            <ScoreLine label="Certifications" value={row.certs_score} />
            <ScoreLine label="Employer watchlist" value={row.employer_score} />
            {row.experience_penalty > 0 && (
              <ScoreLine label="Experience penalty" value={-row.experience_penalty} negative />
            )}
            <li className="flex justify-between border-t border-gray-300 pt-2 mt-2 text-night font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{row.score}</span>
            </li>
          </ul>

          {row.distance_miles != null && (
            <div className="mt-4 text-xs text-gray-500">
              Distance:{' '}
              <span className="text-gray-800 font-medium">
                {row.distance_miles.toFixed(1)} mi
              </span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <ChipBlock label="Core matched" items={row.core_matched} tone="royal" />
          <ChipBlock label="Specialized" items={row.specialized_matched} tone="ocean" />
          <ChipBlock label="Bonus" items={row.bonus_matched} tone="gray" />
          <ChipBlock label="Industry" items={row.industry_matched} tone="yellow" />
          <ChipBlock label="Certifications" items={row.certs_matched} tone="navy" />
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-gray-200 flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-gray-500">
          {job.ai_experience_level ? (
            <>
              Exp level:{' '}
              <span className="text-gray-700 font-medium">{job.ai_experience_level}</span>
            </>
          ) : null}
          {job.ai_salary_min || job.ai_salary_max ? (
            <span className="ml-3">{formatSalary(job.ai_salary_min, job.ai_salary_max)}</span>
          ) : null}
          <span className="ml-3 text-gray-400">Scored {formatDate(row.scored_at)}</span>
        </div>
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold uppercase tracking-wider text-royal hover:text-navy transition-colors duration-150"
          >
            View posting →
          </a>
        )}
      </div>
    </div>
  );
}

// ─── "Why this is qualifying" panel ─────────────────────────────────────────
//
// Mirrors the REJECT-side "Why this is adjacent" panel. Surfaces the same
// match data the score breakdown shows below, but in plain English so an
// MD can quickly answer "is this score real?" without reading the score
// math. Lists what tripped which gate.
function QualifyingReasonPanel({ row }: { row: ScoreRow }) {
  const reasons: React.ReactNode[] = [];
  if (row.title_tier && row.title_matched) {
    reasons.push(
      <>
        <strong>
          Tier {row.title_tier}
        </strong>{' '}
        title match on <strong>&ldquo;{row.title_matched}&rdquo;</strong> (+
        {row.title_score})
      </>,
    );
  } else if (row.title_score > 0) {
    reasons.push(
      <>
        Tier match (+{row.title_score})
      </>,
    );
  }
  if (row.core_matched.length > 0) {
    reasons.push(
      <>
        <strong>{row.core_matched.length}</strong> core skill
        {row.core_matched.length === 1 ? '' : 's'} found (+{row.core_score})
      </>,
    );
  }
  if (row.specialized_matched.length > 0) {
    reasons.push(
      <>
        <strong>{row.specialized_matched.length}</strong> specialized hands-on
        skill{row.specialized_matched.length === 1 ? '' : 's'} (+
        {row.specialized_score})
      </>,
    );
  }
  if (row.industry_matched.length > 0) {
    reasons.push(
      <>
        <strong>{row.industry_matched.length}</strong> industry-context phrase
        {row.industry_matched.length === 1 ? '' : 's'} (+{row.industry_score})
      </>,
    );
  }
  if (row.certs_matched.length > 0) {
    reasons.push(
      <>
        Cert{row.certs_matched.length === 1 ? '' : 's'} mentioned:{' '}
        <strong>{row.certs_matched.join(', ')}</strong> (+{row.certs_score})
      </>,
    );
  }
  if (row.employer_hit) {
    reasons.push(
      <>
        Employer is on the role&apos;s watchlist (+{row.employer_score})
      </>,
    );
  }
  if (row.experience_penalty > 0) {
    reasons.push(
      <span className="text-orange">
        Senior-experience penalty: −{row.experience_penalty}
      </span>,
    );
  }
  return (
    <div className="mb-5 bg-white border border-royal/20 border-l-4 border-l-royal rounded-sm p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-royal mb-1.5">
        Why this is qualifying
      </div>
      <div className="text-sm text-gray-800 mb-2">
        Total <strong>{row.score} points</strong>. Reads as <strong>{row.confidence}</strong>{' '}
        because it cleared{' '}
        {row.confidence === 'HIGH' ? (
          <>the HIGH bar (≥75)</>
        ) : row.confidence === 'MEDIUM' ? (
          <>the MEDIUM bar (≥50)</>
        ) : (
          <>the LOW bar (≥30)</>
        )}
        .
      </div>
      {reasons.length > 0 ? (
        <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5 marker:text-royal/40">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-500 italic">
          Score totaled from baseline match — see the breakdown below for detail.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ScoreLine({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <li className="flex justify-between text-gray-700">
      <span>{label}</span>
      <span className={`tabular-nums font-medium ${negative ? 'text-orange' : 'text-night'}`}>
        {value > 0 ? `+${value}` : value}
      </span>
    </li>
  );
}

type ChipTone = 'royal' | 'ocean' | 'yellow' | 'navy' | 'gray';

function ChipBlock({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: ChipTone;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        {label}{' '}
        <span className="text-gray-400 font-normal">({items?.length ?? 0})</span>
      </div>
      {items?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map(item => (
            <Badge key={item} tone={tone} variant="soft" size="sm">
              {item}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="text-xs text-gray-400">—</div>
      )}
    </div>
  );
}

// Translate a raw rejection_reason (or its absence) into a one-line hint
// the MD can read without expanding the row. Specifically tackles the
// reviewer-flagged pattern: 'Field Technician at 0 points looks relevant'
// — the row is rejected because the JD doesn't have telecom/fiber/cabling
// vocabulary, even though the title alone seems promising.
function humanizeRejection(row: ScoreRow): string {
  const r = row.rejection_reason;
  if (r) return r;
  // No explicit reason: the score didn't clear the LOW threshold.
  if (row.title_tier && row.title_score === 0) {
    return 'Title matched but description has no fiber/cabling/low-voltage industry signal';
  }
  if (row.title_score > 0 && row.score < 30) {
    return `Below qualifying threshold — ${row.score} pts, needs 30 (no curriculum-aligned skills or watchlist hit)`;
  }
  return 'Below qualifying threshold';
}

function formatLocation(cities?: string[] | null, regions?: string[] | null): string {
  const c = cities?.[0];
  const r = regions?.[0];
  if (c && r) return `${c}, ${r}`;
  return c ?? r ?? '—';
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSalary(min?: number | null, max?: number | null): string {
  if (!min && !max) return '';
  const fmt = (n: number) => `$${(n / 1000).toFixed(0)}k`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  return fmt((min ?? max) as number);
}
