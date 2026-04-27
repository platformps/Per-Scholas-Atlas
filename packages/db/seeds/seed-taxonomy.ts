/**
 * Seeds taxonomy versions into the database from packages/taxonomy/schemas/*.json
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx packages/db/seeds/seed-taxonomy.ts
 *
 * Idempotent: skips if (role_id, version) already exists.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, '..', '..', 'taxonomy', 'schemas');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

async function main() {
  const files = readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} taxonomy schema(s) to process.`);

  for (const file of files) {
    const path = join(SCHEMAS_DIR, file);
    const raw = readFileSync(path, 'utf-8');
    const schema = JSON.parse(raw);
    const { role_id, version } = schema;

    if (!role_id || !version) {
      console.error(`Skipping ${file}: missing role_id or version`);
      continue;
    }

    // Check if role exists
    const roleCheck = await sql`SELECT id FROM roles WHERE id = ${role_id}`;
    if (roleCheck.length === 0) {
      console.error(`Skipping ${file}: role '${role_id}' not found in roles table. Run db:seed first.`);
      continue;
    }

    // §B4 (v1.1.0): employer_watchlist.categories changed from
    //   Record<string, string[]>  →  Record<string, {is_healthcare, employers}>.
    // Soft-validate so an operator gets a clear warning if a stale-shape file
    // is fed in — the scoring engine assumes the v1.1.0 shape.
    const cats = schema?.employer_watchlist?.categories;
    if (cats && typeof cats === 'object') {
      for (const [name, value] of Object.entries(cats)) {
        const v11 =
          value !== null &&
          typeof value === 'object' &&
          Array.isArray((value as any).employers) &&
          typeof (value as any).is_healthcare === 'boolean';
        const v10 = Array.isArray(value);
        if (!v11 && !v10) {
          console.warn(`  ⚠ ${file}: employer_watchlist.categories.${name} has unrecognized shape (expected v1.1.0 object or v1.0.0 array).`);
        } else if (v10) {
          console.warn(`  ⚠ ${file}: employer_watchlist.categories.${name} uses the v1.0.0 array shape; scoring engine expects v1.1.0 {is_healthcare, employers}. Bump the schema before seeding to avoid runtime errors.`);
        }
      }
    }

    // Check if this version already exists
    const existing = await sql`
      SELECT id FROM taxonomies WHERE role_id = ${role_id} AND version = ${version}
    `;

    if (existing.length > 0) {
      console.log(`✓ ${file} (${role_id} v${version}) already in database; skipping.`);
      continue;
    }

    // Deactivate previous active taxonomy for this role
    await sql`
      UPDATE taxonomies SET active = FALSE WHERE role_id = ${role_id} AND active = TRUE
    `;

    // Insert new taxonomy as active
    await sql`
      INSERT INTO taxonomies (role_id, version, active, schema, notes)
      VALUES (
        ${role_id},
        ${version},
        TRUE,
        ${sql.json(schema)},
        ${schema.version_notes ?? null}
      )
    `;
    console.log(`✓ Seeded ${file} (${role_id} v${version}) as ACTIVE.`);
  }

  await sql.end();
  console.log('Done.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
