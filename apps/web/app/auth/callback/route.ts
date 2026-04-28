// Google OAuth callback. Exchanges the auth code for a session, then
// enforces the @perscholas.org domain gate. Anyone outside the allowed
// domain is signed out and redirected to /login with a clear error.
//
// Defense-in-depth: the Postgres trigger handle_new_user() also rejects
// non-@perscholas.org emails, so even if this check is ever bypassed the
// DB-side will catch it. We do the check here primarily to give the user
// a friendly message instead of a Postgres exception.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const ALLOWED_DOMAIN = 'perscholas.org';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const email = (data.user.email ?? '').toLowerCase();
  const allowed = email.endsWith(`@${ALLOWED_DOMAIN}`);

  if (!allowed) {
    // Sign them out so the bad session doesn't linger, then bounce.
    await supabase.auth.signOut();
    const params = new URLSearchParams({
      error: 'domain_restricted',
      attempted: email,
    });
    return NextResponse.redirect(`${origin}/login?${params.toString()}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
