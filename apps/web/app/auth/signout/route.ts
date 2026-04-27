// Sign out the current user. Both GET (header link) and POST (forms) are
// supported so the UI can use whichever is more convenient.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function handle(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}

export const GET = handle;
export const POST = handle;
