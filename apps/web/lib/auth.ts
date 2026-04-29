import { createClient } from './supabase-server';
import { redirect } from 'next/navigation';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'viewer';
  /** Pinned campus id. When set, the homepage auto-anchors on this
   *  campus on every visit (`/` with no params → `/?campus=<id>`). */
  homeCampusId: string | null;
}

/**
 * Get the current authenticated user with their app role.
 * Returns null if not authenticated.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('id, email, full_name, role, home_campus_id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return {
      id: user.id,
      email: user.email ?? '',
      fullName: null,
      role: 'viewer',
      homeCampusId: null,
    };
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    homeCampusId: (profile as { home_campus_id?: string | null }).home_campus_id ?? null,
  };
}

/**
 * Require an authenticated user. Redirects to /login if not.
 *
 * @param redirectAfter — optional path the user should land on after a
 *   successful sign-in. Encoded into ?next=… on the /login URL so the
 *   sign-in flow can carry it through the OAuth round-trip and the
 *   /auth/callback handler can route them back. Pass it from each page
 *   so deep links (e.g. someone shares /faq) survive the login bounce.
 */
export async function requireUser(redirectAfter?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = redirectAfter
      ? `/login?next=${encodeURIComponent(redirectAfter)}`
      : '/login';
    redirect(target);
  }
  return user;
}

/**
 * Require an admin user. Redirects to / if authenticated but not admin,
 * to /login (preserving the next path) if not authenticated at all.
 */
export async function requireAdmin(redirectAfter?: string): Promise<SessionUser> {
  const user = await requireUser(redirectAfter);
  if (user.role !== 'admin') redirect('/');
  return user;
}
