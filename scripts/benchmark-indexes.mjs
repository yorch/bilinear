#!/usr/bin/env node
/**
 * Verify that each hot-path index is actually chosen by the planner for the
 * query it was added to serve.
 *
 * The DB-hardening pass added these as "additive, needs an EXPLAIN ANALYZE
 * benchmark before deploy" and that benchmark never ran. An unused index is not
 * neutral: it costs write amplification on every insert and update, plus bloat,
 * for no read benefit. This says which ones earn their keep.
 *
 * The data distribution matters more than the row count. A first cut of this
 * script put all 100k issues on one team, which made the team-scoped partial
 * index look broken — a sequential scan is genuinely the right plan when the
 * predicate matches every row. The shape below spreads issues over several
 * teams, states and assignees so each index faces a selective predicate, which
 * is the only condition under which the result means anything.
 *
 * Usage — against a THROWAWAY database, since it writes ~350k rows:
 *
 *   docker run -d --name bench -e POSTGRES_PASSWORD=b -e POSTGRES_DB=bench \
 *     -p 55440:5432 public.ecr.aws/docker/library/postgres:17-alpine
 *   DATABASE_URL=postgresql://postgres:b@localhost:55440/bench yarn prisma migrate deploy
 *   DATABASE_URL=postgresql://postgres:b@localhost:55440/bench node scripts/benchmark-indexes.mjs
 *
 * Exits non-zero if any query sequentially scans its target table.
 */

import { Pool } from 'pg';

const ORG = '00000000-0000-0000-0000-0000000000a1';
const TEAMS = 8;
const STATES_PER_TEAM = 6;
const USERS = 20;
const PROJECTS = 40;
const ISSUE_COUNT = 100_000;
const NOTIFICATION_COUNT = 50_000;
const SYNC_ACTION_COUNT = 200_000;

const uuid = (prefix, n) => `00000000-0000-0000-0000-${prefix}${String(n).padStart(8, '0')}`;
const teamId = n => uuid('0001', n);
const stateId = n => uuid('0002', n);
const userId = n => uuid('0003', n);
const projectId = n => uuid('0004', n);

async function seed(pool) {
  process.stdout.write('seeding… ');
  // One statement per call: Postgres rejects multiple commands in a prepared
  // (parameterized) statement.
  await pool.query(
    `INSERT INTO organizations (id, name, url_key, updated_at)
       VALUES ($1, 'Bench', 'bench', now()) ON CONFLICT DO NOTHING`,
    [ORG],
  );

  for (let u = 0; u < USERS; u++) {
    await pool.query(
      `INSERT INTO users (id, email, name, display_name, initials, updated_at)
         VALUES ($1, $2, 'Bench', 'Bench', 'B', now()) ON CONFLICT DO NOTHING`,
      [userId(u), `bench${u}@example.com`],
    );
  }
  for (let t = 0; t < TEAMS; t++) {
    await pool.query(
      `INSERT INTO teams (id, organization_id, name, display_name, key, updated_at)
         VALUES ($1, $2, $3, $3, $4, now()) ON CONFLICT DO NOTHING`,
      [teamId(t), ORG, `Team ${t}`, `T${t}`],
    );
    for (let s = 0; s < STATES_PER_TEAM; s++) {
      await pool.query(
        `INSERT INTO workflow_states (id, team_id, name, type, color, position, updated_at)
           VALUES ($1, $2, $3, $4, '#ffffff', $5, now()) ON CONFLICT DO NOTHING`,
        [
          stateId(t * STATES_PER_TEAM + s),
          teamId(t),
          `State ${s}`,
          ['backlog', 'unstarted', 'started', 'started', 'completed', 'canceled'][s],
          s,
        ],
      );
    }
  }
  for (let p = 0; p < PROJECTS; p++) {
    await pool.query(
      `INSERT INTO projects (id, organization_id, name, slug_id, updated_at)
         VALUES ($1, $2, $3, $4, now()) ON CONFLICT DO NOTHING`,
      [projectId(p), ORG, `Project ${p}`, `proj-${p}`],
    );
  }

  // Spread across teams/states/assignees, with a realistic long tail of
  // archived and trashed rows so the partial index has something to exclude.
  await pool.query(
    `INSERT INTO issues (
        id, organization_id, team_id, project_id, number, identifier, title,
        state_id, assignee_id, archived_at, trashed, created_at, updated_at,
        sort_order, priority_sort_order)
      SELECT gen_random_uuid(), $1,
             ('00000000-0000-0000-0000-0001' || lpad(((i % $2))::text, 8, '0'))::uuid,
             CASE WHEN i % 3 = 0
                  THEN ('00000000-0000-0000-0000-0004' || lpad(((i % $5))::text, 8, '0'))::uuid
                  ELSE NULL END,
             i, 'BEN-' || i, 'Issue ' || i,
             ('00000000-0000-0000-0000-0002'
               || lpad((((i % $2) * $3) + (i % $3))::text, 8, '0'))::uuid,
             CASE WHEN i % 5 <> 0
                  THEN ('00000000-0000-0000-0000-0003' || lpad(((i % $4))::text, 8, '0'))::uuid
                  ELSE NULL END,
             CASE WHEN i % 12 = 0 THEN now() ELSE NULL END,
             (i % 25 = 0),
             now() - (i || ' minutes')::interval,
             now() - (i || ' minutes')::interval,
             i, i
        FROM generate_series(1, $6) AS i`,
    [ORG, TEAMS, STATES_PER_TEAM, USERS, PROJECTS, ISSUE_COUNT],
  );

  await pool.query(
    `INSERT INTO notifications (id, organization_id, user_id, type, read, snoozed_until_at, created_at, updated_at)
      SELECT gen_random_uuid(), $1,
             ('00000000-0000-0000-0000-0003' || lpad(((i % $2))::text, 8, '0'))::uuid,
             'ISSUE_ASSIGNED',
             (i % 5 <> 0),
             CASE WHEN i % 50 = 0 THEN now() + interval '1 day' ELSE NULL END,
             now() - (i || ' minutes')::interval,
             now()
        FROM generate_series(1, $3) AS i`,
    [ORG, USERS, NOTIFICATION_COUNT],
  );

  await pool.query(
    `INSERT INTO sync_actions (organization_id, action, model_name, model_id, data, created_at)
      SELECT $1, 'U',
             CASE WHEN i % 3 = 0 THEN 'Project' ELSE 'Issue' END,
             gen_random_uuid(), '{}'::jsonb, now() - (i || ' seconds')::interval
        FROM generate_series(1, $2) AS i`,
    [ORG, SYNC_ACTION_COUNT],
  );

  for (const table of ['issues', 'notifications', 'sync_actions']) {
    await pool.query(`ANALYZE ${table}`);
  }
  console.log('done');
}

/** Each case names the index it should exercise and the table that must not be seq-scanned. */
const CASES = [
  {
    index: 'notifications_user_id_read_created_at_idx',
    name: 'unread count (NotificationService.getUnreadCount)',
    params: [userId(1), ORG],
    sql: `SELECT count(*) FROM notifications
           WHERE user_id = $1 AND organization_id = $2 AND read = false
             AND (snoozed_until_at IS NULL OR snoozed_until_at <= now())`,
    table: 'notifications',
  },
  {
    index: 'notifications_user_id_created_at_idx',
    name: 'inbox feed (NotificationService.findByUserId)',
    params: [userId(1), ORG],
    sql: `SELECT * FROM notifications
           WHERE user_id = $1 AND organization_id = $2
             AND (snoozed_until_at IS NULL OR snoozed_until_at <= now())
           ORDER BY created_at DESC LIMIT 50`,
    table: 'notifications',
  },
  {
    index: 'issues_organization_id_updated_at_idx',
    name: 'org-wide recently updated',
    params: [ORG],
    sql: `SELECT * FROM issues WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 50`,
    table: 'issues',
  },
  {
    index: 'issues_assignee_id_state_id_idx',
    name: 'my issues in a state',
    params: [userId(1), stateId(1 * STATES_PER_TEAM + 1)],
    sql: `SELECT * FROM issues WHERE assignee_id = $1 AND state_id = $2`,
    table: 'issues',
  },
  {
    index: 'issues_project_id_archived_at_trashed_idx',
    name: 'project progress groupBy (ProjectService.getProgressBatch)',
    params: [[projectId(1), projectId(2), projectId(3)]],
    sql: `SELECT project_id, count(*) FROM issues
           WHERE project_id = ANY($1::uuid[]) AND archived_at IS NULL AND trashed = false
           GROUP BY project_id`,
    table: 'issues',
  },
  {
    index: 'issues_team_id_state_id_active_idx',
    name: 'team live set (partial index)',
    params: [teamId(1), stateId(1 * STATES_PER_TEAM + 2)],
    sql: `SELECT * FROM issues
           WHERE team_id = $1 AND state_id = $2 AND archived_at IS NULL AND trashed = false`,
    table: 'issues',
  },
  {
    index: 'sync_actions_organization_id_model_name_model_id_idx',
    name: 'sync action lookup by model',
    params: [ORG, 'Issue', '00000000-0000-0000-0000-000000009999'],
    sql: `SELECT * FROM sync_actions
           WHERE organization_id = $1 AND model_name = $2 AND model_id = $3`,
    table: 'sync_actions',
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (point it at a throwaway database).');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });

  try {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM issues');
    if (rows[0].n === 0) {
      await seed(pool);
    } else {
      console.log(`reusing existing dataset (${rows[0].n} issues)`);
    }

    let seqScans = 0;
    const notes = [];
    console.log('');
    for (const c of CASES) {
      const explain = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${c.sql}`, c.params);
      const plan = explain.rows.map(r => r['QUERY PLAN']).join('\n');
      const usedIndex = plan.includes(c.index);
      const seqScan = new RegExp(`Seq Scan on ${c.table}\\b`).test(plan);
      const ms = plan.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? '?';

      const status = seqScan ? 'SEQ SCAN' : usedIndex ? 'ok' : 'other index';
      if (seqScan) {
        seqScans += 1;
      }
      if (!usedIndex) {
        notes.push({ index: c.index, name: c.name, plan });
      }
      console.log(`${status.padEnd(11)} ${String(ms).padStart(9)} ms  ${c.name}`);
      console.log(`${' '.repeat(12)}${c.index}`);
      console.log('');
    }

    for (const n of notes) {
      console.log(`--- ${n.index} was not chosen for "${n.name}":`);
      console.log(
        n.plan
          .split('\n')
          .filter(l => /Scan|Sort|Aggregate|Filter/.test(l))
          .map(l => `    ${l.trim()}`)
          .join('\n'),
      );
      console.log('');
    }

    if (seqScans > 0) {
      console.error(`${seqScans} query/queries sequentially scanned their table.`);
      process.exit(1);
    }
    console.log('No hot-path query falls back to a sequential scan.');
  } finally {
    await pool.end();
  }
}

await main();
