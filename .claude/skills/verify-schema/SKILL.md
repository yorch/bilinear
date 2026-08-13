---
name: verify-schema
description: Verify a Prisma schema or migration change against a real PostgreSQL before merging. Use whenever prisma/schema.prisma or anything under prisma/migrations/ changes, or when asked to check for schema drift, confirm migrations apply, or validate that custom SQL (partial indexes, FTS, String[] NOT NULL) actually landed. Covers the trap that `prisma migrate diff` alone cannot detect a no-op custom migration.
---

# Verifying a schema change

`yarn test` cannot check any of this — it mocks Prisma. The properties here only
exist against a real database.

## When to run this

Any change to `prisma/schema.prisma` or `prisma/migrations/**`. Also before
deploying, since none of it is covered by CI.

## The policy that governs where a change goes

Nothing is deployed yet, so **anything the Prisma DSL can express belongs in the
regenerated `00000000000000_init` baseline**, not stacked on as an additive
migration. Only SQL Prisma cannot express lives in
`00000000000001_custom_constraints_and_triggers` — partial and expression
indexes, the FTS GIN index, and `NOT NULL` on `String[]` columns.

## Procedure

```bash
docker run -d --name mig-verify -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=bilinear \
  -p 55432:5432 postgres:18-alpine        # match docker-compose.infra.yml and CI
export DATABASE_URL="postgresql://postgres:pg@127.0.0.1:55432/bilinear?schema=public"

yarn prisma migrate deploy                # 1. both migrations apply cleanly
yarn prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --script   # 2. drift — see the trap below
yarn db:verify:schema                     # 3. custom objects actually landed
yarn db:seed                              # 4. the schema is genuinely usable
yarn db:verify:fence                      # 5. only if sync_actions changed

docker rm -f mig-verify
```

## Three traps

**1. `migrate diff` is expected to be non-empty.** It emits exactly one
statement, and this is structural, not drift:

```sql
DROP INDEX "sync_actions_organization_id_xact_id_id_idx";
```

`SyncAction.xactId` is `Unsupported("xid8")` and Prisma cannot put `@@index` on
an `Unsupported` field, so the covering index lives in the custom migration and a
schema-derived diff proposes dropping a thing it cannot declare. **Never apply
that statement** — it is what makes the commit-order fence's
`ORDER BY (xact_id, id)` read cheap. Treat *any other* statement as real drift
and fold it into the baseline.

Because of this, `--exit-code` will not return 0. Do not wire it into CI
expecting green.

**2. `migrate diff` is blind to the entire custom migration.** It compares the
database against `schema.prisma`, and everything in the custom file is by
definition inexpressible there. A no-op custom migration passes step 2 cleanly
while leaving every partial index missing. Step 3 is what catches that — don't
skip it because step 2 looked fine.

**3. Zero user triggers is correct.** The only one this project ever had,
`set_sync_action_committed_at`, was removed when the xid8 fence replaced
`committed_at` with `xact_id`. An empty `pg_trigger` result is no longer evidence
that the custom migration failed to apply; use `yarn db:verify:schema` for that.

## If you change what the custom migration creates

`scripts/verify-schema.mjs` hardcodes the expected index names and `String[]`
columns. Update `EXPECTED_INDEXES` / `EXPECTED_NOT_NULL_ARRAYS` alongside the
migration, then prove the check still has teeth by dropping one of the objects
and confirming a non-zero exit — per this repo's rule that a test which cannot
fail is not a test.

## No Docker available?

Some sandboxes ship the `docker` binary without a running daemon. A local
cluster works the same way:

```bash
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
PGDATA=/var/lib/postgresql/verify
mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA"
su postgres -c "$PGBIN/initdb -U postgres -A trust -D $PGDATA"
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p 55432 -k /tmp' -l $PGDATA/log start"
psql -h /tmp -p 55432 -U postgres -c 'CREATE DATABASE bilinear;'
export DATABASE_URL="postgresql://postgres@127.0.0.1:55432/bilinear?schema=public"

# Teardown
su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop" && rm -rf "$PGDATA"
```

Two things that will waste your time otherwise:

- Postgres refuses to run as root, hence `su postgres`.
- **`su` resets `PATH`**, so `su postgres -c "initdb …"` fails with
  `command not found` even when `initdb` is on *your* PATH. Every binary run
  through `su` needs its absolute path — that is what `$PGBIN` is for. Redirect
  the output of these to `/dev/null` at your peril; a silent `initdb` failure
  looks exactly like a cluster that started fine until the first `psql`.

A major version below the 18 that CI uses still exercises every object above.

Reference: `docs/DATABASE_SCHEMA.md`.
