#!/usr/bin/env node
/**
 * Assert that the hand-written migration actually applied, against a real
 * Postgres.
 *
 * `prisma migrate diff` cannot do this. It compares the database against
 * `schema.prisma`, and everything in
 * `00000000000001_custom_constraints_and_triggers` is by definition something
 * the Prisma DSL cannot express — partial indexes, an expression index, a GIN
 * FTS index, and `NOT NULL` on `String[]` columns. A no-op custom migration
 * passes `migrate diff` cleanly while leaving the database missing every
 * object that makes the hot paths fast and the invariants hold.
 *
 * Two traps this encodes so they are not re-derived each time:
 *
 *   1. The `information_schema.columns` query MUST be scoped to the `public`
 *      schema. Without it, pg_catalog's own NOT NULL array columns swamp the
 *      result and the check silently passes on garbage.
 *   2. There are no user triggers any more. The only one this project ever
 *      had (`set_sync_action_committed_at`) was removed when the xid8
 *      commit-order fence replaced `committed_at` with `xact_id`. An empty
 *      `pg_trigger` result is therefore CORRECT, and is no longer evidence
 *      that the custom migration failed to apply — use the index check for
 *      that.
 *
 * Usage, against a THROWAWAY database that has had `prisma migrate deploy`
 * run against it:
 *
 *   DATABASE_URL=postgresql://… node scripts/verify-schema.mjs
 *
 * See docs/DATABASE_SCHEMA.md for the full recipe this is the last step of,
 * including the one `DROP INDEX` statement `migrate diff` is expected to emit
 * and which must never be applied.
 */

import { Client } from 'pg';

/** Every index the custom migration creates, from its CREATE INDEX statements. */
const EXPECTED_INDEXES = [
  'auth_tokens_token_hash_magic_link_idx',
  'auth_tokens_token_hash_refresh_key',
  'idx_issues_fts',
  'issues_team_id_state_id_active_idx',
  'sync_actions_organization_id_xact_id_id_idx',
  'teams_organization_id_key_key',
];

/** `String[]` columns the custom migration re-asserts NOT NULL on. */
const EXPECTED_NOT_NULL_ARRAYS = ['auth_tokens.scopes', 'webhooks.events'];

const problems = [];

function compare(label, actual, expected) {
  const missing = expected.filter(e => !actual.includes(e));
  const extra = actual.filter(a => !expected.includes(a));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`  ✓ ${label}: ${actual.length}/${expected.length}`);
    return;
  }
  console.log(`  ✗ ${label}`);
  if (missing.length) {
    console.log(`      missing: ${missing.join(', ')}`);
    problems.push(`${label} missing ${missing.join(', ')}`);
  }
  // Extras are reported but are not a failure on their own — a later migration
  // may legitimately add an index this script has not been taught about.
  if (extra.length) {
    console.log(`      unexpected (not a failure — teach this script): ${extra.join(', ')}`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (point it at a throwaway database).');
    process.exit(2);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    console.log('Custom migration objects:');

    // Partial/expression indexes plus the two named ones. Prisma models none
    // of these, so `migrate diff` is blind to all of them.
    const { rows: idx } = await client.query(
      `
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND (indexdef ILIKE '%WHERE%' OR indexname IN ($1, $2))
       ORDER BY 1
    `,
      ['sync_actions_organization_id_xact_id_id_idx', 'idx_issues_fts'],
    );
    compare(
      'indexes',
      idx.map(r => r.indexname),
      EXPECTED_INDEXES,
    );

    // Prisma 7 drops NOT NULL on String[] when the baseline is regenerated,
    // so the custom migration puts it back. Scoping to `public` is load-bearing.
    const { rows: arr } = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND is_nullable = 'NO' AND data_type = 'ARRAY'
       ORDER BY 1, 2
    `);
    compare(
      'String[] NOT NULL',
      arr.map(r => `${r.table_name}.${r.column_name}`),
      EXPECTED_NOT_NULL_ARRAYS,
    );

    // Informational: zero is the correct answer. Printed so that a future
    // migration adding a trigger is visible rather than silently unverified.
    const { rows: trg } = await client.query(
      'SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1',
    );
    console.log(
      `  · user triggers: ${trg.length === 0 ? 'none (correct)' : trg.map(r => r.tgname).join(', ')}`,
    );
  } finally {
    await client.end();
  }

  if (problems.length > 0) {
    console.error(`\nFAIL — the custom migration did not fully apply:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nOK — every object the custom migration creates is present.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
