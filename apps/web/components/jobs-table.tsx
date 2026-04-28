'use client';

// Expandable jobs table — Per Scholas brand redesign.
// White surface, gray hairlines, restrained color use (only Royal/Ocean/
// Yellow/Cloud via the ConfidenceBadge). Click a row to reveal the full
// score breakdown. Permissive row shape since Supabase typegen isn't wired.

import { useState } from 'react';
import { ConfidenceBadge, type Confidence } from './confidence-badge';

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
      <div className="bg-white border border-gray-200 rounded-md p-12 text-center shadow-sm">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">
          No results
        </div>
        <p className="text-sm text-gray-600 max-w-md mx-auto">
          No scored jobs for this view yet. The next scheduled fetch runs daily at 6am ET, or an
          admin can trigger a manual fetch from the Admin panel.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
      <div className="border-b border-gray-200 px-5 py-3.5 flex items-center justify-between">
        <div className="text-sm font-semibold text-night">
          Jobs <span className="text-gray-500 font-normal ml-1">· {scores.length} scored</span>
        </div>
        <div className="text-xs text-gray-400">
          Click a row to see the score breakdown.
        </div>
      </div>

      <div
        role="row"
        className="grid grid-cols-[80px_minmax(280px,2fr)_minmax(180px,1.2fr)_minmax(140px,1fr)_120px_70px] gap-3 px-5 py-2.5 border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
      >
        <div>Conf</div>
        <div>Title</div>
        <div>Employer</div>
        <div>Location</div>
        <div>Posted</div>
        <div className="text-right">Score</div>
      </div>

      <ul role="rowgroup" className="divide-y divide-gray-100">
        {scores.map(row => (
          <JobRow key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function JobRow({ row }: { row: ScoreRow }) {
  const [open, setOpen] = useState(false);
  const job = row.jobs ?? {};
  const location = formatLocation(job.cities_derived, job.regions_derived);
  const datePosted = formatDate(job.date_posted);

  return (
    <li role="row">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full grid grid-cols-[80px_minmax(280px,2fr)_minmax(180px,1.2fr)_minmax(140px,1fr)_120px_70px] gap-3 px-5 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center">
          <ConfidenceBadge value={row.confidence} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-night truncate">{job.title ?? '—'}</div>
          {row.title_tier && (
            <div className="text-xs text-gray-500 mt-0.5">
              <span className="font-medium text-navy">Tier {row.title_tier}</span>
              {row.title_matched ? <span className="text-gray-400"> · {row.title_matched}</span> : null}
              {row.tags?.length ? (
                <span className="ml-2 inline-flex flex-wrap gap-1">
                  {row.tags.map(t => (
                    <span key={t} className="inline-block bg-cloud text-night px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded-sm">
                      {t}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <div className="text-sm text-gray-700 truncate">
          {job.organization ?? '—'}
          {row.employer_hit && (
            <span className="ml-1.5 text-royal" title="On employer watchlist">
              ★
            </span>
          )}
        </div>
        <div className="text-sm text-gray-600 truncate">{location}</div>
        <div className="text-xs text-gray-500">{datePosted}</div>
        <div className="text-sm font-semibold text-night text-right tabular-nums">
          {row.score}
        </div>
      </button>

      {open && <JobDetail row={row} job={job} />}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function JobDetail({ row, job }: { row: ScoreRow; job: JoinedJob }) {
  return (
    <div className="px-5 py-5 bg-gray-50 border-t border-gray-200">
      {row.confidence === 'REJECT' && row.rejection_reason && (
        <div className="mb-5 bg-white border border-orange/30 border-l-4 border-l-orange rounded-sm p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-orange mb-1">
            Rejection reason
          </div>
          <div className="text-sm text-gray-800">{row.rejection_reason}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
            Score breakdown
          </div>
          <ul className="text-sm space-y-1.5">
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
            <li className="flex justify-between border-t border-gray-300 pt-2 mt-1.5 text-night font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{row.score}</span>
            </li>
          </ul>

          {row.distance_miles != null && (
            <div className="mt-4 text-xs text-gray-500">
              Distance: <span className="text-gray-800 font-medium">{row.distance_miles.toFixed(1)} mi</span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <ChipBlock label="Core matched" items={row.core_matched} accent="royal" />
          <ChipBlock label="Specialized" items={row.specialized_matched} accent="ocean" />
          <ChipBlock label="Bonus" items={row.bonus_matched} accent="cloud" />
          <ChipBlock label="Industry" items={row.industry_matched} accent="yellow" />
          <ChipBlock label="Certifications" items={row.certs_matched} accent="navy" />
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-gray-200 flex items-center justify-between gap-4">
        <div className="text-xs text-gray-500">
          {job.ai_experience_level ? (
            <>
              Exp level: <span className="text-gray-700 font-medium">{job.ai_experience_level}</span>
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
            className="text-xs font-semibold uppercase tracking-wider text-royal hover:text-navy"
          >
            View posting →
          </a>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ScoreLine({ label, value, negative = false }: { label: string; value: number; negative?: boolean }) {
  return (
    <li className="flex justify-between text-gray-700">
      <span>{label}</span>
      <span className={`tabular-nums font-medium ${negative ? 'text-orange' : 'text-night'}`}>
        {value > 0 ? `+${value}` : value}
      </span>
    </li>
  );
}

const CHIP_STYLES: Record<string, string> = {
  royal:  'bg-royal/10 text-royal border-royal/20',
  ocean:  'bg-ocean/10 text-ocean border-ocean/20',
  yellow: 'bg-yellow/15 text-night border-yellow/30',
  navy:   'bg-navy/10 text-navy border-navy/20',
  cloud:  'bg-cloud text-gray-700 border-gray-200',
};

function ChipBlock({ label, items, accent }: { label: string; items: string[]; accent: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        {label}{' '}
        <span className="text-gray-400 font-normal">({items?.length ?? 0})</span>
      </div>
      {items?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map(item => (
            <span
              key={item}
              className={`inline-block border px-2 py-0.5 text-xs rounded-sm ${CHIP_STYLES[accent] ?? CHIP_STYLES.cloud}`}
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-gray-400">—</div>
      )}
    </div>
  );
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
