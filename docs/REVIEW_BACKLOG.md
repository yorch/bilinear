# Review Backlog

Tracking remaining items from the multi-angle code/architecture review
(security, sync correctness, performance, pattern drift, DB schema,
frontend, tests). Items already shipped live in git history under the
`fix(security)`, `fix(sync)`, `perf(*)`, `refactor(server)`,
`fix(ui)`, and `test(*)` prefixes from 2026-04-22 onward.

Each item has:
- **Effort** — rough working-session cost
- **Risk** — deploy/rollback risk
- **Why it's deferred** — what design or coordination work has to happen first
- **First-touch** — concrete starting move when picked up

---

## Sync correctness — heavy items

### #18 — Atomic `SyncAction` + business write

The mutation hot path performs `prisma.<model>.<op>(...)` then
`ctx.services.sync.createSyncAction(...)` as two independent statements.
A crash between them leaves the row persisted but unpublished — other
clients never see it until something coincidentally re-touches the row.

- **Effort:** Large. 73 `createSyncAction` call sites across 18 resolver
  files. Either thread a Prisma `$transaction` through every mutation or
  introduce an outbox table + reconciliation worker.
- **Risk:** High. Touches every mutation path; also has a knock-on for
  the per-mutation Redis publish (currently fire-and-forget after the
  DB write).
- **Why deferred:** Cross-cutting refactor with a real design decision
  (`$transaction` everywhere vs. outbox table). Warrants its own PR
  with brainstorming up front.
- **First-touch:** Add `createSyncAction(orgId, action, modelName,
  modelId, data, tx?)` overload accepting a transaction client; migrate
  one high-traffic resolver (issue.ts) first, then expand.

### #21 — TransactionQueue rollback (LIFO + stacking)

Call sites already pass `onError` callbacks that manually restore a
captured snapshot. Two known holes: (1) `{...existing, ...patch}` merge
in `optimisticUpdate` can't LIFO-roll-back across overlapping ops on the
same entity; (2) every call site reimplements snapshot capture.

- **Effort:** Large. Introduce `pool.applyOptimistic(id, patch) =>
  rollback` on each pool store, sweep ~15 call sites, add LIFO tests
  for stacked optimistic updates and partial failure.
- **Risk:** High. Optimistic UI semantics are subtle; concurrency tests
  needed before rollout.
- **Why deferred:** Clean fix needs a concurrent-ops design plus tests
  that simulate stacked rollback.
- **First-touch:** Add the `applyOptimistic` API to one pool store
  (`issueStore`), migrate one call site (drag-drop in
  `team/[key]/page.tsx`), prove the LIFO model under tests.

### Bootstrap ↔ WS race + self-echo filter

`fullBootstrap()` fetches the snapshot at `lastSyncId = N`. If a WS
message for action `N+1` arrives during the bootstrap, the in-memory
store sees `N+1`, then `upsertMany` from the bootstrap clobbers it
back. Separately, a client receives its own mutation echo over WS while
`onSuccess` is still in flight; the echo can overwrite local state with
a slightly stale server view.

- **Effort:** Medium-Large. Buffer incoming WS actions until bootstrap
  finishes, then apply only `id > bootstrapLastSyncId`. Add a
  client-generated `txId` so the server SyncAction echoes it back and
  the client skips self-originated rows.
- **Risk:** High. Touches the heart of the offline-first sync model.
- **First-touch:** Add `txId` to `TransactionQueue.enqueue` payload and
  thread it through `createSyncAction`; client filters by `txId`.

### Redis subscriber catch-up after disconnect

Single `redisSubscriber` in `src/server/ws/index.ts`. On reconnect,
messages published during the gap are lost. Connected WS clients keep
their connection alive, so the existing reconnect-triggered `deltaSync`
on the client side never fires.

- **Effort:** Small.
- **Risk:** Medium.
- **First-touch:** On `redisSubscriber.on('ready')` after a prior
  `error`, broadcast a synthetic `{cmd: 'resync'}` to all WS clients;
  the client treats it as a hint to call `deltaSync()`.

### Cache validity check on org switch

`SyncManager.loadFromIndexedDB` returns `true` whenever
`orgs.length > 0 || teams.length > 0`. After a user switches org (token
refresh with a different `orgId` claim), the prior org's cached rows
are loaded into MobX before delta sync kicks in.

- **Effort:** Small.
- **Risk:** Medium.
- **First-touch:** Persist the active `orgId` into `syncMetadata` at
  bootstrap; on load, compare against the JWT's `orgId` and clear the
  cache on mismatch (same code path as the v8 schema-bump wipe).

### Optimistic placeholder collision

`IssueStore.upsertMany` de-dups optimistic placeholders by
`title + teamId`. Two rapid `Create issue "Fix bug"` calls collide —
the second's server echo deletes the first's optimistic row.

- **Effort:** Small-Medium.
- **First-touch:** Pass a client-issued `clientId` through the create
  mutation; match by clientId on echo.

---

## DB hardening (one migration PR)

All low-risk, high-leverage. Ship as a single additive migration.

- **Compound indexes:**
  - `Notification(userId, read, createdAt DESC)` — inbox unread feed
  - `Issue(organizationId, updatedAt DESC)` — feeds, sort
  - `Issue(assigneeId, stateId)` — "my issues"
  - Partial indexes `WHERE archived_at IS NULL` for hot list paths
- **Explicit `onDelete`:** `Issue` / `IssueLabel` FKs to `Organization`
  and `Team` currently default to `Restrict`/`NoAction` and conflict
  with `Project`/`Cycle` which `Cascade`. Make them explicit.
- **Promote string enums to Prisma enums:** `OrganizationMember.role`,
  `Team*Type`, `IssueRelation.type`, `Notification.type`. DB-level
  enforcement + DataLoader-friendly types. Already follows the pattern
  set by `CustomFieldType`.
- **Add `@unique`:** `AuthToken.tokenHash`, `User.googleId`.
- **`File` ↔ `Project` relation:** Currently a raw UUID with no FK.
- **GIN index** on `Issue.previousIdentifiers` for rename-history
  lookup.
- **Team self-references:** `defaultIssueStateId` and `autoCloseStateId`
  are UUIDs without FKs; add relations with `onDelete: SetNull`.
- **`SyncAction` retention:** Add `(organizationId, modelName, modelId)`
  index; consider `pg_partman` partitioning by `createdAt` once volume
  warrants.

**Effort:** Medium. **Risk:** Low (additive migration, no destructive
changes). **Why deferred:** Migration coordination + benchmarking
before/after on a representative dataset.

---

## Performance — bigger items

### Bootstrap pagination + streaming

`/api/sync/bootstrap` ships every issue / label / cycle / etc. for the
org in one buffered NDJSON response. On a 10k-issue org this is
multi-MB and blocks app boot. The response is buffered into
`lines.join('\n')` instead of streamed.

- **Effort:** Large. Cap each table at a sensible page size, stream via
  `ReadableStream` so the client parses incrementally, omit
  `description`/`descriptionState` from issues, and let the client lazy
  load remaining pages.
- **Risk:** Medium. Client SyncManager + Dexie persistence both need
  awareness of partial bootstrap.

### WebSocket fan-out batching + back-pressure

`broadcastToOrgAll` calls `ws.send` synchronously per client per
SyncAction with no batching, no `bufferedAmount` checks. At 1000 users
+ 10 mut/s = 10k sends/s on a single Node process.

- **Effort:** Medium. Coalesce per-org with a 50ms flush window into a
  single `{sync: [...]}` message; track `ws.bufferedAmount` and close
  slow sockets.
- **Risk:** Medium.

### Smaller perf wins

- WS server uses app-level JSON pings; switch to native `ws.ping()` +
  `pong`-driven terminate timer so dead connections close on a TCP
  reset.
- `IssueService.maybeCloseParent` / `maybeCloseChildren` always reads
  the team row, even when neither auto-close flag is set.
- MobX stores rebuild filters with `Array.from(pool.values()).filter`
  on every render. Add secondary indexes (`Map<teamId, Set<id>>`) into
  the base pool store.
- TipTap further code-split: `mermaid-node.tsx` pulls mermaid eagerly;
  lazy-load via `next/dynamic` inside the node view.

---

## Frontend polish

- **App Router `loading.tsx` / `error.tsx`** at root + `(workspace)`
  segment. Currently any thrown error or pending route falls through to
  Next defaults.
- **MobX secondary indexes** (paired with the perf section above).
- **Tiptap mermaid lazy boundary** — see perf list.
- **`StatusSelect` / a11y polish** — keyboard nav and aria-label
  audit on custom comboboxes (post-#11 follow-up).

---

## Test coverage gaps

Locking in the parts of the system most likely to hide regressions.

| File / area | Current state | What to add |
|---|---|---|
| `auth.service.ts` | Refresh-token reuse covered (commit `e826638`) | Magic-link expiry / wrong-code / replay; `TEST_AUTH_CODE` only honored when `NODE_ENV === 'test'`; JWT entropy boot guard |
| `sync-manager.ts` (950 LOC) | 0 tests | Extract a pure `applyActions(actions, stores)` and unit-test the dispatch + `maxId` math; integration test via `fake-indexeddb` |
| `transaction-queue.ts` | 0 tests | Retry/backoff (3 retries with 1s/3s/10s delays), permanent-error short-circuit, processing flag re-entrance |
| WebSocket handshake | 0 tests | Spin a `ws` test server; assert JWT-rejected handshake, org-scoped delivery (user A doesn't get user B's org actions) |
| Resolver auth guards | 7 of 20 covered | Parameterized `[mutation, serviceError, expectedCode]` table per resolver — guarantees error-code mapping stays in sync with `extensions.code` discriminator |
| MobX stores | 2 of 17 covered | Shared `createPoolStoreTests(store)` helper exercising `applySyncAction` dispatch + `optimisticUpdate` rollback semantics across stores |
| `e2e/issue-crud.spec.ts` | empty file | CRUD spec: create / edit title+description / change state / assign / archive / delete |
| E2E flow gaps | Lightweight | Drag-drop reorder, offline → reconnect → reload persistence, multi-user cross-org isolation, magic-link signup (vs. existing `loginAs` shortcut) |

---

## How to use this doc

When picking the next thing up:

1. Read the entry's *First-touch* line — it's the smallest committable
   step that proves the design works.
2. Spawn a brainstorm before the heavy ones (#18, #21, bootstrap
   streaming) — they need a real design decision before code.
3. Quality gates (`yarn lint && yarn typecheck && yarn test --run &&
   yarn build`) and a sub-agent review run **per commit**, per the
   established session pattern.
4. Move the entry to a Done section in this file (or delete it) once
   the work lands.
