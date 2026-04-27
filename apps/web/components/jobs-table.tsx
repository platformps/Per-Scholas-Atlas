'use client';

// Expandable jobs table for the dashboard. Rows are pre-sorted by score (desc)
// in the parent server component; we don't re-sort here. Clicking a row toggles
// a detail panel with the full score breakdown.
//
// Shape note: Supabase typegen isn't wired into this scaffold, so the row
// shape is permissive. We document the fields we touch and otherwise let
// `unknown`/optionals carry the slack.

import { useState } from 'react';
import { ConfidenceBadge, type Confidence } from './confidence-badge';

// ─── Row shape (permissive — matches the dashboard's Supabase select) ──────
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
      <div className="border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
          No results
        </div>
        <div className="text-sm text-zinc-400">
          No scored jobs for this view yet. The next scheduled fetch runs Monday at 6am ET, or an admin can trigger a manual fetch.
        </div>
      </div>
    );
  }

  return (
    <div className="border border-zinc-800 bg-zinc-950/40">
      <div className="border-b border-zinc-900 px-4 py-2.5 flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          Jobs · {scores.length} scored
        </div>
        <div className="text-[10px] font-mono text-zinc-600">
          Click a row to see the score breakdown.
        </div>
      </div>

      {/* Header row */}
      <div
        role="row"
        className="grid grid-cols-[80px_minmax(280px,2fr)_minmax(180px,1.2fr)_minmax(140px,1fr)_120px_70px] gap-3 px-4 py-2 border-b border-zinc-900 text-[10px] font-mono uppercase tracking-widest text-zinc-500"
      >
        <div>Conf</div>
        <div>Title</div>
        <div>Employer</div>
        <div>Location</div>
        <div>Posted</div>
        <div className="text-right">Score</div>
      </div>

      <ul role="rowgroup" className="divide-y divide-zinc-900">
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
        className="w-full grid grid-cols-[80px_minmax(280px,2fr)_minmax(180px,1.2fr)_minmax(140px,1fr)_120px_70px] gap-3 px-4 py-3 text-left hover:bg-zinc-900/40 transition-colors"
      >
        <div className="flex items-center">
          <ConfidenceBadge value={row.confidence} />
        </div>
        <div className="min-w-0">
          <div className="text-sm text-zinc-200 truncate">{job.title ?? '—'}</div>
          {row.title_tier && (
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mt-0.5">
              Tier {row.title_tier}
              {row.title_matched ? ` · ${row.title_matched}` : ''}
              {row.tags?.length ? ` · ${row.tags.join(' · ')}` : ''}
            </div>
          )}
        </div>
        <div className="text-sm text-zinc-300 truncate">
          {job.organization ?? '—'}
          {row.employer_hit && (
            <span className="ml-1 text-[10px] font-mono text-emerald-400 uppercase tracking-widest">
              ✓
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-400 truncate font-mono">{location}</div>
        <div className="text-xs text-zinc-500 font-mono">{datePosted}</div>
        <div className="text-sm text-zinc-200 text-right font-mono tabular-nums">
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
    <div className="px-4 py-4 bg-black/30 border-t border-zinc-900">
      {row.confidence === 'REJECT' && row.rejection_reason && (
        <div className="mb-4 border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
            Rejection reason
          </div>
          <div className="text-sm text-zinc-300">{row.rejection_reason}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Score breakdown */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
            Score breakdown
          </div>
          <ul className="text-xs space-y-1 font-mono">
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
            <li className="flex justify-between border-t border-zinc-800 pt-1 mt-1 text-zinc-200">
              <span>Total</span>
              <span className="tabular-nums">{row.score}</span>
            </li>
          </ul>

          {row.distance_miles != null && (
            <div className="mt-3 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
              Distance: <span className="text-zinc-300 normal-case">{row.distance_miles.toFixed(1)} mi</span>
            </div>
          )}
        </div>

        {/* Matched chips */}
        <div className="space-y-3">
          <ChipBlock label="Core matched" items={row.core_matched} accent="emerald" />
          <ChipBlock label="Specialized" items={row.specialized_matched} accent="cyan" />
          <ChipBlock label="Bonus" items={row.bonus_matched} accent="zinc" />
          <ChipBlock label="Industry" items={row.industry_matched} accent="amber" />
          <ChipBlock label="Certifications" items={row.certs_matched} accent="indigo" />
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-zinc-900 flex items-center justify-between gap-4">
        <div className="text-[10px] font-mono text-zinc-600">
          {job.ai_experience_level ? `Exp level: ${job.ai_experience_level}` : ''}
          {job.ai_salary_min || job.ai_salary_max ? (
            <>
              {' · '}
              {formatSalary(job.ai_salary_min, job.ai_salary_max)}
            </>
          ) : null}
          {' · '}
          Scored {formatDate(row.scored_at)}
        </div>
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 hover:text-emerald-300"
          >
            View posting ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ScoreLine({ label, value, negative = false }: { label: string; value: number; negative?: boolean }) {
  return (
    <li className="flex justify-between text-zinc-400">
      <span>{label}</span>
      <span className={`tabular-nums ${negative ? 'text-orange-400' : ''}`}>{value > 0 ? `+${value}` : value}</span>
    </li>
  );
}

const CHIP_STYLES: Record<string, string> = {
  emerald: 'border-emerald-800 text-emerald-300',
  cyan:    'border-cyan-800 text-cyan-300',
  zinc:    'border-zinc-700 text-zinc-400',
  amber:   'border-amber-800 text-amber-300',
  indigo:  'border-indigo-800 text-indigo-300',
};

function ChipBlock({ label, items, accent }: { label: string; items: string[]; accent: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
        {label}{' '}
        <span className="text-zinc-700">({items?.length ?? 0})</span>
      </div>
      {items?.length ? (
        <div className="flex flex-wrap gap-1">
          {items.map(item => (
            <span
              key={item}
              className={`inline-block border px-1.5 py-0.5 text-[10px] font-mono ${CHIP_STYLES[accent] ?? CHIP_STYLES.zinc}`}
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-zinc-600 font-mono">—</div>
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
