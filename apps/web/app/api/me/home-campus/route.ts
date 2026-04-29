// PATCH /api/me/home-campus
//
// Sets or clears the current user's home campus preference. Body:
//   { campus_id: "newark" }  → pin Newark
//   { campus_id: null }      → clear pin (back to all-campus aggregate default)
//
// Self-update only — uses the user's own RLS-enabled session client, no
// service role needed. The users table has an RLS policy allowing each user
// to update their own row.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  campus_id: string | null;
}

export async function PATCH(request: Request) {
  const user = await requireUser();
  const body = (await request.json().catch(() => ({}))) as Partial<Body>;

  // Coerce: empty string and undefined → null (unpin)
  const campusId =
    typeof body.campus_id === 'string' && body.campus_id.length > 0
      ? body.campus_id
      : null;

  // Validate the campus exists if non-null. Cheap belt-and-suspenders on top
  // of the FK constraint — gives a friendlier 400 than a Postgres FK error.
  if (campusId) {
    const sb = createClient();
    const { data: campus } = await sb
      .from('campuses')
      .select('id')
      .eq('id', campusId)
      .maybeSingle();
    if (!campus) {
      return NextResponse.json({ error: 'Campus not found' }, { status: 400 });
    }
  }

  const sb = createClient();
  const { error } = await sb
    .from('users')
    .update({ home_campus_id: campusId })
    .eq('id', user.id);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? 'Failed to update home campus' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, home_campus_id: campusId });
}
