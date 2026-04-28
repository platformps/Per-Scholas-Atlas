// Helper for "bump the active taxonomy with a small mutation" — used by the
// Phase 2B operational-knob admin endpoints (threshold editor, watchlist
// editor). Each user-driven edit creates a new patch-version row in the
// `taxonomies` table and flips the active flag, preserving full history.
//
// Important: the source-of-truth file at packages/taxonomy/schemas/cft.json
// goes out of sync the moment the admin makes a UI edit. The DB is the
// runtime source of truth (the route reads from there). This is documented
// in docs/runbook.md. To reconcile back to git, an operator can pg_dump
// the active row and rebuild the JSON file.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Taxonomy } from '@per-scholas/scoring';

export interface BumpResult {
  oldVersion: string;
  newVersion: string;
  taxonomyId: string;
}

export interface BumpMeta {
  adminId: string;
  adminEmail: string;
  notes: string;
}

/**
 * Apply `mutator` to a deep-copy of the active taxonomy for `roleId`,
 * insert it as a new patch-bumped row with active=true, deactivate the
 * previous active row. Throws on missing active taxonomy or DB errors.
 */
export async function bumpActiveTaxonomy(
  sb: SupabaseClient,
  roleId: string,
  mutator: (schema: Taxonomy) => void,
  meta: BumpMeta,
): Promise<BumpResult> {
  // 1. Fetch current active taxonomy
  const { data: current, error: fetchErr } = await sb
    .from('taxonomies')
    .select('id, version, schema')
    .eq('role_id', roleId)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (fetchErr) throw new Error(`Lookup failed: ${fetchErr.message}`);
  if (!current) throw new Error(`No active taxonomy for role '${roleId}'`);

  const oldVersion = (current as any).version as string;
  const oldSchema = (current as any).schema as Taxonomy;

  // 2. Deep-copy and apply mutation
  const newSchema: Taxonomy = JSON.parse(JSON.stringify(oldSchema));
  mutator(newSchema);
  const newVersion = bumpPatch(oldVersion);
  newSchema.version = newVersion;

  // 3. Deactivate old (the schema's unique-active-per-role index requires
  //    this to happen BEFORE inserting the new active row; otherwise the
  //    insert would conflict.)
  const { error: deactivateErr } = await sb
    .from('taxonomies')
    .update({ active: false })
    .eq('role_id', roleId)
    .eq('active', true);
  if (deactivateErr) throw new Error(`Deactivation failed: ${deactivateErr.message}`);

  // 4. Insert new active
  const { data: inserted, error: insertErr } = await sb
    .from('taxonomies')
    .insert({
      role_id: roleId,
      version: newVersion,
      active: true,
      schema: newSchema,
      notes: meta.notes,
      created_by: meta.adminId,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    // Best effort: re-activate the previous version so we don't leave the
    // role with NO active taxonomy.
    await sb
      .from('taxonomies')
      .update({ active: true })
      .eq('id', (current as any).id);
    throw new Error(`Insert failed: ${insertErr?.message ?? 'unknown'}`);
  }

  return {
    oldVersion,
    newVersion,
    taxonomyId: (inserted as { id: string }).id,
  };
}

// ─── version helper ─────────────────────────────────────────────────────────
function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)?$/.exec(version);
  if (!m) {
    // Non-semver: just append a hash. Defensive.
    return `${version}-edit.${Date.now()}`;
  }
  const major = m[1];
  const minor = m[2];
  const patch = parseInt(m[3]!, 10) + 1;
  return `${major}.${minor}.${patch}`;
}

export const __testing = { bumpPatch };
