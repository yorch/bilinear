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
  mutation in `src/server/graphql/resolvers/*.ts`

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
   wrong field. Already inconsistent across the 15 sites.

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
- **Acceptance signal:** A new vitest suite `transaction-queue.test
  .ts` that drives 3 stacked optimistic ops on the same entity, fails
  the middle one, and asserts the post-state matches what would have
  happened if only the first and third had run.

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

### 2.3 Promote string enums to Prisma enums

| Field | Current | Allowed values |
| --- | --- | --- |
| `OrganizationMember.role` | `String @db.VarChar(20)` | `owner / admin / member / guest` |
| `Team.issueEstimationType` | `String @db.VarChar(20)` | `notUsed / exponential / fibonacci / linear / tShirt` |
| `IssueRelation.type` | `String @db.VarChar(20)` | `blocks / blocked_by / related / duplicate` |
| `Notification.type` | `String @db.VarChar(40)` | `ISSUE_ASSIGNED / ISSUE_STATUS_CHANGED / ISSUE_COMMENT / …` |
| `WorkflowState.type` | `String @db.VarChar(20)` | `triage / backlog / unstarted / started / completed / canceled` |
| `Project.statusType` | `String @db.VarChar(20)` | `backlog / planned / started / paused / completed / canceled` |

Pattern already exists for `CustomFieldType`. Each promotion is
`enum + ALTER TABLE … TYPE … USING …` and a Prisma schema swap. Update
service-layer string literals to typed enum values; update GraphQL
schema to expose enum types.

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

### 2.6 SyncAction retention (deferred follow-up, not in the hardening PR)

Once volume warrants, partition `sync_actions` by `created_at` via
`pg_partman` and add a daily job that drops partitions older than
~30d. Delta sync won't fetch them (clients past 30d offline get a
full bootstrap regardless).

- **Effort:** Medium.
- **Risk:** Medium — partitioning swap requires careful coordination
  with the BIGSERIAL `id` sequence and the `committed_at` watermark
  query plan.
- **Why deferred:** No measurable pressure on `sync_actions` size
  yet; revisit when the table crosses ~10M rows or delta-page p99 on
  catch-up reads regresses.
- **First-touch:** Capture current row count + table size + p99 of
  the delta query on prod; only proceed if the numbers warrant.
- **Acceptance signal:** Delta-page p99 unchanged or improved post
  partition; a 30-day-old row is no longer queryable; full bootstrap
  still hydrates correctly for a client past the retention window.

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

### 3.2 WebSocket fan-out batching + back-pressure

**File entry points:**
- `src/server/ws/connection-manager.ts:42-52` — per-client `ws.send`
- `src/server/ws/index.ts:50-55` — Redis `message` → broadcast

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
| Native `ws.ping()` + pong-driven terminate timer (vs. app-level JSON pings) | `src/server/ws/index.ts:106-121` | Closes dead connections that survived TCP reset |
| `IssueService.maybeCloseParent` / `maybeCloseChildren` skip team read when neither auto-close flag is set | `src/server/services/issue.service.ts:289-295, 335-438` | -5–30ms on every `issueUpdate` with state change |
| MobX secondary indexes (`Map<teamId, Set<id>>`) on base pool store | `src/stores/issue-store.ts:18-29, 52-79` | Eliminates `Array.from(pool.values()).filter` in observer components — material on 10k-issue stores |
| TipTap further code-split inside the lazy editor module | `src/components/editor/tiptap-editor.tsx` | Probably a no-op now that the editor is dynamically imported; verify with bundle inspector before doing more work |

- **Acceptance signal:** Each item ships with a before/after measurement
  in the PR description matching its "Estimated impact" column —
  bundle-inspector diff for TipTap, microbenchmark on the
  `Array.from(...).filter` filter selector for the MobX indexes, etc.
  No item lands without numbers.

---

## 4. Frontend polish

### 4.1 MobX secondary indexes

Paired with §3.3 — same code change, same payoff (perf for filter
selectors). Listed under both because it improves both bundle CPU
work *and* perceived UI responsiveness.

### 4.2 `StatusSelect` and combobox a11y audit

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

---

## 5. Test coverage gaps

Locking in the parts of the system most likely to hide regressions.
Listed in priority order.

### 5.1 `auth.service.ts`

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

### 5.2 `sync-manager.ts` (1078 LOC, 0 tests)

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

### 5.3 `transaction-queue.ts` (240 LOC, 0 tests)

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

### 5.5 Resolver auth-guard sweep

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

### 5.6 MobX store coverage

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
| `tests/e2e/offline.spec.ts` | partial (236 LOC) | confirm reload-survival path: offline → create issue → reconnect → reload page → issue persists |
| `tests/e2e/optimistic-rollback.spec.ts` | partial (162 LOC) | audit coverage against the 13 `tq.enqueue` sites; add a stacked-ops case (pairs with §1.2) |
| `tests/e2e/multi-user.spec.ts` | missing | two browser contexts in different orgs; org A's actions invisible to org B |
| `tests/e2e/magic-link-signup.spec.ts` | missing | full magic-link signup flow (vs. existing `loginAs` shortcut) |

**Acceptance signal:** Each row's `Status` column reads "complete"
in a future revision of this doc, and the e2e suite covers a
realistic regression path for the listed scenario (assert the
post-state in the DB or store, not just visual presence).

---

## 6. Already shipped (since 2026-04-22)

A condensed history of what landed in main. See `git log` for full
details.

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

- 343 → 380. New suites for rate-limit, file IDOR, delta pagination,
  OAuth state JWT, OrganizationService (`71e7e04`).

### Docs

- This file (`4f1936c`); follow-up prune (`25f4f08`).

### DB hardening — misc constraints (§2.4)

Migration `20260512100000_db_hardening_constraints` closed the five
items from §2.4. One item changed shape during implementation; the
others landed as written.

- `users.google_id` — UNIQUE constraint added. Pre-flight check
  aborts the migration if any duplicate google_id exists.
- `issues.previous_identifiers` — GIN index added. Not yet exercised
  — `IssueService.findByIdentifier` currently matches only on the
  live `identifier` column. The index ships ahead of a planned change
  that adds a `previousIdentifiers` fallback so renamed issues remain
  reachable by their old key; cheap to maintain in the meantime since
  the column is only written on team-key renames.
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
