// /api/campus-roles
//
// Admin-only writes against the `campus_roles` table. Used by the admin UI
// to activate/deactivate existing pairs and to add new (campus, role)
// combinations to the schedule. The cron continues to pick up active pairs
// automatically — no separate scheduling step needed.
//
//   POST  body { campus_id, role_id, active? }  → create new pair (defaults active=true)
//   PATCH body { campus_id, role_id, active }   → update existing pair (mostly: toggle active)
//
// Soft-delete only — no DELETE method. Pairs that have ever scheduled fetches
// stay in the table for history; deactivation is via PATCH active=false.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PairBody {
  campus_id?: string;
  role_id?: string;
  active?: boolean;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const admin = await requireAdmin();
  const sb = createServiceClient();
  const body = (await request.json().catch(() => ({}))) as PairBody;

  if (!body.campus_id || !body.role_id) {
    return NextResponse.json(
      { error: 'campus_id and role_id are required' },
      { status: 400 },
    );
  }

  // Validate that the campus and role exist
  const [{ data: campus }, { data: role }] = await Promise.all([
    sb.from('campuses').select('id').eq('id', body.campus_id).maybeSingle(),
    sb.from('roles').select('id').eq('id', body.role_id).maybeSingle(),
  ]);
  if (!campus) return NextResponse.json({ error: `campus '${body.campus_id}' not found` }, { status: 404 });
  if (!role) return NextResponse.json({ error: `role '${body.role_id}' not found` }, { status: 404 });

  // Reject duplicate
  const { data: existing } = await sb
    .from('campus_roles')
    .select('campus_id')
    .eq('campus_id', body.campus_id)
    .eq('role_id', body.role_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: `pair (${body.campus_id}, ${body.role_id}) already exists — use PATCH to toggle` },
      { status: 409 },
    );
  }

  const { error } = await sb.from('campus_roles').insert({
    campus_id: body.campus_id,
    role_id: body.role_id,
    active: body.active ?? true,
    notes: body.notes ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('audit_log').insert({
    user_id: admin.id,
    user_email: admin.email,
    action: 'campus_role.create',
    entity_type: 'campus_role',
    entity_id: `${body.campus_id}/${body.role_id}`,
    metadata: { active: body.active ?? true },
  });

  return NextResponse.json({ ok: true, campus_id: body.campus_id, role_id: body.role_id });
}

// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  const sb = createServiceClient();
  const body = (await request.json().catch(() => ({}))) as PairBody;

  if (!body.campus_id || !body.role_id) {
    return NextResponse.json(
      { error: 'campus_id and role_id are required' },
      { status: 400 },
    );
  }
  if (typeof body.active !== 'boolean' && body.notes === undefined) {
    return NextResponse.json(
      { error: 'must include `active` (boolean) or `notes` to update' },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') update.active = body.active;
  if (body.notes !== undefined) update.notes = body.notes;

  const { data: before } = await sb
    .from('campus_roles')
    .select('active, notes')
    .eq('campus_id', body.campus_id)
    .eq('role_id', body.role_id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json(
      { error: `pair (${body.campus_id}, ${body.role_id}) not found — use POST to create` },
      { status: 404 },
    );
  }

  const { error } = await sb
    .from('campus_roles')
    .update(update)
    .eq('campus_id', body.campus_id)
    .eq('role_id', body.role_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('audit_log').insert({
    user_id: admin.id,
    user_email: admin.email,
    action: 'campus_role.update',
    entity_type: 'campus_role',
    entity_id: `${body.campus_id}/${body.role_id}`,
    before,
    after: { ...before, ...update },
    metadata: update,
  });

  return NextResponse.json({ ok: true, ...update });
}
