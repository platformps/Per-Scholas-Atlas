// Rejection breakdown — bar list of *why* jobs are getting filtered out.
// The most common rejection reason is usually "below score threshold"
// (jobs that pass all hard gates but accumulate <30 pts) — that's the
// answer to "why don't more jobs qualify?". Showing this on the dashboard
// turns "the system found nothing" into "here are 19 jobs that came back,
// but they didn't have enough DC-relevant signal to qualify."
//
// Friendly labels normalize the engine's raw rejection_reason strings
// (which can include specific captured phrases like "Description requires
// >3 years experience: '5 to 7 years required'") into stable buckets.

interface RawReason {
  reason: string;
  count: number;
}

interface RejectionBreakdownProps {
  reasons: RawReason[];
  windowDays: number;
}

interface FriendlyBucket {
  label: string;
  hint: string;
  count: number;
  tone: 'gray' | 'amber' | 'orange';
}

const SENTINEL_BELOW_THRESHOLD = '__below_score_threshold__';

/**
 * Map the engine's raw rejection_reason (or the sentinel for null reasons)
 * into a small set of stable, user-readable buckets. Order roughly mirrors
 * the engine's check order, so a "below threshold" rejection is the last-
 * resort outcome rather than an early exclusion.
 */
function bucketFor(reason: string): { label: string; hint: string; tone: 'gray' | 'amber' | 'orange' } {
  if (reason === SENTINEL_BELOW_THRESHOLD) {
    return {
      label: 'Below score threshold',
      hint: 'Job passed every hard filter but accumulated <30 points. Usually means thin DC-relevant skill content.',
      tone: 'gray',
    };
  }
  if (reason.startsWith('Excluded title pattern:')) {
    return {
      label: 'Senior / lead / manager title',
      hint: 'Title contained a seniority keyword (Senior, Lead, Principal, Manager, III, etc.) — out of scope for entry-level CFT graduates.',
      tone: 'orange',
    };
  }
  if (reason.startsWith('Description requires >')) {
    return {
      label: 'Experience requirement too high',
      hint: 'Description says "5+ years required" or similar. Out of reach for new CFT graduates.',
      tone: 'orange',
    };
  }
  if (reason.startsWith('Description disqualifier:')) {
    return {
      label: "Bachelor's / PE / credential required",
      hint: 'Description explicitly requires a credential a CFT graduate does not have.',
      tone: 'orange',
    };
  }
  if (reason.startsWith('Outside ') && reason.includes('mi radius')) {
    return {
      label: 'Outside campus radius',
      hint: 'Job location is beyond the campus commute zone.',
      tone: 'gray',
    };
  }
  if (reason === 'No title tier match') {
    return {
      label: 'Title not in taxonomy',
      hint: 'Job title did not match any Tier A/B/C/D phrase. Could be a taxonomy gap (worth investigating) or a genuinely unrelated role.',
      tone: 'amber',
    };
  }
  if (reason === 'Tier D title without healthcare context') {
    return {
      label: 'Tier D missing healthcare signal',
      hint: 'Stationary / Plant Operations role at a non-healthcare employer with no hospital vocabulary.',
      tone: 'gray',
    };
  }
  if (reason.startsWith('Experience level too high')) {
    return {
      label: 'Experience level (5–10 / 10+)',
      hint: 'AI-classified experience level is above 2–5 years.',
      tone: 'orange',
    };
  }
  // Fallback — surface raw reason
  return { label: reason, hint: '', tone: 'gray' };
}

function aggregateBuckets(reasons: RawReason[]): FriendlyBucket[] {
  const merged = new Map<string, FriendlyBucket>();
  for (const { reason, count } of reasons) {
    const b = bucketFor(reason);
    const key = b.label;
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
    } else {
      merged.set(key, { label: b.label, hint: b.hint, count, tone: b.tone });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.count - a.count);
}

export function RejectionBreakdown({ reasons, windowDays }: RejectionBreakdownProps) {
  const buckets = aggregateBuckets(reasons);
  const total = buckets.reduce((acc, b) => acc + b.count, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-md p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-night">Why jobs were filtered</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Last {windowDays} days · grouped by reason
          </p>
        </div>
        {total > 0 && (
          <div className="text-xs text-gray-400">{total} rejected</div>
        )}
      </div>

      {buckets.length === 0 ? (
        <div className="text-sm text-gray-400 py-4 text-center">
          No rejections in this window.
        </div>
      ) : (
        <ul className="space-y-3">
          {buckets.map(b => {
            const pct = total ? (b.count / total) * 100 : 0;
            const barColor =
              b.tone === 'orange' ? 'bg-orange/60' :
              b.tone === 'amber'  ? 'bg-yellow/70' :
                                     'bg-cloud';
            return (
              <li key={b.label}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm text-gray-800">{b.label}</span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {b.count}
                    <span className="text-gray-400 ml-1.5">
                      · {Math.round(pct)}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-sm overflow-hidden">
                  <div
                    className={`h-full ${barColor}`}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </div>
                {b.hint && (
                  <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{b.hint}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export type { RawReason };
