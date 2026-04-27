// Auth helpers for /api/fetch-jobs and /api/rescore.
//
// Two valid callers:
//   1. GitHub Actions cron — sends `Authorization: Bearer <CRON_SECRET>`.
//      We compare via crypto.timingSafeEqual to avoid timing-side-channel
//      leaks (BRIEF §13: "Use crypto.timingSafeEqual not === to avoid
//      timing-attack leaks").
//   2. Logged-in admin user — verified via Supabase session + users.role check.
//
// Both helpers return a typed "auth result" so callers can record who/what
// triggered the run on the fetch_runs row.

import { timingSafeEqual } from 'node:crypto';
import { getCurrentUser, type SessionUser } from './auth';

export type AuthResult =
  | { kind: 'cron' }
  | { kind: 'admin'; user: SessionUser }
  | { kind: 'unauthorized'; reason: string };

/**
 * Constant-time comparison for two hex/ascii strings of arbitrary length.
 * Strings of different lengths return false in constant time WRT the longer
 * input (we pad to equal length before comparison so length itself isn't a
 * timing oracle).
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  // Buffer.from is ascii-only here; CRON_SECRET is a hex/random ascii token.
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Pad the shorter buffer so timingSafeEqual doesn't throw and we don't leak
  // length via early-return. We still XOR the length comparison into the result.
  const len = Math.max(ab.length, bb.length);
  const ap = Buffer.alloc(len);
  const bp = Buffer.alloc(len);
  ab.copy(ap);
  bb.copy(bp);
  const lengthsMatch = ab.length === bb.length;
  return timingSafeEqual(ap, bp) && lengthsMatch;
}

/**
 * Verify the request was sent by either the cron worker (CRON_SECRET) or a
 * logged-in admin. Returns a discriminated union; never throws.
 */
export async function authorizeAdminOrCron(request: Request): Promise<AuthResult> {
  // Cron path — Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const provided = auth.slice('Bearer '.length).trim();
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return { kind: 'unauthorized', reason: 'CRON_SECRET not configured on server' };
    }
    if (timingSafeStringEqual(provided, expected)) {
      return { kind: 'cron' };
    }
    return { kind: 'unauthorized', reason: 'Bad bearer token' };
  }

  // Admin path — session cookie
  const user = await getCurrentUser();
  if (!user) return { kind: 'unauthorized', reason: 'Not signed in' };
  if (user.role !== 'admin') return { kind: 'unauthorized', reason: 'Not an admin' };
  return { kind: 'admin', user };
}
