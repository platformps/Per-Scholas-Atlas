'use client';

// CSV export button — formats the focused-detail jobs table to CSV and
// downloads via a synthetic <a> click. No server round-trip; the rows
// are already in memory from the server-rendered page.
//
// CSV escape rules:
//   • Wrap every cell in double quotes
//   • Replace " inside cells with ""
//   • Replace newlines with spaces (description_text would otherwise break
//     row boundaries in some readers)

import { Button } from './ui/button';

export interface CsvRow {
  confidence: string;
  score: number;
  title_tier: string | null;
  title_matched: string | null;
  title: string;
  organization: string;
  url: string;
  city: string;
  region: string;
  date_posted: string;
  experience_level: string;
  scored_at: string;
  rejection_reason: string;
}

interface Props {
  rows: CsvRow[];
  filename: string;
  /** Label override; defaults to 'Download CSV (N jobs)' */
  label?: string;
}

const HEADERS = [
  ['confidence', 'Confidence'],
  ['score', 'Score'],
  ['title_tier', 'Title Tier'],
  ['title_matched', 'Title Matched'],
  ['title', 'Job Title'],
  ['organization', 'Employer'],
  ['url', 'Posting URL'],
  ['city', 'City'],
  ['region', 'Region'],
  ['date_posted', 'Date Posted'],
  ['experience_level', 'Experience Level'],
  ['scored_at', 'Scored At'],
  ['rejection_reason', 'Rejection Reason'],
] as const;

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = String(v).replace(/[\r\n]+/g, ' ');
  return `"${s.replace(/"/g, '""')}"`;
}

export function CsvExportButton({ rows, filename, label }: Props) {
  function download() {
    const headerLine = HEADERS.map(([, h]) => escapeCell(h)).join(',');
    const dataLines = rows.map(r =>
      HEADERS.map(([k]) =>
        escapeCell((r as unknown as Record<string, unknown>)[k]),
      ).join(','),
    );
    const csv = [headerLine, ...dataLines].join('\r\n');
    // Excel needs a BOM to read UTF-8 correctly when there are non-ASCII
    // characters (employer names with diacritics, em-dashes in titles, etc.).
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Button
      onClick={download}
      variant="secondary"
      size="sm"
      disabled={rows.length === 0}
      title={
        rows.length === 0
          ? 'No rows to export'
          : 'Download these jobs as a CSV — opens cleanly in Excel and Google Sheets'
      }
    >
      {label ?? `Download CSV (${rows.length.toLocaleString()})`}
    </Button>
  );
}
