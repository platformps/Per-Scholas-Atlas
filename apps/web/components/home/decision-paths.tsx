'use client';

// "Choose your path" CTA cards on the aggregate landing. Two equal-weight
// options — Explore by Role and Explore by Campus — each with an inline
// dropdown that submits to the homepage with the appropriate filter.
//
// We use this UX (vs. forcing a single dropdown) because Managing Directors
// approach this dashboard from two different angles:
//   • "What's happening with role X across all campuses?" → role-first
//   • "What's happening at my campus?" → campus-first
// The two cards make those two paths first-class and equally discoverable.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

interface Option {
  id: string;
  name: string;
}

interface DecisionPathsProps {
  campuses: Option[];
  roles: Option[];
}

export function DecisionPaths({ campuses, roles }: DecisionPathsProps) {
  return (
    <section aria-label="Choose an exploration path">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-night">How would you like to explore?</h2>
        <span className="text-xs text-gray-500">Pick one to start, or browse the overview below</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PathCard
          tone="role"
          eyebrow="Path A · Role first"
          title="Explore by role"
          description="See how a role performs across every Per Scholas campus. Compare volume, employer pool, and signal strength."
          actionLabel="Explore role"
          options={roles}
          paramKey="role"
          placeholder="Select a role…"
        />
        <PathCard
          tone="campus"
          eyebrow="Path B · Campus first"
          title="Explore by campus"
          description="Anchor on a campus and see which roles are strongest in that local labor market — your home-base view."
          actionLabel="Explore campus"
          options={campuses}
          paramKey="campus"
          placeholder="Select a campus…"
        />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function PathCard({
  tone,
  eyebrow,
  title,
  description,
  actionLabel,
  options,
  paramKey,
  placeholder,
}: {
  tone: 'role' | 'campus';
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  options: Option[];
  paramKey: 'role' | 'campus';
  placeholder: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState('');

  const accent =
    tone === 'role'
      ? { dot: 'bg-royal', eyebrow: 'text-royal' }
      : { dot: 'bg-ocean', eyebrow: 'text-ocean' };

  function go() {
    if (!selected) return;
    router.push(`/?${paramKey}=${encodeURIComponent(selected)}`);
  }

  return (
    <Card>
      <div className="p-5 sm:p-6 flex flex-col gap-4 h-full">
        <div className="flex items-center gap-2">
          <span className={`block w-2 h-2 rounded-sm ${accent.dot}`} aria-hidden />
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${accent.eyebrow}`}>
            {eyebrow}
          </span>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-night leading-tight">{title}</h3>
          <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{description}</p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2 items-stretch">
          <select
            aria-label={placeholder}
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="flex-1 min-w-[180px] border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white text-night focus:outline-none focus:ring-2 focus:ring-royal/30 focus:border-royal transition-colors duration-150"
          >
            <option value="">{placeholder}</option>
            {options.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <Button variant="primary" size="md" onClick={go} disabled={!selected}>
            {actionLabel} →
          </Button>
        </div>
      </div>
    </Card>
  );
}
