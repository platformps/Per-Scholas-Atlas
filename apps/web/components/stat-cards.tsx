// StatCards — top-of-dashboard summary tiles. White cards on white bg with
// hairline borders + subtle elevation, per the brand book's "negative space"
// and "color with restraint" guidance. Confidence accents echo the badge
// colors (Royal/Ocean/Yellow) so the eye links the count to the bucket.

interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  /** Tailwind text-color class for the numeric value. Default is brand navy. */
  accent?: string;
}

function StatCard({ label, value, sublabel, accent = 'text-night' }: StatCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-md p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">
        {label}
      </div>
      <div className={`text-3xl font-semibold tracking-tight leading-none ${accent}`}>
        {value}
      </div>
      {sublabel && (
        <div className="text-xs text-gray-500 mt-2 font-normal">{sublabel}</div>
      )}
    </div>
  );
}

interface StatCardsProps {
  total: number;
  qualifying: number;
  counts: { HIGH: number; MEDIUM: number; LOW: number; REJECT: number };
  avgSalaryMin: number;
  avgSalaryMax: number;
}

export function StatCards({ total, qualifying, counts, avgSalaryMin, avgSalaryMax }: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <StatCard label="Total Pulled" value={total} sublabel="last fetch" />
      <StatCard
        label="Qualifying"
        value={qualifying}
        sublabel={total ? `${((qualifying / total) * 100).toFixed(0)}% of total` : ''}
        accent="text-navy"
      />
      <StatCard label="High" value={counts.HIGH} accent="text-royal" />
      <StatCard label="Medium" value={counts.MEDIUM} accent="text-ocean" />
      <StatCard label="Low" value={counts.LOW} accent="text-yellow" />
      <StatCard
        label="Avg Salary"
        value={avgSalaryMin ? `$${(avgSalaryMin / 1000).toFixed(0)}k` : '—'}
        sublabel={avgSalaryMax ? `→ $${(avgSalaryMax / 1000).toFixed(0)}k` : ''}
      />
    </div>
  );
}
