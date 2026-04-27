import { createClient } from './supabase-server';
import { redirect } from 'next/navigation';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'viewer';
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
    .select('id, email, full_name, role')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return {
      id: user.id,
      email: user.email ?? '',
      fullName: null,
      role: 'viewer',
    };
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
  };
}

/**
 * Require an authenticated user. Redirects to /login if not.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Require an admin user. Redirects to / if authenticated but not admin,
 * to /login if not authenticated at all.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/');
  return user;
}
