// GET /api/campuses
//
// Lightweight read-only endpoint returning the active campus list. Used by
// the user-menu dropdown to populate its home-campus picker without
// threading the campus list through every page that renders the header.
//
// RLS already permits authenticated reads of public.campuses, so the
// session client is sufficient — no service role needed.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await requireUser();
  const sb = createClient();
  const { data, error } = await sb
    .from('campuses')
    .select('id, name, state, active')
    .eq('active', true)
    .order('name');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ campuses: data ?? [] });
}
