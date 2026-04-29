'use client';

// Pin / unpin the current campus as the user's home campus.
//
// Posts to PATCH /api/me/home-campus. After success, refreshes the page so
// the redirect-on-/ logic and any banner UI pick up the new state.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/button';

interface Props {
  campusId: string;
  campusName: string;
  /** Current pinned campus id (from session). Drives the button label. */
  pinnedCampusId: string | null;
}

export function PinCampusButton({ campusId, campusName, pinnedCampusId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isPinned = pinnedCampusId === campusId;
  const someoneElsePinned = pinnedCampusId && pinnedCampusId !== campusId;

  function update(nextValue: string | null) {
    setError(null);
    startTransition(async () => {
      const r = await fetch('/api/me/home-campus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campus_id: nextValue }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Failed (${r.status})`);
        return;
      }
      router.refresh();
    });
  }

  if (isPinned) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-royal font-medium">★ Pinned as your campus</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => update(null)}
          loading={pending}
          title="Stop auto-anchoring on this campus"
        >
          Unpin
        </Button>
        {error && <span className="text-xs text-orange">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => update(campusId)}
        loading={pending}
        title={
          someoneElsePinned
            ? 'Replaces your current pinned campus'
            : `Auto-anchor on ${campusName} on every visit`
        }
      >
        ★ Pin {campusName}
      </Button>
      {error && <span className="text-xs text-orange">{error}</span>}
    </div>
  );
}
