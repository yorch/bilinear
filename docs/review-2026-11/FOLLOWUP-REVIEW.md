# Follow-up review: `origin/main...HEAD` (post-PR #167 gap work)

Reviewed on 2026-11-25. Scope: `git diff origin/main...HEAD` (52 files, +1954/−194), streams A–D.
Nits are left out. Each finding gives the location, how it fails, and a fix.

## What I checked by running it

- **Migration.** I applied both migrations to a scratch DB (`prisma migrate deploy`), then ran
  `prisma migrate diff --from-config-datasource --to-schema` and `scripts/verify-schema.mjs`.
  The diff has exactly two statements, `DROP INDEX "idx_issues_title_trgm"` and
  `DROP INDEX "sync_actions_organization_id_xact_id_id_idx"`, and verify-schema passes (7/7
  indexes, 1/1 extension, 2/2 NOT NULL arrays). So the "exactly two DROP INDEX" claim in
  server.md, SKILL.md and DATABASE_SCHEMA.md is **accurate and acceptable**. Prisma ignores the
  extension because it has no `postgresqlExtensions` preview. The `error_code`/`error_params`
  columns were added to the init baseline, as the policy requires.
- **Trigram DB tests.** `duplicate-suggestion.db.test.ts` passes 14/14 against a `C.UTF-8`
  database. Against a database created with `LC_CTYPE 'C'` it fails 4/14 (see M1).
- **Yjs probe.** I wrote my own Hocuspocus probe, outside the repo, from the new
  store-revalidation harness. It confirmed H1 and H2 below and confirmed that the issue-room
  store does persist for an entitled user. Without that control, the committed issue test
  would have been vacuous.
- **Other tests.** `store-revalidation.test.ts` and `attach-visibility.test.ts` pass (11/11).
- **i18n.** The en and es key sets are identical, and there are no raw colours in the added
  TSX.
- **Stray formatting.** `--stat` shows none. Every changed file belongs to one of the four
  streams.
- **Caveat.** The local runtime is Node 22. CI pins Node 24.

---

## High

### H1. A member demoted to guest after connecting keeps write access to team documents, and their edits are persisted
`src/server/yjs/server.ts:100-108` (`checkEntityAccessForUser`, document branch) and `:373-375`.

- **How it fails.** `readOnly` is set only in `onAuthenticate`. `revalidateAccess` and
  `revalidateRoomAccess` accept any non-null role on a team document, guests included. So:
  1. A member opens `document:<id>`.
  2. An admin demotes them to guest.
  3. They keep editing, and `onStoreDocument` persists the edits. The periodic sweep never
     closes the connection.
- **Probe result.** With `roles.member = 'guest'` set after sync, I got `writes == ['document']`.
- **Impact.** This bypasses `requireTeamMemberNotGuest` (the GraphQL write gate) for as long
  as the socket stays open, which can be indefinitely.
- **Fix.**
  - Make `checkEntityAccessForUser` return `{ valid: true, readOnly: role === 'guest' }` for
    team documents.
  - In `onStoreDocument`, if the writer resolves to `readOnly`, skip the persist and close
    their connections.
  - In `runYjsSweep`, for each connection whose result is `readOnly` but whose
    `connection.readOnly` is false, either set `connection.readOnly = true` (it is a public
    mutable field on `Connection` in @hocuspocus/server) or call `connection.close()` so the
    reconnect comes back read-only. Closing is simpler and leaves nothing ambiguous.
  - Add a test: demote after `synced`, edit, flush, assert no write. Pair it with the existing
    member control.

### H2. The store gate checks only `lastContext`, so a revoked user's edit is broadcast live and later persisted by an entitled peer
`src/server/yjs/server.ts:430-470`.

- **How it fails.** Hocuspocus applies and broadcasts every update before `onStoreDocument`
  runs. The gate re-checks only the *last* writer of the debounce window:
  1. A (revoked) and B (entitled) share a room.
  2. A types `REVOKED`, then B types `ok` within the 2 s debounce.
  3. `lastContext` is B, the check passes, and `encodeStateAsUpdate(document)` persists A's
     text.
- **Probe result.** `writes == ['document']`, and B's doc reads `okREVOKED`.
- **The single-writer case is unsafe too.** The skipped edit stays in the in-memory room, so
  the next entitled edit, from any peer that joins before the room unloads, persists it.
- **Effect on the tests.** The committed tests use only single-user rooms, so their
  "cannot persist" claims hold only in that case.
- **Fix.** Gate where updates come in, not at store time.
  - Add a `beforeHandleMessage({ connection, context, document })` hook that re-validates the
    sender. Cache the result per connection with a short TTL, for example 10 s, to bound the
    DB cost. On an invalid result, `connection.close()` and throw, so the update is never
    applied or broadcast.
  - Keep `onStoreDocument` as a backstop, but track every writer since the last store. Record
    `context.userId` into a per-document `Set` in `onChange`. Refuse the persist if any of
    them is now invalid.
  - Accept that an update already applied cannot be removed from the CRDT. Say so in the
    file's doc comment.
  - Add a two-writer test.

---

## Medium

### M1. The trigram fallback silently does nothing on a database whose `LC_CTYPE` is `C`, and its only real-DB test never runs in CI
`prisma/migrations/00000000000001_custom_constraints_and_triggers/migration.sql:69-83`,
`src/server/services/duplicate-suggestion.service.ts:233-266`,
`.github/workflows/ci.yml` (no `DUPLICATE_SUGGESTION_TEST_DB`).

- **How it fails.** pg_trgm only extracts trigrams from characters that the database's ctype
  treats as alphanumeric. Under `LC_CTYPE=C`:
  - `show_trgm('导出报表时系统崩溃')` is `{}`.
  - Every CJK or Thai `similarity()` is 0.
  - The LanguageAware scorer then returns nothing for exactly the titles it exists to serve.
  - Nothing errors or warns. Many hosted and `initdb`-default setups use `C`.
- **Evidence.** On a C-ctype DB, all three reworded-title cases and the scoping case fail.
  Locally the DB is `C.UTF-8`, which works.
- **Thresholds are close.** On a working DB, the Japanese pair in the test scores 0.304
  against a 0.3 threshold. Real short CJK rewordings, such as `导出失败`/`导出成功` at 0.25,
  usually fall below it, so recall will be modest even when the feature works.
- **Fix.**
  - Have `verify-schema.mjs` assert `SELECT show_trgm('导出') <> '{}'` and fail with a
    message that names the DB ctype.
  - Log a one-time warning at server start if that check is false.
  - Mention the ctype requirement in DATABASE_SCHEMA.md.
  - Set `DUPLICATE_SUGGESTION_TEST_DB` in the CI job that already has a `postgres:18`
    service, so the db tests actually gate.

### M2. The trigram fallback runs on almost every request and can override better FTS results
`duplicate-suggestion.service.ts:285-293`.

There are two problems:
1. **It runs whenever FTS finds nothing.** For Latin titles, trigram runs on every FTS miss.
   Most issues are *not* duplicates, so the common path now runs two queries per suggestion
   request. `idx_issues_title_trgm` is not org-scoped, so the `%` bitmap scan covers every
   tenant's titles before `organization_id` filters them. This was not benchmarked:
   `db:verify:indexes` has no trigram case.
2. **One CJK character routes the whole title to trigram first.**
   `hasNoSpaceScript('Export 失败 on Safari')` is true, so a title that is mostly English goes
   to trigram first. Any 0.3 hit then suppresses FTS's word matches entirely.

- **Fix.**
  - Add the trigram case to `db:verify:indexes` at the 20k-issue scale it already uses.
  - Consider a composite `GIN (organization_id, title gin_trgm_ops)` via `btree_gin`.
  - Run the Latin typo fallback only when the title has at least N terms, or leave it out.
  - For mixed-script titles, run both scorers and merge by rank instead of taking whichever
    comes first.

### M3. Lane counts double-count when the lane classifier's inputs change after `reconcile`
`src/stores/notification-store.ts:103-122, 287-293`, `use-notification-sync.ts:80-87`.

- **How it fails.**
  - `baselineLaneUnread` is a snapshot classified with the classifier *as it stood at
    reconcile*.
  - `laneUnreadCount` computes `server[lane] + pooled(classifier now)[lane] - baseline[lane]`.
  - Any re-classification of a pooled row that is still unread therefore shifts it between
    lanes. The server already counted it in its true lane, so the shift double-counts.
- **Concrete case: cold load.**
  1. The notifications fetch resolves before `issueStore` has the issue.
  2. An `ISSUE_STATUS_CHANGED` row on an issue assigned to the viewer is classified `other`
     in the baseline. The server counted it as priority.
  3. The issue arrives. Pooled now says priority, so **priority is over by k and other is
     under by k**, clamped at 0.
  4. This persists until the next 60 s reconcile.
- **Other triggers.** The same happens when an issue's assignee changes through sync, and in
  the first render with `viewerId == null`.
- **Fix.** Snapshot the *set of ids* unread at reconcile time instead of per-lane counts.
  Compute the delta as:
  - (unread now, not in the snapshot), classified by the current classifier, **plus**
  - (in the snapshot, no longer unread), classified by the current classifier, subtracted.

  Rows that are unread in both contribute 0 whatever their lane. Add a test: reconcile, swap
  the classifier, and assert the counts do not move.

### M4. A bulk team move fires one "labels dropped" toast per issue
`src/hooks/use-issues-bulk-update.ts:89`.

- **How it fails.** `notifyDroppedLabels(data, t)` runs inside each per-row `onSuccess`.
  Moving 25 issues that share a team-scoped label shows 25 identical info toasts. The
  surrounding code explicitly promises "One toast for the whole batch".
- **Fix.** Collect `droppedLabelNames` into a `Set` in the closure. Emit one toast from
  `settle()` once `settled === ids.length`, with the de-duplicated names and the count of
  affected issues.

### M5. The new `Calendar` is a keyboard and screen-reader regression from the native date input it replaces
`src/components/ui/calendar.tsx:135-160`. It is used in the audit-log filters, the bulk due
date picker and the reminder panel.

- **How it fails.**
  - Day buttons are named only by their number, so a screen reader announces "15, toggle
    button, not pressed" with no month or year.
  - `aria-pressed` is the wrong pattern for a single date choice.
  - There is no grid navigation. The panel's roving handler (`usePopoverPanel` with
    `button:not([disabled])`) moves ArrowUp/Down one *day* at a time through all ~33 buttons.
  - There is no year step and no way to type a date. Setting an audit-log "from" date two
    years back takes 24 clicks, where the native input took one typed value.
  - Prev/next stay enabled past `min`/`max`.
- **Fix.**
  - Give each day `aria-label={formatDate(full date)}` and `aria-current="date"` for today.
    Mark the selection with `aria-selected` inside `role="grid"` rows.
  - Add arrow keys (±1 day / ±7 days), PageUp/PageDown (month) and Shift+PageUp/PageDown
    (year) with a roving `tabIndex`.
  - Disable prev/next when the adjacent month is entirely outside the bounds.
  - Keep a typed-entry path for `DateField`, for example a text input that parses
    `YYYY-MM-DD`.
  - Mark the panel `data-autofocus` on the selected day.

### M6. Reminder panel: clearing the time erases the chosen day, and picking today shows a false past-time error
`src/components/issues/issue-reminder-panel.tsx:113-145`.

- **How it fails.**
  - **Clearing the time.** `setCustom(time ? … : '')` discards the selected day when the time
    field is emptied, which the browser's clear button or Backspace on Safari can do. The
    calendar then deselects the day and Set shows "invalid time".
  - **Picking today.** `customTime` defaults to `'09:00'`. Picking *today* after 09:00
    immediately flags "past time" for a value the user never entered.
  - **Lost coverage.** The `tooFar` UI test was deleted rather than ported. The max-day bound
    allows the last day at any time, and only `resolveReminderInput` catches a late time on
    that day, which no panel test now covers.
- **Fix.**
  - Hold the day and the time in separate state and combine them on submit.
  - Default the time to the next quarter hour when the day is today.
  - Port the tooFar case: select the max day, set 23:59, and assert `reminders.tooFar`.

### M7. Lane-count server test barely constrains the query
`src/server/services/notification.service.test.ts:285-303`.

- **What is missing.** The test only checks owner/org/read and that `replyToUserId` appears
  somewhere. It does not pin:
  - the snooze predicate,
  - the visibility `AND`,
  - the `ISSUE_STATUS_CHANGED` + `issue.assigneeId` branch,
  - the type list.
- **Effect.** Deleting the status-change branch, or the snooze filter on the priority query
  only, stays green, so the "always sums to `notificationUnreadCount`" invariant is
  unguarded.
- **Fix.**
  - Assert both `where` objects deep-equal the `getUnreadCount` `where` plus the rule.
  - Pin the three `OR` arms.
  - Regress each one to check that the test goes red.
  - Optionally, add a db test that seeds one row per type and checks the two counts against
    `classifyNotification`.

---

## Assessed, no defect (or acceptable as is)

- **Server vs client lane rule.** The client's `data.issueId` fallback and its
  `ISSUE_PRIORITY_CHANGED` arm don't cause drift:
  - `ISSUE_PRIORITY_CHANGED` is not in the `NotificationType` enum.
  - A row with `issueId` null means the issue is gone, so both sides resolve it to `other`.
- **Lane rule mismatch for issues the client doesn't load.** Archived and trashed assigned
  issues count as priority on the server. Locally they are classed `other` when the issue is
  not in the store. This is a minor display mismatch and goes away once M3's id-snapshot fix
  lands.
- **Webhook `HTTP_STATUS` behavioural change.** Non-2xx deliveries now store
  `errorMessage = 'Received HTTP n'` instead of null. No server code keys on
  `errorMessage IS NULL`, so this is fine. External GraphQL readers do see a new non-null
  value; note it in the changelog.
- **Credential leakage.**
  - `sanitizeDeliveryMessage` strips `scheme://user:pass@` from `message` and from the
    `target` params, and the test covers both.
  - `PRIVATE_ADDRESS` carries no params.
  - `ECONNREFUSED` `target` records the resolved `ip:port`. The old message did too, so this
    is not new exposure.
- **Webhook URL errors.** `PRIVATE_URL` / `INVALID_URL` reasons are correct.
  `webhookUrlErrorKey` falls back to the generic message, and the tests distinguish all three
  cases.
- **Trigram SQL.** All values are bound by `Prisma.sql`, so there is no injection. The
  visibility rules (org, member teams, guest predicate), archived, trashed and
  canceled-without-duplicate all match the FTS scorer, and hydration re-asserts them. Raising
  the `similarity_threshold` GUC can only tighten results because of the explicit `>= 0.3`.
- **Upload attachment test.** It drives the real route, `FileService` and
  `getSyncVisibility`. The private-team and guest denials are paired with allow cases, so it
  can fail. One leftover: it writes into a per-pid tmp `UPLOAD_DIR` and never cleans up.
- **Audit-log name resolution.** `OrganizationMember` rows use the userId as `resourceId`, so
  the user lookup is correct. Webhook rows carry `metadata.name`, so historical names survive
  a rename or delete. A removed user falls back to the short id.
- **Audit IP cell and `TRUST_PROXY_HEADERS`.** The doc and warning claims match
  `request-security.ts`.
- **Dates in `DateField` / `Calendar`.** All date math is local-calendar
  (`new Date(y, m, d)`, string keys) with no millisecond arithmetic, so there are no DST or
  off-by-one issues. The week start uses `Intl.Locale#getWeekInfo`.
- **List padding.** `pb-24 max-md:pb-[40vh]` matches the phone bar's `max-h-[40vh]`.
