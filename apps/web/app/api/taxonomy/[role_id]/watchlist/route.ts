// PATCH /api/taxonomy/:role_id/watchlist
//
// Admin-only. Replaces the entire `employer_watchlist.categories` block of
// the active taxonomy and bumps to a new patch version. Body shape mirrors
// the schema:
//
//   {
//     "weight_per_match": 5,
//     "categories": {
//       "<category_name>": { "is_healthcare": false, "employers": ["microsoft", ...] },
//       ...
//     }
//   }
//
// Validation: every category must have boolean is_healthcare and string-array
// employers. Empty categories are allowed but get filtered out before save
// to keep the JSON tidy.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { requireAdmin } from '@/lib/auth';
import { bumpActiveTaxonomy } from '@/lib/taxonomy-edit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CategoryShape {
  is_healthcare?: unknown;
  employers?: unknown;
}

interface WatchlistBody {
  weight_per_match?: unknown;
  categories?: Record<string, CategoryShape>;
}

export async function PATCH(
  request: Request,
  { params }: { params: { role_id: string } },
) {
  const admin = await requireAdmin();
  const sb = createServiceClient();
  const body = (await request.json().catch(() => ({}))) as WatchlistBody;

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const weight = body.weight_per_match;
  if (typeof weight !== 'number' || weight < 0 || weight > 50) {
    return NextResponse.json({ error: 'weight_per_match must be a number 0..50' }, { status: 400 });
  }
  if (!body.categories || typeof body.categories !== 'object') {
    return NextResponse.json({ error: 'categories must be an object' }, { status: 400 });
  }

  // Validate + normalize categories
  const cleaned: Record<string, { is_healthcare: boolean; employers: string[] }> = {};
  for (const [name, raw] of Object.entries(body.categories)) {
    if (!name || /[^a-z0-9_]/i.test(name)) {
      return NextResponse.json(
        { error: `category name "${name}" must be alphanumeric/underscore only` },
        { status: 400 },
      );
    }
    if (typeof raw.is_healthcare !== 'boolean') {
      return NextResponse.json(
        { error: `category "${name}": is_healthcare must be boolean` },
        { status: 400 },
      );
    }
    if (!Array.isArray(raw.employers)) {
      return NextResponse.json(
        { error: `category "${name}": employers must be an array` },
        { status: 400 },
      );
    }
    const employers: string[] = [];
    const seen = new Set<string>();
    for (const e of raw.employers) {
      if (typeof e !== 'string') continue;
      const trimmed = e.trim().toLowerCase();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      employers.push(trimmed);
    }
    if (employers.length > 0) {
      cleaned[name] = { is_healthcare: raw.is_healthcare, employers };
    }
  }

  try {
    const result = await bumpActiveTaxonomy(
      sb,
      params.role_id,
      schema => {
        schema.employer_watchlist = {
          weight_per_match: weight,
          categories: cleaned,
        };
      },
      {
        adminId: admin.id,
        adminEmail: admin.email,
        notes:
          `Employer watchlist updated via admin UI. ` +
          `${Object.keys(cleaned).length} categories, ` +
          `${Object.values(cleaned).reduce((acc, c) => acc + c.employers.length, 0)} total employers.`,
      },
    );

    await sb.from('audit_log').insert({
      user_id: admin.id,
      user_email: admin.email,
      action: 'taxonomy.watchlist.update',
      entity_type: 'taxonomy',
      entity_id: result.taxonomyId,
      metadata: {
        role_id: params.role_id,
        old_version: result.oldVersion,
        new_version: result.newVersion,
        category_count: Object.keys(cleaned).length,
        employer_count: Object.values(cleaned).reduce((acc, c) => acc + c.employers.length, 0),
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
