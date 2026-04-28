// 30-day pipeline overview — primary headline metrics for the dashboard.
// Six tiles: Seen, Still Active, Qualifying, High, Medium, Low. Uses
// the shared <Card> primitive and a local BigStat helper.

import { Card } from './ui/card';

interface PipelineStatsProps {
  windowDays: number;
  totalSeen: number;
  stillActive: number;
  qualifying: number;
  counts: { HIGH: number; MEDIUM: number; LOW: number; REJECT: number };
}

export function PipelineStats({
  windowDays,
  totalSeen,
  stillActive,
  qualifying,
  counts,
}: PipelineStatsProps) {
  const qualifyingPct = totalSeen ? Math.round((qualifying / totalSeen) * 100) : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      <BigStat
        label={`Seen · ${windowDays}d`}
        value={totalSeen}
        sublabel="unique postings"
        tone="neutral"
      />
      <BigStat
        label="Still Active"
        value={stillActive}
        sublabel={totalSeen ? `${Math.round((stillActive / totalSeen) * 100)}% of seen` : ''}
        tone="neutral"
      />
      <BigStat
        label="Qualifying"
        value={qualifying}
        sublabel={totalSeen ? `${qualifyingPct}% pass rate` : ''}
        tone="navy"
      />
      <BigStat label="High" value={counts.HIGH} tone="royal" />
      <BigStat label="Medium" value={counts.MEDIUM} tone="ocean" />
      <BigStat label="Low" value={counts.LOW} tone="yellow" />
    </div>
  );
}

// ─── BigStat tile ────────────────────────────────────────────────────────────

interface BigStatProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: 'neutral' | 'navy' | 'royal' | 'ocean' | 'yellow';
}

const TONE_CLASSES: Record<NonNullable<BigStatProps['tone']>, string> = {
  neutral: 'text-night',
  navy:    'text-navy',
  royal:   'text-royal',
  ocean:   'text-ocean',
  yellow:  'text-yellow',
};

function BigStat({ label, value, sublabel, tone = 'neutral' }: BigStatProps) {
  return (
    <Card>
      <div className="p-6">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">
          {label}
        </div>
        <div className={`text-4xl font-semibold tracking-tight leading-none ${TONE_CLASSES[tone]}`}>
          {value}
        </div>
        {sublabel && <div className="text-xs text-gray-500 mt-2">{sublabel}</div>}
      </div>
    </Card>
  );
}
