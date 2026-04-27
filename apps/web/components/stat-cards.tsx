interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: string;
}

function StatCard({ label, value, sublabel, accent = 'text-zinc-100' }: StatCardProps) {
  return (
    <div className="border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">{label}</div>
      <div className={`text-3xl font-light tracking-tight ${accent}`}>{value}</div>
      {sublabel && <div className="text-xs text-zinc-500 mt-1 font-mono">{sublabel}</div>}
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
    <div className="grid grid-cols-6 gap-3">
      <StatCard label="Total Pulled" value={total} sublabel="last fetch" />
      <StatCard
        label="Qualifying"
        value={qualifying}
        sublabel={total ? `${((qualifying / total) * 100).toFixed(0)}% of total` : ''}
      />
      <StatCard label="High" value={counts.HIGH} accent="text-emerald-300" />
      <StatCard label="Medium" value={counts.MEDIUM} accent="text-amber-300" />
      <StatCard label="Low" value={counts.LOW} accent="text-orange-300" />
      <StatCard
        label="Avg Salary"
        value={avgSalaryMin ? `$${(avgSalaryMin / 1000).toFixed(0)}k` : '—'}
        sublabel={avgSalaryMax ? `→ $${(avgSalaryMax / 1000).toFixed(0)}k` : ''}
      />
    </div>
  );
}
