#!/usr/bin/env node
/**
 * Prove the xid8 commit-order fence's never-skip property against a real
 * Postgres, using real concurrent transactions.
 *
 * The claim `SyncService.getDeltaSyncActions` rests on is:
 *
 *   a transaction that INSERTs its SyncAction early but COMMITs arbitrarily
 *   later can never be skipped by a delta read that runs in between.
 *
 * Unit tests cannot check this. They can assert the shape of the SQL, but the
 * property is about MVCC visibility across concurrent sessions — it only
 * exists when there is a real transaction holding a real xid open.
 *
 * The scenario, which is exactly the one that breaks an id-ordered cursor:
 *
 *   1. session A  BEGIN, INSERT  (takes xid X, does NOT commit)
 *   2. session B  INSERT + COMMIT (takes xid Y > X, lands with a HIGHER id)
 *   3. reader     delta read — must return NEITHER row, and must not advance
 *                 its cursor past A
 *   4. session A  COMMIT
 *   5. reader     delta read — must now return BOTH rows, A's first
 *
 * Step 3 is the whole test. An id-ordered cursor would hand back B (it is
 * committed and visible), advance past B's id, and then never serve A —
 * silently losing that row for every client, permanently.
 *
 * Usage, against a THROWAWAY database:
 *
 *   DATABASE_URL=postgresql://… node scripts/verify-xid8-fence.mjs
 */

import { Client, Pool } from 'pg';

const ORG = '00000000-0000-0000-0000-00000000f001';
// `model_id` is a uuid column, so the two rows need real uuids; this maps them
// back to readable names for the assertions.
const A = '00000000-0000-0000-0000-00000000aaaa';
const B = '00000000-0000-0000-0000-00000000bbbb';
const label = id => (id === A ? 'A-slow' : id === B ? 'B-fast' : id);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    console.log(`      expected ${JSON.stringify(expected)}`);
    console.log(`      actual   ${JSON.stringify(actual)}`);
  }
}

/** The fenced delta read, mirroring SyncService.getDeltaSyncActions. */
async function deltaRead(client, cursor) {
  const { rows } = await client.query(
    `SELECT "id"::text AS id, "xact_id"::text AS xact_id, "model_id"
       FROM "sync_actions"
      WHERE "organization_id" = $1::uuid
        AND "xact_id" < pg_snapshot_xmin(pg_current_snapshot())
        AND ("xact_id" > $2::xid8 OR ("xact_id" = $2::xid8 AND "id" > $3))
      ORDER BY "xact_id" ASC, "id" ASC
      LIMIT 100`,
    [ORG, cursor.xactId, cursor.id],
  );
  return rows;
}

/** An id-ordered read — what the fence replaced. Used to show the bug is real. */
async function naiveRead(client, cursorId) {
  const { rows } = await client.query(
    `SELECT "id"::text AS id, "model_id" FROM "sync_actions"
      WHERE "organization_id" = $1::uuid AND "id" > $2
      ORDER BY "id" ASC LIMIT 100`,
    [ORG, cursorId],
  );
  return rows;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (point it at a throwaway database).');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url });
  const sessionA = new Client({ connectionString: url });
  const sessionB = new Client({ connectionString: url });
  await sessionA.connect();
  await sessionB.connect();

  try {
    await pool.query(
      `INSERT INTO organizations (id, name, url_key, updated_at)
         VALUES ($1, 'Fence', 'fence', now()) ON CONFLICT DO NOTHING`,
      [ORG],
    );
    await pool.query('DELETE FROM sync_actions WHERE organization_id = $1::uuid', [ORG]);

    // Start from the current frontier so pre-existing rows don't pollute the
    // read. Everything this script inserts lands strictly above it.
    const { rows: startRows } = await pool.query(
      `SELECT (pg_snapshot_xmin(pg_current_snapshot())::text::numeric - 1)::text AS x`,
    );
    const cursor = { id: '0', xactId: startRows[0].x };

    // 1. Session A inserts and holds its transaction open.
    await sessionA.query('BEGIN');
    await sessionA.query(
      `INSERT INTO sync_actions (organization_id, action, model_name, model_id, data)
         VALUES ($1::uuid, 'U', 'Issue', $2::uuid, '{}'::jsonb)`,
      [ORG, A],
    );

    // 2. Session B inserts and commits — later xid, higher BIGSERIAL id.
    await sessionB.query('BEGIN');
    await sessionB.query(
      `INSERT INTO sync_actions (organization_id, action, model_name, model_id, data)
         VALUES ($1::uuid, 'U', 'Issue', $2::uuid, '{}'::jsonb)`,
      [ORG, B],
    );
    await sessionB.query('COMMIT');

    // 3. The delta read that runs in the window.
    const during = await deltaRead(pool, cursor);
    check(
      'fenced read returns nothing while A is still in flight',
      during.map(r => label(r.model_id)),
      [],
    );

    // The bug this design exists to prevent, demonstrated on the same data:
    // an id-ordered reader hands back B and would advance its cursor past it.
    const naiveDuring = await naiveRead(pool, '0');
    check(
      'an id-ordered read WOULD have served B (this is the bug being prevented)',
      naiveDuring.map(r => label(r.model_id)),
      ['B-fast'],
    );

    // 4. A commits, out of id order.
    await sessionA.query('COMMIT');

    // 5. Both rows are now delivered, A first — its xid is lower.
    //    A separate connection avoids reusing a snapshot taken before the commit.
    const after = await deltaRead(pool, cursor);
    check(
      'after A commits, both rows are delivered in (xact_id, id) order',
      after.map(r => label(r.model_id)),
      ['A-slow', 'B-fast'],
    );

    // The id order really is inverted, so the ordering above is load-bearing
    // rather than incidentally matching insertion order.
    const idOf = m => after.find(r => label(r.model_id) === m)?.id;
    check(
      "A's BIGSERIAL id is lower than B's, but A committed later",
      Number(idOf('A-slow')) < Number(idOf('B-fast')),
      true,
    );

    // Advancing the cursor to the end of the page and re-reading returns
    // nothing: the cursor is strictly forward and does not re-serve rows.
    const last = after[after.length - 1];
    const drained = await deltaRead(pool, { id: last.id, xactId: last.xact_id });
    check(
      're-reading from the advanced cursor is empty',
      drained.map(r => label(r.model_id)),
      [],
    );

    console.log('');
    if (failures > 0) {
      console.error(`${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log('Fence holds: no row committed out of id order was skipped.');
  } finally {
    await sessionA.end().catch(() => {});
    await sessionB.end().catch(() => {});
    await pool.end();
  }
}

await main();
