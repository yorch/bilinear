# Review Backlog

Tracking remaining items from the multi-angle code/architecture review
(security, sync correctness, performance, pattern drift, DB schema,
frontend, tests).

> Items already shipped live in git history under the `fix(security)`,
> `fix(sync)`, `perf(*)`, `refactor(server)`, `fix(ui)`, `feat(app)`,
> `test(*)`, and `docs(*)` prefixes from 2026-04-22 onward. See the
> "Already shipped" section at the bottom for a quick summary.

Each remaining item carries:

- **Effort** — rough working-session cost (Small / Medium / Large)
- **Risk** — deploy/rollback risk (Low / Medium / High)
- **Why it's deferred** — what design or coordination work has to happen first
- **First-touch** — concrete starting move when picked up
- **Acceptance signal** — how we know it's done

---

## 1. Sync correctness — heavy items

These touch the heart of the offline-first model. Each warrants its own
PR with a brainstorming pass before code.

### 1.1 — Atomic `SyncAction` + business write (#18)

**File entry points:**
- `src/server/services/sync.service.ts:73-102` — `createSyncAction`
- 91 call sites across 19 resolver files (`createSyncAction(`) — every
  mutation in `src/server/graphql/resolvers/*.ts` for a synced entity.
  Resolvers for non-synced concerns (auth, search, user profile,
  webhook management, raw activity log reads) intentionally skip it
  because they don't affect the client-replicated dataset.

**Problem.** The mutation hot path runs

```ts
const issue = await this.prisma.issue.create({ data });
const sync = await ctx.services.sync.createSyncAction(orgId, 'I', 'Issue', issue.id, issue);
```

as two independent statements. A crash, OOM, or pod kill between them
leaves the row persisted but unpublished. Other clients never see it
until something coincidentally re-touches the row (label add, status
change, etc.). On a busy org the silent gap can persist indefinitely
because delta sync only ships rows that *do* have a SyncAction.

The Redis publish is a separate write and was made fire-and-forget in
commit `e954ce2` — that's correct for latency but means the broadcast
is lossy by design and depends on delta sync to recover. If the
SyncAction itself is missing, delta sync has nothing to ship.

**Two competing designs.**

1. **Thread `$transaction` through every mutation.** Add a
   `createSyncAction(orgId, action, modelName, modelId, data, tx?)`
   overload accepting the Prisma transaction client. Callers wrap the
   business write + sync write in `prisma.$transaction(async tx => ...)`.
   Pro: bullet-proof atomicity. Con: 91 call sites; some mutations
   already have nested `$transaction` (Cycle rollover, Project create)
   so we'd need careful nesting.
2. **Outbox pattern.** Keep mutations as-is, but write a `sync_outbox`
   row inside the same business transaction (cheap, just an INSERT).
   A background reconciliation worker reads outbox rows and produces
   the SyncAction + Redis publish. Pro: minimal resolver churn. Con:
   adds a worker process + retry/dedupe logic; non-zero replication lag.

- **Effort:** Large (either path).
- **Risk:** High. Touches every mutation; subtle in `$transaction`
  nesting cases.
- **First-touch (option 1):** Add the `tx?` overload to
  `createSyncAction`; migrate `IssueService.create` + `issueResolvers
  .Mutation.issueCreate` first. Run the existing `issue.test.ts` and
  e2e `tests/e2e/sync.spec.ts` to verify the SyncAction still emits.
- **First-touch (option 2):** Schema migration adds `sync_outbox`
  table; new background worker module under `src/server/lib/`; one
  resolver wired to write to outbox instead of `createSyncAction`.
- **Acceptance signal:** Resolver tests (`issue.test.ts:120-200` style)
  prove that throwing inside the resolver after the business write
  leaves no Issue row in the DB; chaos test (kill -9 between the two
  writes) leaves the system consistent.

### 1.2 — TransactionQueue rollback (LIFO + stacking) (#21)

**File entry points:**
- `src/lib/transaction-queue.ts` (240 LOC, 0 tests; carries the
  module-scoped singleton + IndexedDB persistence + session hydrate
  flow added in the 2026-05-12 hardening pass)
- 13 `.enqueue(` call sites in components/app:
  `src/components/issues/sub-issue-list.tsx:216`,
  `src/components/issues/relations-section.tsx:125,151`,
  `src/components/cycles/cycle-detail-view.tsx:348,442`,
  `src/components/documents/document-editor.tsx:42,66`,
  `src/app/(workspace)/[workspace]/team/[key]/page.tsx:226,297,325,348`,
  `src/app/(workspace)/[workspace]/team/[key]/backlog/page.tsx:324,382`.
- `src/stores/issue-store.ts:99` (and other pool stores) — `optimisticUpdate`

**Problem.** Today every call site captures a snapshot manually:

```ts
const snapshot = issueStore.findById(id);
issueStore.optimisticUpdate(id, patch);
tq.enqueue(MUTATION, vars, {
  onError: () => snapshot && issueStore.optimisticUpdate(id, snapshot),
});
```

Two real holes:

1. **No LIFO stacking.** Two overlapping optimistic ops on the same
   entity (drag-drop while title edit is still in flight) merge via
   `{...existing, ...patch}` — the second `onError` restores to a
   snapshot taken *after* the first patch already applied, which means
   later success keeps the older patch live.
2. **Boilerplate per call site.** Easy to forget. Easy to capture the
   wrong field. Already inconsistent across the 13 sites.

**Design.** Promote the snapshot dance into the store. Two viable
shapes:

1. **Closure-returning `applyOptimistic`.** The store returns a
   `{ commit, revert }` pair scoped to the patch:

   ```ts
   const rollback = issueStore.applyOptimistic(id, patch);
   tq.enqueue(MUTATION, vars, {
     onSuccess: rollback.commit,   // discard the snapshot
     onError: rollback.revert,     // restore the snapshot
   });
   ```

   Pool store internally maintains a per-entity stack of
   `(patch, before)` tuples. `revert()` removes its tuple from the
   stack and re-derives the entity by replaying remaining stack
   tuples on top of the current authoritative state. `commit()` pops
   without re-deriving. Pro: idiomatic and explicit; pairs naturally
   with the queue's `onSuccess`/`onError` callbacks. Con: callers
   must remember to wire both ends.

2. **Queue-owned rollback via patch handle.** `tq.enqueue` accepts an
   `optimistic: { store, id, patch }` field and owns the lifecycle
   end-to-end: pushes onto the store's stack, commits or reverts on
   resolution. Pro: removes the 13-site boilerplate entirely. Con:
   couples `TransactionQueue` to the store API; harder to use from
   non-component code paths (e.g. tests, future server-side replay).

Option 1 is the recommended path unless the boilerplate-elimination
matters more than coupling.

- **Effort:** Large. New API on the pool base store + 13-site sweep +
  concurrency tests for stacked ops.
- **Risk:** High. Optimistic UI semantics are subtle; need fake-timer
  tests that simulate two enqueued mutations failing in different
  orders.
- **Why deferred:** Concurrent-ops design needs to be locked in (and
  agreed on) before code.
- **First-touch:** Implement `applyOptimistic` on `BasePoolStore`;
  migrate `sub-issue-list.tsx:216` (a single onError site); add a
  test that two stacked optimistic patches roll back in LIFO order.
- **Acceptance signal:** A new vitest suite
  `transaction-queue.test.ts` that drives 3 stacked optimistic ops on
  the same entity, fails the middle one, and asserts the post-state
  matches what would have happened if only the first and third had run.

### 1.3 — Bootstrap ↔ WS race + self-echo filter

**File entry points:**
- `src/lib/sync-manager.ts:271-509` — `fullBootstrap`
- `src/lib/sync-manager.ts:1022` — WS message handler (after
  `5b9c22e` it now handles `'resync'` too)
- `src/server/services/sync.service.ts:73-102` — where the SyncAction
  is created (would need a `txId` echo)
- `src/lib/transaction-queue.ts:59-84` — where a client `txId` would
  be generated

**Problem.** Two distinct races:

1. **Bootstrap clobbers fresh WS data.** `fullBootstrap()` fetches
   `/api/sync/bootstrap` at `lastSyncId = N`. While that response is
   in flight, a WS message for `lastSyncId = N+1` arrives, applies to
   MobX. Then bootstrap finishes and `upsertMany()` overwrites the
   newer state with the older snapshot. Client never sees `N+1`'s
   change until something else touches that row.
2. **Self-echo overwrites in-flight optimistic state.** A mutation is
   optimistically applied (good UX), the queue fires it, the server
   broadcasts the resulting SyncAction over WS, and the *originating*
   client receives its own echo while `onSuccess` of the queue is
   still mid-flight. The echo wins, overwriting any client-only
   patches.

**Design.**

Race 1 — two options:

1. **Open WS first, buffer until bootstrap drains.** Connect before
   the `/api/sync/bootstrap` fetch, buffer incoming actions in
   memory, then drain the buffer keeping only entries with
   `id > bootstrapLastSyncId`. Pro: zero schema change. Con: requires
   careful ordering in `SyncManager` so the WS handler doesn't apply
   buffered actions before the bootstrap rows land in the stores.
2. **Bootstrap-then-delta with no WS buffering.** Fetch bootstrap,
   then immediately fire a delta from `bootstrapLastSyncId` before
   opening the WS. Anything broadcast during the gap re-arrives via
   delta. Pro: simpler control flow; reuses the delta path that
   already exists. Con: extra round-trip on every (re)connect.

Race 2 — `txId` echo:
- Client generates a `txId` in `TransactionQueue.enqueue`, threads it
  through the GraphQL mutation; server stores it on the resulting
  `SyncAction` (new column) and echoes it. Client filters WS messages
  by `txId` and skips its own.

Option 1 for race 1 is recommended (lower per-connect cost), but
option 2 is the cheaper migration if the buffering refactor proves
hard to bound.

- **Effort:** Medium-Large.
- **Risk:** High. This is the heart of the sync model.
- **Why deferred:** Schema change (`sync_actions.tx_id` column) + a
  cross-cutting buffering refactor of `sync-manager.ts` need a clean
  test plan first.
- **First-touch:** Schema migration adding `tx_id text NULL` to
  `sync_actions`; thread it through `createSyncAction`; smallest
  client change is to skip echoes whose `txId` matches a recently
  enqueued tx (kept in a small ring buffer for ~30s). The
  `committed_at` column added in the 2026-05-12 hardening pass
  (`schema.prisma:411-422`) is a precedent for the migration shape.
- **Acceptance signal:** Manual flow — drag an issue card; observe
  network tab shows `issueUpdate` mutation, then a WS message — and
  the issue position doesn't snap-back during the brief moment
  between the two.

### 1.4 — Optimistic placeholder collision

**File entry points:**
- `src/stores/issue-store.ts:130-148` — `applySyncAction` placeholder
  reconciliation
- `src/components/issues/create-issue-modal.tsx` — issue creation
  optimistic write site

**Problem.** When a create-issue mutation is enqueued, the client
inserts a placeholder Issue with an "optimistic identifier" (ends with
`…`, e.g. `ENG-…`). Later, when the server's `IssueCreate` SyncAction
lands over WS, the store de-dups by walking pool entries whose
identifier is still optimistic and matching `(title, teamId)`. Two
rapid creates with identical title+team collide: the first placeholder
gets matched against the second's server echo.

**Design.** Pass a client-issued `clientId` (UUID) through the
`issueCreate` mutation. Server stores it transiently (or just echoes
it back in the SyncAction `data` payload). Client matches placeholders
by `clientId` instead of `(title, teamId)`. Couples nicely with the
`txId` work above — both want a client-issued correlation id.

- **Effort:** Small-Medium.
- **Risk:** Low.
- **Why deferred:** Wants to land alongside or after §1.3's `txId`
  work so we add a single correlation id, not two.
- **First-touch:** Add `clientId` field to `IssueCreateInput`; have
  `IssueService.create` echo it back in the SyncAction `data` blob;
  update `issue-store.ts:applySyncAction` to prefer `clientId`-keyed
  matching.
- **Acceptance signal:** New e2e test creates two issues with
  identical titles in <100ms; both end up in the list with their
  server-assigned ids.

### 1.5 — TransactionQueue head-of-line blocking + `RATELIMITED` misclassification — ⚠️ partially shipped

> **Shipped (2026-08-02):** the `RATELIMITED` reclassification — a
> `RATELIMITED` GraphQL error now routes through the bounded
> `RETRY_DELAYS_MS` path instead of being dropped as permanent, and still
> ends in `onError` after `MAX_RETRIES` (`transaction-queue.ts`, with
> `transaction-queue.test.ts` cases). The `canUnblock` head-of-line change
> is still deferred — it alters the queue contract and needs caller opt-in.

**File entry points:**
- `src/lib/transaction-queue.ts:190-235` — the retry / dequeue logic

**Problems.**

1. **Head-of-line blocking.** The queue processes one item at a time; while
   the current item is in its retry sleep (1s → 3s → 10s) all subsequent
   items are blocked. A transient 503 during a drag-drop operation holds
   every subsequent mutation for up to 24 s (1 + 3 + 10 + 10 retries).

2. **`RATELIMITED` misclassification.** All `result.errors` responses are
   tagged `permanent: true` and dequeued immediately (line 195). This is
   correct for `FORBIDDEN` / `NOT_FOUND` / `BAD_USER_INPUT` (retrying won't
   help), but it's wrong for `RATELIMITED` — the server explicitly signals
   "try again later." Today a rate-limited mutation silently disappears from
   the queue; the optimistic state it applied is never rolled back and never
   confirmed.

**Design.**

- Inspect `errors[0].extensions.code` before deciding `permanent`. Map
  `RATELIMITED` → retryable (with exponential backoff identical to network
  errors). All others → permanent (current behavior).
- For head-of-line: add a per-item `canUnblock: boolean` option.
  Non-data-ordering mutations (e.g. reactions, view updates) can set
  `canUnblock: true` so a blocked head item lets unblocking items be
  dispatched in parallel. Keep the default as strictly sequential (safe
  for state-changing mutations).

- **Effort:** Small-Medium.
- **Risk:** Low (logic change is self-contained to `transaction-queue.ts`).
- **Why deferred:** The `canUnblock` API changes the queue contract;
  callers need to opt in — low urgency until rate limiting is observed
  in the wild.
- **First-touch:** Update the `permanent` flag decision to check
  `extensions.code`; add a `transaction-queue.test.ts` case that mocks
  a `RATELIMITED` response and asserts the item is retried, not dropped.
- **Acceptance signal:** `transaction-queue.test.ts` case passes; a
  `RATELIMITED` mock triggers exactly `MAX_RETRIES` retries then calls
  `onError`; a `FORBIDDEN` mock calls `onError` immediately.

### 1.6 — `applyActions` concurrency (no mutex between delta and WS paths) — ✅ shipped (2026-08-02)

> A single-slot promise chain (`applyLock`) now serializes every
> `applyActions` — delta pages and live WS messages — so a WS apply can't
> interleave its MobX/Dexie writes or its `lastSyncId` advance with a
> delta's. See `sync-manager.ts` and the mutex test in `sync-manager.test.ts`.

**File entry points:**
- `src/lib/sync-manager.ts:562` — `private async applyActions(...)`
- `src/lib/sync-manager.ts:514-560` — `deltaSync` → `applyActions`
- `src/lib/sync-manager.ts:1046` — WS handler → `applyActions`

**Problem.** `applyActions` is a single async method that accumulates
all MobX + Dexie writes in memory and flushes at the end. The
`isDeltaSyncing` and `isBootstrapping` guards prevent two deltas or two
bootstraps from overlapping, but there is **no guard** that prevents a
WS message from arriving while a delta is still running:

```
deltaSync calls applyActions(page1)          ← yields at `await fetch`
  WS message arrives, calls applyActions(page2)
    both compute maxId from syncStore.lastSyncId (same stale value)
    both write MobX stores (synchronous, safe — last write wins)
    both await dexie.transaction(...)        ← can now race for Dexie writes
  page2 sets syncStore.lastSyncId = max2
page1 finishes, sets syncStore.lastSyncId = max1 (may be < max2)
```

The Dexie transaction race can produce a stale `lastSyncId`, causing the
next delta fetch to re-request already-applied actions.

In practice this is low-impact (the actions are idempotent) but it
breaks the `committed_at` ordering guarantee: if both calls contain
overlapping action sets, the slower call's Dexie write may overwrite the
faster call's result with older data for the same entity id.

**Design.** Add a module-level boolean `applyingActions` (analogous to
`isDeltaSyncing`) and an async queue: if `applyingActions` is true,
buffer incoming WS actions and drain after the current call completes.
`SyncManager.applyActions` is already private, so the guard can be
added without touching callers.

Alternative (simpler): coerce concurrent calls into a chain via a
single-slot async mutex (e.g. a `Promise` chain). This is 5–10 lines.

- **Effort:** Small.
- **Risk:** Low.
- **Why deferred:** The race is benign today (idempotent writes, small
  delta pages). Becomes material once delta pages grow or high-frequency
  WS traffic is common.
- **First-touch:** Add a `_applyLock: Promise<void> = Promise.resolve()`
  field to `SyncManager`; chain every `applyActions` call through it:
  `this._applyLock = this._applyLock.then(() => this._doApplyActions(actions))`.
- **Acceptance signal:** A vitest fake-timer test fires deltaSync and
  a concurrent WS message; asserts `syncStore.lastSyncId` equals the
  max of both batches' ids after both complete.

---

## 2. DB hardening (one additive migration PR)

All low-risk, high-leverage. Ship as a single migration named
`<date>_db_hardening`. None of the changes destroy data; all are pure
adds (indexes, FKs, enum types, unique constraints).

> Run `EXPLAIN (ANALYZE, BUFFERS)` on a representative dataset
> before/after each index addition to capture wins for the PR
> description.

### 2.1 Compound + partial indexes

| Index | Hot path it serves | Replaces |
| --- | --- | --- |
| `notifications(user_id, read, created_at DESC)` | Inbox unread feed (`NotificationService.findByUserId`) | Two single-col indexes |
| `issues(organization_id, updated_at DESC)` | Recent feeds, "since I last saw" | un-anchored `(updated_at)` |
| `issues(assignee_id, state_id)` | "My issues" view | nothing |
| `issues(team_id, state_id) WHERE archived_at IS NULL AND trashed = false` | Active list view per team | nothing |
| `issues(project_id, archived_at, trashed)` | `Project.issues` resolver | `(project_id)` only |
| `sync_actions(organization_id, model_name, model_id)` | Targeted SyncAction replay/debug | nothing |

### 2.2 Explicit `onDelete` on Issue / IssueLabel FKs

`prisma/schema.prisma` Issue model FKs to `Organization` and `Team`
omit `onDelete`. Prisma defaults to `Restrict`/`NoAction`, while peer
models (`Project`, `Cycle`) Cascade. Result: deleting an org with
issues errors out, but deleting an org with projects+issues has
inconsistent semantics.

**Fix.** Set `onDelete: Cascade` on `Issue.organization` and
`Issue.team`. Same for `IssueLabel.organization` / `IssueLabel.team`.
Document the choice in the schema.

### 2.3 Promote string enums to Prisma enums — ✅ shipped (2026-08-02)

> Promoted seven `String @db.VarChar` columns to native Prisma enums, each
> exposed as a matching GraphQL enum (the existing `CustomFieldType` pattern —
> enum in **both** Prisma and the SDL, so the value flows resolver→service→DB
> with no casts and invalid input is rejected at parse time as `BAD_USER_INPUT`):
>
> | Column(s) | Enum | Values |
> | --- | --- | --- |
> | `OrganizationMember.role` + `OrganizationInvite.role` | `OrganizationRole` | owner / admin / member / guest |
> | `Team.issueEstimationType` | `IssueEstimationType` | notUsed / exponential / fibonacci / linear / tShirt |
> | `IssueRelation.type` | `IssueRelationType` (GraphQL enum already existed) | related / blocks / blocked_by / duplicate |
> | `Notification.type` | `NotificationType` | ISSUE_ASSIGNED / ISSUE_STATUS_CHANGED / ISSUE_MENTIONED / ISSUE_COMMENTED |
> | `WorkflowState.type` | `WorkflowStateType` | triage / backlog / unstarted / started / completed / canceled |
> | `Project.statusType` | `ProjectStatusType` | backlog / planned / inProgress / paused / completed / canceled |
>
> Nothing is deployed, so the init migration was **regenerated**
> (`migrate diff --from-empty`) rather than shipping `ALTER TYPE … USING`; the
> diff vs. the prior init is exactly the six `CREATE TYPE`s + the column swaps.
> The old "BLOCKED on inconsistent vocabularies" call was wrong — `statusType`
> uniformly uses `inProgress` (the `started` was a mis-read of the `startedAt`
> *timestamp*) and `WorkflowState.type` uniformly uses `canceled`. The
> `'cancelled'` (double-l) latent bugs were fixed independently in #117 (which
> also added the `state-type-spelling.test.ts` guard); the enum now makes the
> seed's value **compile-enforced** and rejects `cancelled` at the DB. Only two
> client documents changed (`$role: String!` → `OrganizationRole!`) — every
> other field flows through an input object where GraphQL coerces the string to
> the enum. `TeamMembership.role` (its own `TeamMemberRole` enum) and
> `AuthToken.type` stayed out of scope. Verified against real Postgres 17:
> migrations apply, drift shows only the documented xid8-index residual, all
> seven enum types present, `db:seed` green.

**Blocker re-assessed (2026-08-02).** #116 recorded this as ⛔ BLOCKED on
"inconsistent existing vocabularies (`canceled`/`cancelled`,
`started`/`inProgress`)". Both halves have since been checked, and
neither is what it looked like:

- **`canceled`/`cancelled` was real, and its source is now gone.**
  `prisma/seed.ts` seeded a `cancelled` workflow state while every
  consumer looks up `canceled`; three client-side comparisons had the
  same typo. All four are fixed and
  `src/lib/state-type-spelling.test.ts` keeps them fixed. No migration
  writes the value either, so the only rows that can still hold it are
  in databases seeded before that fix — and nothing is deployed, so a
  re-seed (or a one-line `UPDATE`) clears them. A normalization step
  is still worth writing for safety, but it is a one-liner, not a PR.
- **`started`/`inProgress` was a documentation error**, above, not a
  data inconsistency. `WorkflowState.type` uses `started`;
  `Project.statusType` uses `inProgress`. They are two different enums
  over two different columns and were never in conflict — this table
  simply listed the wrong values for `Project.statusType`.

So the remaining cost is the ordinary one: six `ALTER TYPE` promotions,
the service-layer literal sweep, and the GraphQL surface. Still Large,
still its own PR, but no longer blocked on a data-cleanup prerequisite.

### 2.1–2.2 Compound/partial indexes + Issue/IssueLabel `onDelete` — ✅ shipped (2026-08-02)

> Landed as schema `@@index` additions (folded into the regenerated init)
> plus the `issues(team_id, state_id) WHERE active` partial in the custom
> migration; `onDelete: Cascade` on `Issue`/`IssueLabel` org+team FKs.
>
> **Benchmarked 2026-08-02** (`yarn db:verify:indexes`, 100k issues / 50k
> notifications / 200k sync_actions on Postgres 17). All seven hot-path
> queries are index-served, none falls back to a sequential scan:
>
> | Query | Index | Time |
> | --- | --- | --- |
> | unread count | `notifications_user_id_read_created_at_idx` | 0.06 ms |
> | inbox feed | `notifications_user_id_created_at_idx` | 0.08 ms |
> | org recently-updated | `issues_organization_id_updated_at_idx` | 0.08 ms |
> | my issues in a state | `issues_assignee_id_state_id_idx` | 1.41 ms |
> | project progress groupBy | `issues_project_id_archived_at_trashed_idx` | 0.42 ms |
> | team live set | `issues_team_id_state_id_active_idx` | 0.05 ms |
> | sync action by model | `sync_actions_organization_id_model_name_model_id_idx` | 0.04 ms |
>
> The **data distribution mattered more than the row count**, which is worth
> knowing before re-running this. A first cut put all 100k issues on one team
> and one assignee; the team partial index then "failed" with a 31 ms
> sequential scan and the assignee compound index lost to the plain
> single-column one — both correct plans for a predicate that matches
> everything. Spreading rows over 8 teams / 6 states / 20 users is what makes
> the measurement mean anything. Production distribution will differ again.
>
> §2.6 (retention) shipped in #112; §2.3 (enum promotion) shipped in #118 —
> see §2.3 above for why the "blocked on inconsistent vocabularies" call that
> originally deferred it was wrong.

### 2.4 Misc additive constraints — ✅ shipped

Migration `20260512100000_db_hardening_constraints`. See §6 for details.

- **Effort:** Medium (one migration, schema edits across ~10 models).
- **Risk:** Low. Migration is additive; no row rewrites except enum
  type swaps which run as `USING role::"OrgRole"`-style casts.
- **Why deferred:** Wants a benchmark step (capture a baseline
  EXPLAIN ANALYZE pre-migration) before merging, and coordination
  with downstream tooling (CSV export, custom-field editor) that
  consume the string enum values.
- **First-touch:** Run `prisma migrate diff` with the proposed schema
  changes, save the SQL to `prisma/migrations/<date>_db_hardening
  /migration.sql`, eyeball every `ALTER TYPE` for safety.
- **Acceptance signal:** All existing 380 unit tests still pass
  unchanged; e2e suite still passes; benchmark numbers in PR
  description show ≥2× improvement on the inbox-unread query for an
  org with ≥10k notifications.

### 2.6 SyncAction retention — ✅ shipped (2026-08-02, #112)

Shipped as a row-level sweep, **not** the `pg_partman` partitioning
originally sketched here. Two things about that original sketch are now
obsolete and are recorded so nobody re-derives them: it assumed a
`committed_at` watermark column, which the xid8 commit-order fence
deleted; and it treated the sweep as the whole job, which it is not.

What shipped:

- `SyncService.pruneSyncActions()`, run hourly, deletes past
  `SYNC_ACTION_RETENTION_DAYS`.
- **A sweep on its own is a silent data-loss bug** — a client whose
  cursor predates the pruned span would get a successful-looking,
  permanently incomplete delta. So the sweep also records
  `organizations.sync_actions_pruned_through_xact_id`, and
  `getDeltaSyncActions` answers `staleCursor: true` for a cursor at or
  below that mark, sending the client to a full bootstrap instead.
- Prune and mark are **one data-modifying CTE** (`DELETE … RETURNING`
  → `MAX(xact_id)` per org → `UPDATE organizations`), so a delete
  cannot land without its mark. `GREATEST(COALESCE(existing, 0), …)`
  keeps it monotonic, and only orgs that actually lost rows are marked
  — marking every org combines with a zero bootstrap cursor into a
  permanent delta → staleCursor → bootstrap loop.
- Deletion is by `created_at` (wall-clock policy, indexed) while the
  mark is in `xact_id` space, because that is where the delta cursor
  lives. A timestamp mark is not comparable to an xid8 cursor at all.
- The mark column is `NUMERIC(20, 0)`, not `BIGINT`: xid8 is unsigned
  64-bit and overflows a signed `int8` at the top of its range.

See DATABASE_SCHEMA.md §2.22b and PATTERNS.md §80.3.

**Still open:** partitioning proper. The sweep is a `DELETE`, so it
leaves bloat a `DROP PARTITION` would not, and it has never been run
against a large table.

- **Effort:** Medium. **Risk:** Medium — the swap must coordinate with
  the BIGSERIAL `id` sequence and the `(xact_id, id)` delta query plan.
- **Why deferred:** No measured pressure yet. Revisit when the table
  crosses ~10M rows or delta-page p99 on catch-up reads regresses.
- **First-touch:** Capture row count, table size, and delta-query p99
  on a real workload; only proceed if the numbers warrant.
- **Acceptance signal:** Delta-page p99 unchanged or improved; a row
  past the window is unqueryable; a client past the window still
  re-bootstraps correctly via the `staleCursor` path above.

---

## 3. Performance — bigger items

### 3.1 Bootstrap pagination + streaming

**File entry points:**
- `src/server/services/sync.service.ts:104` — `getBootstrapData`
- `src/app/api/sync/bootstrap/route.ts` (~108 LOC) — NDJSON serializer
  buffered into `lines.join('\n')`
- `src/lib/sync-manager.ts:271-509` — `fullBootstrap` reader

**Problem.** Bootstrap returns every issue / label / cycle / etc. for
the org in a single buffered NDJSON response. For a 10k-issue org this
is multi-MB and gates app boot for the entire request duration. The
current `descriptionState` omit (commit `4ea91b1`) trims the worst of
it for issue *list* queries but not for bootstrap.

**Design.**
- Per-table `take` caps (e.g. issues 5000, labels 500, cycles 100)
  with a follow-up paginated fetch for the rest.
- Stream the response via `ReadableStream` so the client can start
  hydrating the first batches while later batches are still being
  serialized server-side.
- Drop `description` and `descriptionState` from the bootstrap issues
  payload (already done for list queries); the detail panel re-fetches
  on demand.
- Add a `nextCursor` envelope per table so the client can lazy-load
  the rest in the background after the WebSocket is open.

- **Effort:** Large. Both server (streaming NDJSON, per-table cursor)
  and client (`SyncManager.fullBootstrap` + Dexie write loop need
  awareness of partial bootstrap) change.
- **Risk:** Medium. The first-page experience must still be usable on
  its own; partial bootstrap with a slow tail breaks invariants like
  "every Issue's `assigneeId` resolves to a User in the User store"
  unless we order tables so referenced rows arrive first.
- **First-touch:** Ship streaming + per-table caps first while keeping
  bootstrap effectively-complete (caps high enough that nothing is
  truncated for typical orgs). Add the `nextCursor` background-load
  in a follow-up.

### 3.2 WebSocket fan-out batching + back-pressure — ✅ shipped (2026-08-02)

> Shipped both halves. `SyncBroadcastBatcher` (`src/server/ws/sync-batcher.ts`)
> coalesces per-org SyncActions over a `WS_BROADCAST_COALESCE_MS` (50ms) window
> into one `sync` frame; `ws/index.ts` routes the Redis `message` handler
> through it and `shutdown()` flushes the window. `broadcastToOrgAll` closes any
> client whose `bufferedAmount` exceeds 1MB with code 4002. Coexists with #112's
> retention sweep in `ws/index.ts`. The 1000-connection load-test acceptance
> below still needs a real environment.

**File entry points:**
- `src/server/ws/connection-manager.ts:42-52` — per-client `ws.send`
- `src/server/ws/index.ts:104-108` — Redis `message` → broadcast

**Problem.** `broadcastToOrgAll` calls `ws.send` synchronously per
client per SyncAction. No batching, no `bufferedAmount` checks. At
1000 users + 10 mut/s = 10k sends/s on a single Node process. Slow
clients block the loop for the org because there's no backpressure
handling.

**Design.**
- Coalesce per-org with a 50ms flush window. Buffer SyncActions in a
  per-org array; flush as a single `{ cmd: 'sync', sync: [...] }`
  message. The client already accepts arrays — this is purely a
  server change.
- Track `ws.bufferedAmount` per connection. If it exceeds a threshold
  (~1MB), close the socket with a "slow client" code; the client
  reconnects and re-runs delta.

- **Effort:** Medium.
- **Risk:** Medium. Latency-sensitive UX (drag-drop) will see ~25ms
  more median delivery time.
- **First-touch:** Wire the 50ms coalesce window in
  `broadcastToOrgAll`; verify the client already handles `sync: [...]`
  arrays in `sync-manager.ts:1022` handler.
- **Acceptance signal:** A 1000-connection load test (Artillery or
  k6) shows event-loop p99 unchanged at 10 mut/s; a deliberately-slow
  client (paused tab) gets disconnected with the "slow client" code
  rather than back-pressuring the org; drag-drop e2e spec still passes.

### 3.3 Smaller perf wins

| Item | File / line | Estimated impact |
| --- | --- | --- |
| ✅ **shipped (2026-08-02)** — native `ws.ping()` + `'pong'` handler added alongside the app-level ping. Refreshes `lastPongAt` from EITHER pong, so a socket is reaped only when transport AND app layer are both silent (a genuinely dead connection, not a merely-busy one). The app-level `{cmd:'ping'}` stays because a browser can't observe native ping/pong from JS — it's the only heartbeat the client can see to reset its own idle timer, so native ping is additive on the server, not a replacement. | `src/server/ws/index.ts` | Reaps connections that survived a TCP reset; stops falsely terminating a backgrounded/janked-but-connected tab |
| ✅ **shipped (2026-08-02)** — `IssueService.update` skips the team-flag read + cascade when the new state isn't terminal (`completed`/`canceled`); neither cascade can fire otherwise | `src/server/services/issue.service.ts` | -1 DB round-trip on every non-terminal `issueUpdate` |
| ✅ **shipped (2026-08-02)** — `byTeam` MobX secondary index (`Map<teamId, Set<id>>`), replace-Set-on-membership-change so a team selector re-runs only on its own changes; `upsertMany` skips the swap for unchanged-membership bulk updates | `src/stores/issue-store.ts` | Eliminates `Array.from(pool.values()).filter` in observer components — material on 10k-issue stores |
| ✅ **verified no-op (2026-08-02)** — the editor is already `dynamic(…, { ssr: false })` via `tiptap-editor.lazy.tsx`, and every one of its 5 consumers imports the lazy wrapper (no static import pulls it into an entry chunk). The whole editor + extensions + hocuspocus + lowlight sit in one ~928K async chunk that loads only on editor mount. Splitting it further would fragment that on-mount fetch into a request waterfall without reducing initial load (already 0 there). No change made. | `src/components/editor/tiptap-editor.tsx` | none — confirmed already optimal |

- **Acceptance signal:** Each item ships with a before/after measurement
  in the PR description matching its "Estimated impact" column —
  bundle-inspector diff for TipTap, microbenchmark on the
  `Array.from(...).filter` filter selector for the MobX indexes, etc.
  No item lands without numbers. **Caveat for the WS ping change:** the
  heartbeat lives in the connection-handler closure, which the ws unit
  tests mock out (they exercise only the pure `shouldTerminateConnection`),
  so its runtime behavior wants a staging/browser smoke test — the change
  is safe-by-construction (strictly additive; can only make termination
  more lenient, never falsely terminate), which is why it lands here.

---

## 4. Frontend polish

### 4.1 MobX secondary indexes — ✅ shipped (2026-08-02)

Paired with §3.3 — same code change, same payoff (perf for filter
selectors). Shipped the `byTeam` index (the hottest); cycle/project/state
still scan (lower traffic). See §3.3.

### 4.2 `StatusSelect` and combobox a11y audit — ⚠️ partially shipped (2026-08-05)

> Shipped the listbox/option pattern on the three single-select pickers
> (status/priority/assignee) via a `SelectPopover` opt-in `listbox` prop +
> `role="option"`/`aria-selected`, then extended it to `estimate-picker`
> (2026-08-05), which the first pass missed. Its panel is only a listbox in the
> branch that renders a scale — with no estimation scale the panel is a
> free-form number field, so `listbox` is bound to `scale != null` rather than
> set unconditionally. It also picked up the `e.stopPropagation()` the other
> four pickers already had; without it a pick bubbles to the row behind.
>
> `label-select` remains deliberately excluded: it is multi-select, and the
> listbox pattern needs `aria-multiselectable` plumbed through `SelectPopover`
> before it would be correct rather than merely present.
>
> `SimpleSelect` (`ui/select.tsx`) was brought onto the same pattern
> (2026-08-18): `role="listbox"`/`role="option"`/`aria-selected`, an optional
> `ariaLabel` for the call sites whose visible label is a plain `<span>` (the
> custom-field value rows), `aria-haspopup`/`aria-expanded`/`aria-controls` on
> the trigger, focus moved into the panel on open, and Up/Down/Home/End roving
> focus. Worth recording *why* it needed doing twice: the first attempt added
> only `aria-haspopup="listbox"` + `aria-expanded`, which is strictly worse than
> adding nothing — it promises a listbox and then hands a screen reader a row of
> unroled buttons. Advertise the pattern or implement it; never half of it.
>
> Still open: the full combobox restructure across the searchable pickers
> (project/cycle), `aria-haspopup`/`aria-expanded` on the *remaining*
> `SelectPopover` trigger buttons, and the axe-core sweep in the checklist below.

**File entry points:**
- `src/components/properties/status-select.tsx`
- `src/components/properties/assignee-select.tsx`
- `src/components/properties/priority-select.tsx`
- `src/components/properties/label-select.tsx`
- `src/components/properties/project-select.tsx`
- `src/components/properties/cycle-select.tsx`

**Audit checklist.**
- All combobox buttons have `aria-haspopup="listbox"` and
  `aria-expanded`.
- Listbox items have `role="option"` and `aria-selected`.
- Keyboard navigation: Up/Down moves focus, Enter commits, Esc closes,
  Home/End jump.
- Type-ahead search announces the filtered result count via a
  visually-hidden live region.
- Color-coded state pills don't carry semantic meaning by color alone
  (already mostly OK — they include text labels).

**Effort:** Small per component, ~30min × 6 components.

**Acceptance signal:** axe-core (or Playwright `@axe-core/playwright`)
sweep on `/team/[key]` and `/issue/[id]` passes with zero combobox-
related violations; a keyboard-only walkthrough opens each select,
filters with type-ahead, selects an option, and closes with Esc
without touching the mouse.

### 4.3 Server error messages reach the UI untranslated (2026-08-04)

> Found during the i18n audit and deliberately left out of that PR: it is one
> architectural change touching every error path, not an audit edit.
> **This is the largest remaining i18n gap.**

**File entry points:**
- `src/lib/utils.ts:14-16` — `getErrorMessage(err, fallback)`
- `src/lib/graphql.ts:69` — `throw new GqlError(first?.message ?? 'Request failed', …)`
- `src/server/graphql/resolvers/*.ts` — ~144 hardcoded English `GraphQLError`
  message literals
- `src/app/api/upload/route.ts` — hardcoded JSON `error` strings

**Problem.** `getErrorMessage` prefers `err.message` over the translated
fallback whenever `err` is an `Error`:

```ts
return err instanceof Error ? err.message : fallback;
```

`gqlMutate`/`gqlQuery` propagate the GraphQL error's message verbatim, so a
call site that looks fully localized —
`toast.error(getErrorMessage(err, t('settings.workspace.leaveError')))` — still
shows the server's hardcoded English whenever the server supplied a message.
The `t()` fallback only wins for non-`Error` throws. Same shape for the upload
route: `toast.error(err.error ?? t('issueDetail.attachments.uploadFailed'))`.

Confirmed live in `src/components/settings/members-section.tsx:120` and
`src/components/issues/file-attachments.tsx:81`.

**Why it's deferred.** The fix is not to translate 144 literals — server
messages are also read by logs, tests and API clients. It is to key the toast
off the error *code* rather than its prose. `extensions.code` is already the
established discriminator (`.claude/rules/server.md`: `UNAUTHENTICATED`,
`NOT_FOUND`, `FORBIDDEN`, `RATELIMITED`, `BAD_USER_INPUT`, …), so the client
can map code → dictionary key and use the server message only as a
last-resort fallback for codes it doesn't know. That changes what every
error path renders, which wants its own PR and its own review.

**First-touch.** Add `errors.byCode.*` keys for the existing `extensions.code`
values, then give `GqlError` a `code` field and add a
`translateError(err, t, fallbackKey)` helper that prefers `code` → `t()` over
`err.message`. Migrate `members-section.tsx` and `file-attachments.tsx` first
(both have confirmed reproductions), then sweep the remaining
`getErrorMessage(` call sites.

**Effort:** Medium. **Risk:** Medium — touches every mutation failure path.

**Acceptance signal:** with the app in `es`, a failing mutation whose resolver
throws a hardcoded English `GraphQLError` renders a Spanish toast; a code the
client doesn't recognize still renders something useful rather than an empty
string. A test asserts `translateError` prefers the code-derived key over
`err.message`.

### 4.4 `yarn build` emits one Turbopack NFT warning (2026-08-04)

**File entry points:**
- `src/app/api/upload/route.ts:25-26` — module-scope `mkdirSync(getUploadDir())`
- `src/server/lib/upload-dir.ts` — `resolve(process.cwd(), 'uploads')`

**Problem.** Every `yarn build` (and the Docker build) ends with:

```
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
…
Import trace:
  App Route:
    ./next.config.ts
    ./src/app/api/upload/route.ts
```

The upload route resolves its directory from `process.env.UPLOAD_DIR` /
`process.cwd()` and calls `mkdirSync` at **module scope**. Turbopack's file
tracer can't follow the dynamic path, gives up, and pulls the whole project
into that route's NFT list — `next.config.ts` included — which bloats the
standalone output. The build still succeeds and the route works.

**Confirmed pre-existing:** reproduced on clean `origin/main` (`0b36764`), so
it is not introduced by any branch currently in flight.

**Why it's deferred.** Three candidate fixes have now been tried and *none*
moves the warning, so the trigger is still unidentified:

1. `/* turbopackIgnore: true */` on the `resolve()` calls in `upload-dir.ts` —
   no change (verified 2026-08-04).
2. **Moving `mkdirSync` out of module scope** into a `let ensured = false` lazy
   guard called from the POST handler — no change (verified 2026-08-05). This
   disproves the previous hypothesis recorded here, which named the module-scope
   `mkdirSync` as the cause; that guess was wrong and the change was reverted
   rather than kept, since it trades a boot-time guarantee for nothing.
3. `join(process.cwd(), 'uploads')` instead of `resolve(...)` — the shape the
   warning text itself suggests ("statically scoped to some subfolder") — also
   no change (verified 2026-08-05).

The import trace still reports only `next.config.ts → src/app/api/upload/route.ts`
with the route otherwise untouched, so the next step is to bisect the route's
*other* module-scope work (the `env`/`prisma`/`FileService` import chain) rather
than the upload directory, which now has three negative results against it.

**First-touch.** Bisect by stubbing the route down to a bare handler and adding
imports back one at a time until the warning reappears — that identifies the
real edge in the trace. Only then pick a fix.

**Effort:** Small. **Risk:** Low-Medium — the upload directory must exist
before the first write on a cold container.

**Acceptance signal:** `yarn build` completes with no Turbopack warnings, and
an upload against a container with no pre-existing `uploads/` directory still
succeeds.

---

### 4.5 `sync-manager`'s model switch is 20 copies of the same 12 lines — ✅ shipped (2026-08-18)

> Shipped as a `CACHED_MODELS` registry dispatched from the switch's `default`
> arm: seventeen uniform arms collapse to one entry each declaring the store
> method next to its Dexie table, while `Organization`, `Issue` and
> `Notification` keep the bespoke cases they genuinely need. 210 lines removed.
>
> `sync-manager.models.test.ts` is the guard, and it closes both halves of the
> hole. It reads the server and the client from source (as
> `graphql-documents.test.ts` and `dictionary.test.ts` already do, because the
> registry closes over per-call store instances and cannot be imported
> standalone): every model the server can emit must be in the registry, be a
> bespoke case, or be listed in the exported `UNCACHED_MODELS`. It also asserts
> each model is paired with the table its name derives from — that is the check
> that catches the wrong-table typo, which `yarn typecheck` provably does not,
> since both Dexie buckets are `object[]`.

> Surfaced while extracting `applyPoolSyncAction`. That extraction was the *small*
> duplication; this is the one that can lose data.

**File entry point:** `src/lib/sync-manager.ts` — the `applyActions` switch.

**Problem.** Each of ~20 `case` arms repeats the identical shape: call the
store's `applySyncAction` with a `Parameters<typeof …>[2]` cast, then push either
a Dexie delete or a Dexie upsert into the right table. ~240 lines of boilerplate
where the failure mode is silent: wire an arm to the wrong Dexie table, or omit
an entity entirely, and rows vanish from the offline cache with nothing failing
in CI. The `Organization` arm's own comment records that this already happened
once — "without this case the action was emitted by the server and silently
dropped here."

**First-touch.** A `Record<modelName, { apply, dexieTable }>` registry collapses
the uniform arms; `applyPoolSyncAction`'s `(pool, …)` signature is already the
seam it needs. The genuinely bespoke arms (`Issue`, `Notification`,
`CustomFieldValue`, `Organization`) stay explicit cases.

**Acceptance signal.** A test that asserts every synced model name in the server's
SyncAction vocabulary has a registry entry — the missing-arm class of bug becomes
a failing test rather than a silent cache hole.

**Effort:** Medium. **Risk:** Medium — it is the sync hot path.

### 4.6 Three forked popover implementations — ⚠️ partially shipped (2026-08-18)

> `SelectPopover`, `SimpleSelect` and `issue-context-menu` are three independent
> popovers. The 2026-08-18 audit shared the *class string* across all three
> (`POPOVER_ITEM_CLASS`) and the roving-focus *arithmetic* across two
> (`lib/roving-focus.ts`), but the behaviour is still forked: `issue-context-menu`
> has no arrow-key handling at all, and `SimpleSelect` reached parity on Escape
> and focus-restore only after shipping a keyboard trap.
>
> The shared behaviour shipped as `usePopoverPanel` (2026-08-18): focus in on
> open, Up/Down/Home/End roving, focus back to the trigger on close, now used by
> both `SelectPopover` and `SimpleSelect`. Only the item selector differs between
> them. Both also open focused on the selected option rather than the first.
>
> **The rebuild this entry originally proposed was examined and rejected**, which
> is worth recording so it is not re-proposed. `SimpleSelect` is a bordered form
> control whose five call sites need a trigger `id` to pair with a
> `<label htmlFor>`, an `aria-label` for rows whose visible label is a plain
> `<span>`, and a non-selectable caption row above its options. Folding it into
> `SelectPopover` means three new props on the shared primitive that exist for
> one shape, plus a trigger restyle nothing here can verify without a
> visual-regression suite. The duplication that actually hurt was the keyboard
> and focus behaviour, and that is now shared.
>
> Still open, and the inventory is wider than this entry's title suggested:
> `issue-context-menu` is a third implementation with no arrow-key handling at
> all — it is a menu rather than a listbox, so it wants `role="menuitem"`
> semantics and its own roving, not this hook as-is. `SearchableSelectPopover`
> is a fourth. Its `aria-activedescendant` model is a legitimately different
> pattern and should *not* be forced into `usePopoverPanel`, but it still
> hand-rolls the focus-restore, focus-on-open and panel-id plumbing the hook now
> owns, which is the drift-prone half.

### 4.7 `useRetryableFetch` discards the error's type — ✅ shipped (2026-08-18)

> The hook now returns `cause` — whatever the fetcher threw, unchanged — instead
> of a pre-extracted `errorMessage`. Call sites render
> `getErrorMessage(cause, fallback)` and branch with `isPermissionError(cause)`,
> both of which already existed. The audit-log page lost its `AuditOutcome`
> union and its inner catch, and the webhooks page lost its `forbidden` field:
> both had been re-catching inside their own fetcher purely to recover a code
> the hook was already holding.
>
> `settings/security` keeps its own `{ forbidden, message }` helper — it encodes
> a real distinction (a refusal is not a failure) that the hook does not make.
> It now builds that helper from the hook's own `cause`, since §4.11 brought the
> page onto `useRetryableFetch`.

> The hook catches a `GqlError` — which carries `extensions.code`, with
> `isGqlErrorCode`/`isPermissionError` built on it in `src/lib/graphql.ts` — and
> keeps only `.message`. That is why `settings/audit-log` and `settings/security`
> each re-catch inside their own fetcher to recover a code the hook was already
> holding.
>
> Returning the caught value (`cause: unknown`) instead of a pre-extracted string
> would let call sites use `getErrorMessage(cause, fallback)` and
> `isPermissionError(cause)` directly, and would remove `audit-log`'s inner catch.
> ~10 lines in the hook, 6 call sites. Deferred rather than bundled into the
> audit branch: it changes a shared hook's contract a second time in one PR.
>
> Related guardrail worth adding: `errorMessage` is a raw server string rendered
> verbatim, and nothing scopes it to the admin console. `errorMessage ??
> t('common.somethingWentWrong')` should stay the only sanctioned use.

### 4.8 A refused webhooks page reads as an empty one (2026-08-19)

**Found during** the review of the `cause` migration; **pre-existing**, not
introduced by it.

`settings/webhooks` correctly suppresses its Retry for a viewer who is not an
admin (`error && !forbidden`) — but it has no forbidden message, so the page
falls through to `webhooks.length === 0` and renders
`settings.webhooks.noWebhooksYet`. A non-admin is told there are no webhooks,
which may be false, with nothing indicating they simply cannot see them. The old
code did the same thing by a different route (it set `forbidden: true` alongside
empty arrays), so this is long-standing.

`settings/audit-log` is the model to copy: it renders
`t('settings.auditLog.forbidden')` and returns before the error branch.

**Effort:** Small — one dictionary key in `en.json` + `es.json`, one render
branch. It is listed rather than done because it is new user-facing copy, which
wants a product call on the wording rather than an invented string.

**Acceptance signal:** a member without admin rights loading
`/settings/webhooks` sees an explanation, not "No webhooks yet".

### 4.9 `isPermissionError` folds an expired session into "forbidden" (2026-08-19)

**Found during** the same review; **pre-existing**.

`isPermissionError` (`src/lib/graphql.ts`) returns true for both `FORBIDDEN` and
`UNAUTHENTICATED`. Since the `cause` migration moved the forbidden decision to
the render site, that conflation is now the reusable pattern: an admin whose
session expires while the audit log is open, then hits Apply, is told "You need
admin access to view audit logs" — with no retry and no route back to a login.

**First-touch:** split the predicate at the call sites that render a *terminal*
message — `isGqlErrorCode(cause, 'FORBIDDEN')` for "not for you", and let
`UNAUTHENTICATED` fall through to the retry path (or trigger re-auth).

**Effort:** Small. **Risk:** Low, but it touches an auth-adjacent predicate used
in several places, so it wants its own change rather than riding along.

### 4.10 The frontend audit's four remaining unsound casts — ✅ shipped (2026-08-19)

> Closes F11 of the 2026-08-18 frontend audit (`REVIEW.md`), which had been left
> at "2 of 4 fixed" on the claim that the rest could not be removed.
>
> **The three `as never` on TipTap `addCommands()`** were deferred on the
> reasoning that `@tiptap/core` ships rollup-bundled types re-exporting the
> command interface as `type Commands$1 as Commands`, and that a type-alias
> re-export cannot be augmented from outside the package. That was reasoned, not
> tested — and it is wrong. A probe file declaring a fake command and asserting
> `keyof RawCommands` accepts it type-checks; deleting the augmentation makes it
> fail. Each node now declares its own command, and `slash-commands.ts` drops the
> three structural casts it used to reach commands the compiler could not see.
>
> **`updated as unknown as DBIssue`** in `use-issue-update.ts` is now
> `toIssueSyncRow` (`src/lib/issue-mappers.ts`), which validates instead of
> asserting. The store's apply is a whole-object replace, so a malformed
> response would blank every column of the row; an unrecognizable one is now
> discarded, and the authoritative row still arrives over the SyncAction stream.
>
> The underlying cause was a type that lied: `DBIssue` declares `labelIds`
> required, but two of the three label shapes a server sends do not carry it, so
> `normalizeIssueRow` and `applySyncAction` each had to cast around their own
> signatures. `IssueSyncRow` (`src/lib/db.ts`) names the pre-normalized shape and
> removed three further casts.

### 4.11 The last six hand-rolled fetches — ✅ shipped (2026-08-19)

> Closes F08 of the same audit, which converted nine of fifteen pages and left
> six on the reasoning that they fetch-then-*seed a form* rather than
> fetch-then-render, and that consolidating them wanted a second hook.
>
> Right about the shape, wrong about the remedy: the gap was one callback.
> `useRetryableFetch` gained `onData` (seed after a load lands) and `onError`
> (a one-shot toast or log on failure), both ref-read and both subject to the
> existing staleness guard. Workspace settings, team settings, security,
> integrations, roadmap and the standalone issue route are now on the hook —
> eleven hand-rolled `loading`/`error` pairs, four `cancelled` flags and two
> `console.error` calls gone.
>
> Five of the six rendered a failed load as a dead end and now offer a retry.
> The issue route was the substantive one: a missing issue comes back as a
> NOT_FOUND *error* alongside `data.issue === null`, so reading `data` alone
> could not tell "no such issue" from "the request failed" — both rendered
> "Issue not found", which told someone whose network had dropped that their
> issue was gone.
>
> §4.8 (a refused webhooks page reads as an empty one) is unchanged by this and
> still open: it wants product copy, not a hook.

## 5. Test coverage gaps

Locking in the parts of the system most likely to hide regressions.
Listed in priority order.

### 5.1 `auth.service.ts` — ✅ shipped (2026-08-02)

> `auth.service.test.ts` covers `verifyMagicLink` (expiry, non-leaking
> wrong-code, replay, `TEST_AUTH_CODE` production gating) and the token paths.


**Currently covered (commit `e826638`):** refresh-token reuse / rotation.

**Gaps.**
- Magic-link expiry — `verifyMagicLink` rejects tokens whose
  `expiresAt < now`.
- Wrong-code rejection without leaking which case failed
  (no-such-user vs. wrong-code).
- Replay — same token submitted twice rejected on second use because
  `revokedAt` is set on first.
- `TEST_AUTH_CODE` only honored when `NODE_ENV === 'test'` (boundary
  test in `auth.service.test.ts`).

**Acceptance signal:** `auth.service.test.ts` covers the four gaps
above with deterministic assertions; the `NODE_ENV !== 'test'` case
proves `TEST_AUTH_CODE` is rejected.

### 5.2 `sync-manager.ts` — ✅ shipped (2026-08-02)

> `sync-manager.test.ts` covers cursor ordering, the local-delta-cursor
> regression, apply semantics, `stop()` timers, the staleCursor re-bootstrap,
> and the cache-completeness stamp.


Approach: extract the pure dispatch portion of `applyActions` into a
new `apply-actions.ts` helper that takes `(actions, stores)` and has
no `db` / `fetch` / `WebSocket` side effects. Then unit-test:
- I/U/D/A action dispatch per model
- `lastSyncId` advance via `BigInt` max-of comparison
- duplicate-id idempotency

Integration test under `fake-indexeddb` for the bootstrap → load →
delta sequence.

**Acceptance signal:** `apply-actions.test.ts` reaches ≥80% line
coverage on the extracted module; the integration test catches an
intentionally-introduced bug (e.g. swap I/U dispatch) by failing.

### 5.3 `transaction-queue.ts` — ✅ shipped (2026-08-02)

> `transaction-queue.test.ts` covers drain/rollback, offline-pause,
> RATELIMITED retry-then-permanent, and immediate FORBIDDEN drops.


Pairs with §1.2. Test cases under `vi.useFakeTimers`:
- One enqueued tx → mutation fires once → `onSuccess` called.
- Mutation throws → retried after 1s, 3s, 10s.
- After 3 retries → `onError` called once, queue moves on.
- `permanent: true` error → `onError` immediately, no retry.
- Two enqueued mutations process sequentially (the second waits for
  the first to resolve).
- Queue drains FIFO when both succeed.
- `hydrate()` skips rows whose `(orgId, userId)` don't match the
  active session and deletes them.
- `setActiveSession` / `clearActiveSession` boundary: an enqueue
  during the cleared window logs a warning and stamps empty IDs.

**Acceptance signal:** `transaction-queue.test.ts` covers all 8
cases above with `vi.useFakeTimers` driving the retry schedule; a
fault-injected `gql()` rejection produces exactly the documented
retry pattern.

### 5.4 WebSocket handshake + delivery

Spin a real `ws` server in test (the production module is small enough
to import). Cases:
- Missing token → `4001 Missing token`.
- Invalid token (bad signature, expired, wrong type) → `4001 Invalid
  token`.
- Valid token → `connected` ack; subscribed to `sync:<orgId>`.
- Org A's broadcast doesn't reach Org B's connections.
- `resync` hint after Redis reconnect (commit `5b9c22e`) — exercise
  the reconnect path with a flaky Redis mock.
- `ws-ticket` (2026-05-12) — a ticket older than 60s is rejected;
  reused ticket is rejected on second handshake.

**Acceptance signal:** `ws.test.ts` boots a real `ws` server bound
to ephemeral ports; each case asserts the expected close code or
delivery; the cross-org isolation case is the gate — without it,
the test suite shouldn't ship.

### 5.5 Resolver auth-guard sweep — ✅ shipped (2026-08-02)

> `testAuthGuard` helper + an auth-guard/error-remap sweep over the
> label/comment/notification/custom-field/project resolvers (kept green through
> the #109 `requireOrgRole` change and #115/#116).


Currently: 6 of 25 resolver files have any test coverage. Build a
parameterized helper:

```ts
testAuthGuard({
  resolver: issueResolvers.Mutation.issueArchive,
  args: { id: 'x' },
  serviceError: new IssueNotFoundError(),
  expectedCode: 'NOT_FOUND',
});
```

Run the table for every mutation. Catches drift between service-layer
typed errors and the GraphQL `extensions.code` discriminator.

**Acceptance signal:** Every mutation in the 25 resolver files has at
least one `testAuthGuard` row; deliberately removing a `requireAuth`
call in any resolver fails the suite.

### 5.6 MobX store coverage — ✅ shipped (2026-08-02)

> Shared `runPoolStoreTests()` helper (`src/stores/test-helpers/pool-store-tests.ts`)
> drives the 17 pool-store test files.


Currently: 2 of 17 store files have tests. Build a shared
`createPoolStoreTests(store, fixtureRow)` helper that exercises:
- `applySyncAction('I')` adds the row.
- `applySyncAction('U')` merges the patch.
- `applySyncAction('D')` removes the row.
- `applySyncAction('A')` archives in place.
- `optimisticUpdate(id, patch)` followed by `applySyncAction('U')`
  with a different patch — the server-truth patch wins.
- Idempotency: applying the same `'I'` twice doesn't double-insert.

Run the helper across all 17 stores.

**Acceptance signal:** All 17 stores import the shared helper; the
suite catches an intentionally-broken `applySyncAction('U')` (e.g.
overwrite instead of merge) by failing.

### 5.7 E2E gaps

| Spec | Status | What to add |
| --- | --- | --- |
| `tests/e2e/issue-crud.spec.ts` | partial (4 tests: open modal, create+verify, open detail, close detail) | edit title / edit description / change state / assign / archive / delete |
| `tests/e2e/drag-drop.spec.ts` | missing | drag a card across columns; verify position persists after reload |
| `tests/e2e/offline.spec.ts` | complete | reload-survival is covered by `multiple mutations queued offline all apply` (three offline creates → reconnect → reload → all three persist), un-`.fixme`d 2026-08-18 |
| `tests/e2e/optimistic-rollback.spec.ts` | partial (162 LOC) | audit coverage against the 13 `tq.enqueue` sites; add a stacked-ops case (pairs with §1.2) |
| `tests/e2e/multi-user.spec.ts` | missing | two browser contexts in different orgs; org A's actions invisible to org B |
| `tests/e2e/magic-link-signup.spec.ts` | missing | full magic-link signup flow (vs. existing `loginAs` shortcut) |

**Acceptance signal:** Each row's `Status` column reads "complete"
in a future revision of this doc, and the e2e suite covers a
realistic regression path for the listed scenario (assert the
post-state in the DB or store, not just visual presence).

---

## 5b. Configuration system

The system described in [`CONFIG_ASSESSMENT.md`](CONFIG_ASSESSMENT.md) is
**built and its deferred work is closed** — registry, layered resolver,
`settings` storage, GraphQL surface, `/admin/config` console, and an e2e spec
over the whole loop. The four items originally filed here are done (the
platform-admin audit/SyncAction gap, `themeSettings` syncing unstripped, the 15
dead columns, the `psql`-only team knob), and so are the five filed after it
shipped:

- **5b.1 `branding.appName`** — shipped. The root layout resolves it per request
  and hands it to `BrandingProvider`; metadata, the PWA manifest and
  transactional email call `getAppName()`. Renaming the product no longer needs
  a rebuild, and the auth screens are covered too because they sit inside the
  root layout.
- **5b.2 per-(user, org) preferences** — decided: **user scope stays global**,
  matching `users.locale`/`users.accent`. Recorded in CONFIG_ASSESSMENT §7-D5.
  Not pinned by a test, and cannot be until a knob declares `user` scope — see
  5b.4.
- **5b.3 team-hierarchy resolution** — decided: **team scope stays flat**. A
  sub-team inherits from its org, not its parent team. CONFIG_ASSESSMENT §7-D6,
  pinned by a test that a `parentId` walk would turn red.
- **5b.4 per-user delivery over WebSocket** — **not built, deliberately.** See
  below; it is the one item that came back with a different answer than the one
  it was filed with.
- **5b.5 platform-scope authorization in the primitive** — shipped.
  `ConfigService.set`/`clear` take a `SettingWriter { actorId, role }` and
  re-assert it in `assertWritable`, so the guarantee no longer rests on the one
  resolver that remembers to call `requirePlatformAdmin`.

### 5b.4 — `user` scope has no consumer, so per-user delivery has nothing to deliver

**Status:** open, but not as filed. Do **not** build `broadcastToUser` until
this is resolved.

The item was written as "a user-scope config write is deliberately not
broadcast, so other devices pick it up on next bootstrap". A survey of the
codebase before building the delivery path found the premise is not yet true:
**no knob in the registry declares `user` scope**, so a user-scope write is
refused by `assertWritable` and the traffic the delivery path would carry cannot
exist.

Nor is there an obvious first knob. `locale`, `accent` and
`emailNotificationsEnabled` each already have a column, a mutation and a UI —
moving them into the registry is churn, not a win. The one genuinely
unpersisted preference (board grouping, `use-issue-list-page.ts`) is client-only
cosmetic state, and this repo's convention for that shape is `localStorage`, as
sidebar-collapsed, visible columns and recent items all already do.

**What a real candidate looks like**, so the next person can recognise one: a
preference the **server** must resolve outside a request context — a digest
cadence, a per-user AI setting read by a background job — i.e. the same shape as
the org-scoped `ai.*` knobs, but per person. Nothing in the codebase is that
shape today.

**Why the scope stays anyway:** it costs one branch in `scopeIdFor` and one in
`resolveScopeId`, and removing it would make the precedence chain three layers
while the design, the storage and the docs all describe four. Revisit if it is
still unused when something else forces a schema change.

**First-touch when a candidate appears:** declare the knob, then give
`ConnectionManager` a `broadcastToUser` — `ClientInfo` already carries `userId`,
so it is `broadcastToOrgAll`'s loop with one extra `continue`, not new identity
plumbing.

**Acceptance signal:** a user-scope change reaches that user's other open tabs
and no one else's.

---

## 6. Already shipped (since 2026-04-22)

A condensed history of what landed in main. See `git log` for full
details.

### Tier 5 feature completions (2026-05-24, PR #47)

- **findByIdentifier fallback** — `IssueService.findByIdentifier` now
  queries `previousIdentifiers: { has }` OR clause; `GitHubService` PR
  auto-link uses `hasSome`. (LINEAR_FEATURE_GAPS.md §9.29)
- **Duplicate relation auto-cancel** — `IssueRelationService.create` with
  `type='duplicate'` transitions the source issue to the team's first
  `canceled` state in the same transaction; emits SyncAction + activity with
  the correct pre-cancel `oldStateId`; triggers `autoCloseParentIssues`
  cascade via follow-up `IssueService.update`. (§9.15)
- **Label group enforcement** — `LabelService.create`/`update` enforce max
  1 nesting depth (`LabelGroupDepthError`) and 250-child cap
  (`LabelGroupCapacityError`); create wraps count+insert in a transaction;
  update excludes the moved label from the sibling count.
  `IssueService.syncLabels` deduplicates same-group labels (single-select
  semantics, last-writer-wins). (§9.17)
- **Initiative health badge** — `Initiative.health: String!` GraphQL field;
  resolver returns latest `InitiativeUpdate.health` (last 30d) or a
  progress heuristic. No new column. (§9.25)
- **Activity log expansion** — `issueUpdate` diffs actual persisted label
  set (not raw input) and emits `labelAdded`/`labelRemoved`; `commentResolve`
  / `commentUnresolve` emit `commentResolved`/`commentUnresolved`. (§9.6)
- **Guest write-path sweep** — `commentCreate`, `issueRelationCreate`, and
  `issueRelationDelete` use `requireIssueAccessNotGuestOrOwn`. (§8.2)
- **Project `~`-mentions in editor** — `TipTapEditor` gains `mentionProjects`
  prop + `buildProjectMentionExtension` with `~` trigger. (§9.4)
- **iCal cycle feed** — `User.calendarFeedToken VARCHAR(64) UNIQUE`;
  `GET /api/cycles/feed/[token].ics`; `userCalendarFeedTokenRotate` mutation;
  `calendarFeedUrl` field; settings UI with copy + rotate. (§9.23)

### Quick-wins batch (2026-05-21)

Migration `20260521000000_quick_wins_snooze_favorites_subinitiatives`
plus matching services / resolvers / SDL:

- **Issue snooze mutations** — `issueSnooze(id, until)`, `issueUnsnooze(id)`;
  the existing `snoozed_until_at` / `snoozed_by_id` columns finally get
  an API. Wakeup is a read-time concern (no worker). PATTERNS.md §49.
- **Bulk issue update** — `issuesBulkUpdate(ids, input)` for up to 200
  rows per call, atomic, with auto-close cascades intentionally skipped
  and cross-team state changes rejected. PATTERNS.md §50.
- **Guest role enforcement** — `requireTeamMemberNotGuest` + `isTeamGuest`
  helpers; `IssueFilter.guestUserId` scopes the `issues` query to
  creator-or-assignee for guest users. PATTERNS.md §48. Write-path sweep
  completed 2026-05-24 (commentCreate, issueRelationCreate/Delete now use
  `requireIssueAccessNotGuestOrOwn`).
- **Workspace-level custom fields** — `custom_field_definitions.team_id`
  now nullable, plus a new `organization_id` column for the
  workspace-scope tenant filter. New 30-per-org cap; owner/admin-only
  create/edit; `workspaceCustomFieldDefinitions` query.
- **Favorites** — new `favorites` table + `FavoriteService` + GraphQL
  union for the resolved entity. Sidebar UI deferred. PATTERNS.md §47.
- **Sub-initiatives** — `initiatives.parent_id` self-FK with cycle/depth
  guards (max 5 levels). Progress rollup now includes children and
  propagates up the parent chain. PATTERNS.md §46.

### Hardening pass (2026-05-12)

- WebSocket auth — `/api/auth/ws-ticket` issues a scoped 60s
  `ws_ticket` JWT per (re)connect; the long-lived access token no
  longer reaches client JS. `WsClient.connect()` fetches its own
  ticket. (PATTERNS.md §18.)
- `sync_actions.committed_at` column + BEFORE INSERT trigger; delta
  sync now orders by `(committed_at, id)` and ignores rows newer than
  500ms. (DATABASE_SCHEMA.md §2.22; `schema.prisma:411-422`.)
- Tenant guards — `requireTeamMember` / `requireTeamOwner` take an
  explicit `orgId` and verify the team belongs to it; `Issue
  .findByIdentifier`, `Initiative.update/archive/delete/findById`,
  `Webhook.update/archive/delete/rotateSecret/findById/listDeliveries`
  rescoped to require `orgId`. Auto-close cascade now runs inside the
  parent transaction and emits per-row SyncActions.
- Webhook concurrency — `processDelivery` claims rows by transitioning
  `pending → in_flight` atomically; stale `in_flight` rows reclaimed
  by the sweep after the claim deadline elapses.
- CSRF + per-IP caps — Apollo `csrfPrevention: true` + Origin
  allow-list on `/api/graphql`; per-IP cap on magic-link verify;
  client-IP fallback works without `TRUST_PROXY_HEADERS=1`.
- `TransactionQueue` reload-survival — module-scoped singleton,
  IndexedDB-persisted FIFO, per-session `hydrate()` / `setActiveSession()`.

### DB hardening — misc constraints (2026-05-12, §2.4)

Migration `20260512100000_db_hardening_constraints` closed the five
items from §2.4. One item changed shape during implementation; the
others landed as written.

- `users.google_id` — UNIQUE constraint added. Pre-flight check
  aborts the migration if any duplicate google_id exists.
- `issues.previous_identifiers` — GIN index added. `IssueService
  .findByIdentifier` now queries `identifier = $1 OR previous_identifiers
  @> ARRAY[$1]` (shipped 2026-05-24). `GitHubService` PR auto-link also
  updated to use `previousIdentifiers: { hasSome }` so renamed issues are
  matched in PR titles and branch names.
- `teams.default_issue_state_id` / `auto_close_state_id` — FKs to
  `workflow_states(id)` with `ON DELETE SET NULL`; orphan references
  are nulled out in the migration before the FK is added. Both
  referencing columns also get a plain b-tree index so the FK's
  `ON DELETE SET NULL` check doesn't seq-scan `teams` whenever a
  workflow state is deleted.
- `files.project_id` — FK to `projects(id)` with `ON DELETE SET
  NULL`; same orphan-cleanup pattern.
- `auth_tokens.token_hash` — **partial** UNIQUE (`WHERE type =
  'refresh'`) rather than the blanket UNIQUE originally proposed.
  Magic-link rows hash a 6-digit code (1M-value space) so cross-user
  hash collisions are expected at any meaningful scale; a blanket
  UNIQUE would randomly fail magic-link INSERTs in production. The
  partial unique keeps the safety net for refresh tokens (which hash
  long random strings) and uses a predicate that matches the runtime
  lookup verbatim so the planner reliably picks it up. The legacy
  non-unique `(token_hash)` index is replaced by two type-partitioned
  indexes so both lookup paths stay on an index. If `api_key` (or any
  similar long-random-string token type) is added later, extend the
  predicate in a follow-up migration.

The partial unique cannot be modeled in `schema.prisma`; comments on
the `AuthToken.tokenHash` field document the constraint and point at
the migration as the source of truth.

### Features (2026-05-05)

- Triage workflow — inbound issue queue at `/team/[key]/triage` with
  accept / decline / snooze / duplicate. (PATTERNS.md §38.)
- Initiatives — top-level strategic objects m:n with `Project`;
  progress rolls up from linked projects. UI at `/initiatives`.
  (PATTERNS.md §39.)
- Webhooks — outbound HMAC-signed HTTP subscriptions, admin-only at
  `/settings/webhooks`. Retry sweep runs in the WS server every 30s.
  (PATTERNS.md §40; DATABASE_SCHEMA.md §2.21.)

### Security (7 commits — all 13 audit items closed)

- Test-auth gate, JWT entropy boot guard, structured logger in sync
  routes (`f6f6bde`).
- File IDOR scoping; SVG/HTML attachments forced to download
  (`4062538`).
- Email format validation; per-email + per-IP auth-mutation rate
  limits (`3a76b9e`).
- Server-controlled Google OAuth redirect; signed `state` JWT for
  CSRF (`b0e10b0`).
- Hard caps on GraphQL query depth + complexity (`3f0b297`).
- Refresh-token family + reuse detection (`76d38d7`).
- Plus follow-ups: `TRUST_PROXY_HEADERS` gate on XFF, dead OAuth env
  removed (`0563e6f`); refresh-token reuse tests (`e826638`).

### Performance

- Detached Redis publish; batched notification inserts via
  `createMany` (`e954ce2`).
- Lazy-load TipTap editor; trim `lowlight` to common grammars
  (`2c193f1`).
- Omit `descriptionState` on issue list queries (`4ea91b1`).
- DataLoaders for GraphQL parent relations (`fb6a8a4`).

### Sync

- Paginate delta sync to bound server memory (`f33c3a3`).
- Wipe Dexie cache on schema-bump upgrade (`dffa094`).
- Redis subscriber catch-up via `resync` hint after disconnect
  (`5b9c22e`).
- Wipe IndexedDB cache when JWT orgId differs from cached
  (`a2cb094`).

### Pattern drift

- Extract `OrganizationService` from resolver (`bfcbbfb`).
- Move 5 resolver-level Prisma calls into services (`fedf6ce`).
- Hex colors → semantic CSS tokens (`85bc140`).

### Frontend

- `observer()` on `IssueDetailPanel` + `RelationsSection`; lazy
  `CommandPalette`; `Toaster` re-exported via `@/lib/toast`
  (`720addb`).
- App Router `error.tsx` + `loading.tsx` boundaries (`b331724`).

### Tests

- Initial unit-test push: 343 → 380. New suites for rate-limit, file
  IDOR, delta pagination, OAuth state JWT, OrganizationService
  (`71e7e04`); refresh-token family rotation + reuse detection
  (`e826638`).
- E2E expansion (`3d68c44` → `485de42` → `44d7240`): 35 e2e specs on
  main covering issue CRUD, drag-drop adjacent flows, offline,
  optimistic rollback, comments, search, permissions, docs,
  custom fields, triage. The §5.7 table tracks the still-open gaps
  (drag-drop, multi-user, magic-link signup; partial coverage on
  issue-crud, offline, optimistic-rollback).

### Docs

- This file (`4f1936c`); follow-up prune (`25f4f08`).

---

## 7. How to use this doc

When picking the next thing up:

1. Read the entry's *First-touch* line — the smallest committable
   step that proves the design works. If "First-touch" is missing or
   unclear, brainstorm before writing code.
2. Items marked **Risk: High** want a brainstorming pass (the
   `superpowers:brainstorming` skill or a `Plan` dispatch) before
   touching code.
3. Quality gates run **per commit**:
   `yarn lint && yarn typecheck && yarn test --run && yarn build`.
4. Sub-agent code review (`code-reviewer`) per commit, per the
   established session pattern.
5. Move the entry from §1-§5 into §6 once the work lands.
