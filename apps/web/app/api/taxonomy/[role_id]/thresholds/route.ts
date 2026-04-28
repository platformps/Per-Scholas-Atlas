// PATCH /api/taxonomy/:role_id/thresholds
//
// Admin-only. Replaces the active taxonomy's `scoring.thresholds` block with
// the supplied values, bumping the active version by one patch increment.
// Body: { high: number, medium: number, low: number }
// Constraint: 0 ≤ low < medium < high ≤ 100.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';
import { bumpActiveTaxonomy } from '@/lib/taxonomy-edit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ThresholdBody {
  high?: number;
  medium?: number;
  low?: number;
}

export async function PATCH(
  request: Request,
  { params }: { params: { role_id: string } },
) {
  const admin = await requireAdmin();
  const sb = createServiceClient();
  const body = (await request.json().catch(() => ({}))) as ThresholdBody;

  const { high, medium, low } = body;
  if (typeof high !== 'number' || typeof medium !== 'number' || typeof low !== 'number') {
    return NextResponse.json(
      { error: 'high, medium, and low must all be numbers' },
      { status: 400 },
    );
  }
  if (!(low >= 0 && low < medium && medium < high && high <= 100)) {
    return NextResponse.json(
      { error: 'must satisfy 0 <= low < medium < high <= 100' },
      { status: 400 },
    );
  }

  try {
    const result = await bumpActiveTaxonomy(
      sb,
      params.role_id,
      schema => {
        schema.scoring.thresholds = { high, medium, low };
      },
      {
        adminId: admin.id,
        adminEmail: admin.email,
        notes: `Score thresholds updated via admin UI: HIGH=${high}, MEDIUM=${medium}, LOW=${low}.`,
      },
    );

    await sb.from('audit_log').insert({
      user_id: admin.id,
      user_email: admin.email,
      action: 'taxonomy.thresholds.update',
      entity_type: 'taxonomy',
      entity_id: result.taxonomyId,
      metadata: {
        role_id: params.role_id,
        old_version: result.oldVersion,
        new_version: result.newVersion,
        thresholds: { high, medium, low },
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
