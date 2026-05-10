# E2E Test Gap Analysis

_Initial analysis: 2026-05-09. Round-2 closure: Tier 1 + Tier 2. Round-3 closure (this update, 2026-05-10): both `test.fixme` root causes fixed and Tier 3/4 specs added for comments, search-by-ID, permissions, documents, custom fields._

This document compares the Playwright E2E suite against the full feature surface of the product (PRD, PATTERNS.md, shipped routes, services, and Prisma models).

## Status snapshot

| Metric | Round 1 | Round 2 | Round 3 (this) |
| --- | ---: | ---: | ---: |
| Spec files | 27 | 30 | 35 |
| Tests | 76 | 104 | 111 |
| `test.fixme` | 0 | 7 | 0 |
| `test.skip` | 0 | 3 | 3 |

Round 3 fixes both round-2 product limitations and adds five new spec files:

- **`comments.spec.ts`** — posts a comment via `commentCreate` and asserts read-back in the issue detail panel; status-change activity timeline read-back.
- **`search-by-id.spec.ts`** — typing an exact identifier (e.g. `ENG-1`) in the command palette and pressing Enter routes to that issue.
- **`permissions.spec.ts`** — non-admin (`e2e-member@test.local`) gets `FORBIDDEN` on `webhookCreate` / `webhooks` query; admin path is the control; non-admin loading `/settings/webhooks` does not crash.
- **`documents.spec.ts`** — team docs page renders, "New Document" creates and routes to `/docs/<id>`, title edit persists across reload (2s debounce + sync roundtrip).
- **`custom-fields.spec.ts`** — admin defines a text field via team settings, verifies it surfaces in the issue detail panel, archives it as cleanup.

Plus seven previously-fixme tests un-blocked by the underlying fixes:

- `offline.spec.ts`: status-change, archive, and multi-create offline (all 3 now active).
- `triage.spec.ts`: Accept / Decline / Mark Duplicate / Snooze (all 4 now active).

### Round-3 product fixes

1. **`TransactionQueue` is now IndexedDB-persisted.** A new `pendingTransactions` Dexie table backs every enqueue; the singleton drains serially in-memory, removes on success/permanent-failure. Each row is stamped with the session's `orgId`/`userId` and `TransactionQueue.hydrate(session)` filters to the active session — rows from other users/orgs are deleted (a sign-out + sign-in on the same browser does not replay the previous user's mutations). Hydrate runs once at app boot from `SyncProvider`; on transient Dexie errors the `hydrated` flag stays clear so a later boot can retry. Retry counter resets on hydrate so a long offline window followed by a reload still drains within the 14s budget. Callbacks live in-memory (component closures don't survive reload); rehydrated transactions fire fire-and-forget — server reconciliation via the WebSocket SyncAction stream is the source of truth. (`src/lib/transaction-queue.ts`, `src/lib/db.ts`, `src/providers/sync-provider.tsx`.)
2. **Triage queue selector now re-runs on every observable change.** The previous `useMemo` cached the queue array with deps `[teamId, triageStateId, issueStore]`; `optimisticUpdate` mutates pool entries without changing `pool.size`, so the cached array stayed stale and the row never disappeared after Accept/Decline/Snooze on a post-bootstrap issue. Switched to inline computation under the wrapping `observer` so MobX tracking picks up every pool mutation. (`src/app/(workspace)/[workspace]/team/[key]/triage/page.tsx`.)

Two issue-row hotkeys are still skipped because they have no in-row UI to drive: `Shift+P` (project) and `Shift+E` (estimate, which only renders when the team has an `estimationType`). The hotkey sets `openProperty` on the page but no in-row component subscribes. The `Initiatives — updates timeline` skip remains (feature not implemented).

Legend: ✅ covered · 🟡 partial / smoke only · ❌ not covered · ⚠️ test.fixme (real limitation)

---

## Coverage Summary

| Domain | Status | Notes |
| --- | --- | --- |
| Auth — magic link login | ✅ | `auth.spec.ts`, `logout.spec.ts` |
| Auth — Google OAuth | ❌ | No OAuth flow tested |
| Auth — refresh / token rotation / session expiry | ❌ | Only cookie-clear logout |
| Workspace creation / region select | ❌ | No workspace bootstrap test |
| Org settings (name, key, members, roles) | ❌ | None |
| Teams — create | 🟡 | `team-create.spec.ts` opens dialog + key derivation; no full create persisted |
| Teams — list / navigate | ✅ | `team-crud.spec.ts` |
| Teams — update / archive / delete | ❌ | No edit/archive flows |
| Team hierarchy (sub-teams) | ❌ | None |
| Team members add/remove/role | ❌ | None |
| Team settings (cycles cfg, estimation, auto-close, triage toggle, default state) | ❌ | None |
| Workflow states — CRUD / reorder | ❌ | None |
| Issues — create | ✅ | `issue-crud.spec.ts` |
| Issues — open detail panel / inline title edit / subscribe | ✅ | `issue-detail.spec.ts` |
| Issues — list grouping / collapse / J-K nav | ✅ | `issue-list.spec.ts` |
| Issues — bulk select | ✅ | `bulk-select.spec.ts` (existing) + `bulk-actions.spec.ts` (new): toolbar appears on multi-select; bulk archive removes rows; bulk priority change re-groups rows |
| Issues — context menu | 🟡 | Open + Esc only; no actual menu actions exercised |
| Issues — archive (single) | ✅ | `issue-archive.spec.ts` (Backspace) |
| Issues — unarchive / soft-delete / permanent delete / trash recovery | ❌ | None |
| Issues — set status via S | ✅ | `issue-properties.spec.ts`: opens popover, picks option, asserts dismiss |
| Issues — set priority via P | ✅ | Same |
| Issues — set assignee (A), labels (L), due date (D), cycle (Q) | ✅ | `issue-properties.spec.ts`: each opens its expected popover and dismisses on Escape |
| Issues — set project (Shift+P), estimate (Shift+E) | ⚠️ | Skipped — ProjectSelect not rendered in IssueRow; EstimatePicker only renders when team has `estimationType` (seeded ENG has none) |
| Issues — templates (Alt+C) | ❌ | Not covered |
| Issues — labels apply/remove | ❌ | None |
| Issues — assignee change | ❌ | None |
| Issues — due date / overdue color | ❌ | None |
| Issues — estimate change | ❌ | None |
| Issues — description editor (markdown, mentions, embeds, attachments, mermaid, slash commands) | ❌ | Editor not exercised |
| Issues — sub-issues (create, nest, auto-close cascade, convert) | ❌ | None |
| Issues — relations (related, blocks, blocked-by, duplicate auto-cancel) | ❌ | None |
| Issues — custom fields (define, edit value, filter, column, export) | ❌ | None |
| Issue list — column picker / reorder / show-hide custom fields | ❌ | None |
| Issue list — drag-to-reorder within group | ❌ | None |
| Board view — switch | ✅ | `view-toggle.spec.ts` |
| Board view — drag card between columns / within column / swimlanes | ❌ | None |
| Backlog view | 🟡 | `backlog.spec.ts` smoke only — navigates and asserts no runtime error |
| Backlog grooming actions (priority, estimate, move to cycle, ready toggle, bulk archive) | ❌ | None |
| Filter builder (build, AND/OR, save as view) | ❌ | None |
| Custom Views — create / update / favorite / default / share | ❌ | None |
| Search — issue ID instant jump | ✅ | `search-by-id.spec.ts` — typing `ENG-1` and pressing Enter routes to the issue. Exact-identifier hits are promoted to index 0 and Enter falls back to the first item. |
| Search — fuzzy / full-text | ✅ | `command-palette-search.spec.ts` covers query/clear/empty result; `command-palette.spec.ts` covers open/close, recents, arrow nav |
| Projects — create | ✅ | `projects.spec.ts` |
| Projects — update / status / health / dates / lead / teams / members | ❌ | None |
| Projects — archive / delete | ❌ | None |
| Project milestones — CRUD, assign issues | ❌ | None |
| Project updates (status posts) — CRUD, timeline | ❌ | None |
| Project — public roadmap visibility toggle | ❌ | None |
| Public roadmap (`/r/[slug]`) — render, password gate, hidden fields | ❌ | None |
| Cycles — list page renders | 🟡 | `cycles.spec.ts` smoke only |
| Cycles — create / configure / archive | ❌ | None |
| Cycles — assign issue (Q), rollover, burndown chart | ❌ | None |
| Initiatives — list & empty state | ✅ | `initiatives.spec.ts` |
| Initiatives — create from inline input + escape cancel | ✅ | `initiatives.spec.ts` |
| Initiatives — row expand, link project, status persistence | ✅ | `initiatives.spec.ts` (extended): row expand panel; link a project via `+ Add project`; change status to Active and reload-persist |
| Initiatives — updates timeline | ⚠️ | Skipped — feature not implemented (no resolver / UI) |
| Initiatives — sub-initiatives, owner, target date, health | ❌ | Not covered |
| Triage — page renders | ✅ | `triage.spec.ts` smoke + queued-issues check (count, identifiers, action buttons) |
| Triage — accept / decline / duplicate / snooze actions | 🟡 | `triage.spec.ts` — Accept and Decline are stable. Mark Duplicate and Snooze are `test.fixme`: row stays visible past the 10s budget in CI even though Accept and Decline (which use the same MobX path) pass. Suspected WS-reconcile race when the optimistic patch sets `snoozedUntilAt` AND the mutation also creates a relation (Mark Duplicate) or routes through a sub-popover (Snooze). Needs a local repro. |
| Triage — auto-route on issue creation when triage enabled | 🟡 | Implicitly verified: `createFreshTriageIssue` helper relies on auto-route and the row appears in /triage |
| Labels — CRUD, label groups, archive vs delete | ❌ | None |
| Comments — create / reply / edit / delete / mention / reactions / resolve | 🟡 | `comments.spec.ts` covers create + read-back via direct `commentCreate`. Reply / edit / delete / mention / reactions / resolve still uncovered. |
| Activity timeline (field changes shown on detail panel) | ✅ | `comments.spec.ts` — open detail, change status via `s`, assert timeline entry renders. |
| Notifications — inbox renders | 🟡 | `inbox.spec.ts` smoke only |
| Notifications — mark read / mark all read / snooze / unread count | ❌ | None |
| Notifications — auto-subscribe on assign / mention / create | ❌ | None |
| Documents — CRUD, hierarchy, team/project scope, editor | 🟡 | `documents.spec.ts` — team-scoped create, navigate to editor, title persists across reload. Hierarchy / project-scope / nested children still uncovered. |
| File attachments — upload / display | ❌ | None |
| Keyboard — Cmd+K / Cmd+B / C / J/K / X / Esc | ✅ | Across `keyboard.spec.ts`, `command-palette.spec.ts`, `issue-list.spec.ts`, `bulk-select.spec.ts` |
| Keyboard — chord nav (g i, g n) | ✅ | `chord-navigation.spec.ts` |
| Keyboard — property shortcut catalog (S, P, A, L, D, Q) | ✅ | `issue-properties.spec.ts` covers all six |
| Keyboard — Shift+P (project), Shift+E (estimate), Alt+C (templates) | ⚠️ | Shift+P / Shift+E skipped (no in-row UI for those teams); Alt+C uncovered |
| Sidebar — basic links | ✅ | `navigation.spec.ts` (inbox, projects, backlog, cycles, analytics) |
| Sidebar — team hierarchy / docs tree / custom views list / collapse persistence | ❌ | Only collapse keystroke is tested |
| Theme — dark/light toggle | ✅ | `theme.spec.ts` |
| Theme — system preference / persistence across reload | ❌ | None |
| Real-time sync — cross-tab issue create | ✅ | `sync.spec.ts` |
| Real-time sync — cross-tab status change / archive / create-then-delete | ✅ | `sync.spec.ts` (new) |
| Real-time sync — cross-tab comments / projects / cycles | ❌ | Not covered |
| Offline — create while offline + reconcile | ✅ | `offline.spec.ts` |
| Offline — status change / archive / multi-create queued offline | ✅ | `offline.spec.ts` — all three now active. `TransactionQueue` is IndexedDB-persisted (Dexie `pendingTransactions` table) and rehydrates at app boot via `SyncProvider`. |
| Optimistic update rollback (server rejects mutation) | ✅ | `optimistic-rollback.spec.ts`: forces 500 on createIssue / updateIssue via `page.route` and asserts rollback |
| Delta sync after disconnect window | ❌ | None |
| WebSocket reconnect / auth failure | ❌ | None |
| Analytics dashboard — velocity / cycle time / workload charts render | ❌ | Route is reachable from sidebar but no assertions on charts |
| Templates — issue templates create / apply via Alt+C | ❌ | None |
| Custom fields — define on team, render on detail panel, edit value | 🟡 | `custom-fields.spec.ts` — admin defines a text field, asserts it surfaces in issue detail. Value-edit / filter / CSV export still uncovered. |
| CSV export | ❌ | None |
| Webhooks — create form open + cancel | ✅ | `webhooks.spec.ts` |
| Webhooks — full create persists + appears in list, disable, delete (window.confirm), SSRF-protected URL rejection, invalid-URL validation | ✅ | `webhooks.spec.ts` (extended) |
| Webhooks — actual outbound delivery + HMAC signature + retry-on-failure | ❌ | Out of scope here; needs a local receiver and the 30s retry sweep makes E2E flaky |
| Rate limiting — over-budget responses (UI surfacing) | ❌ | None |
| Roles & permissions — admin-gated routes (webhooks, settings) | ✅ | `permissions.spec.ts` — non-admin gets `FORBIDDEN` on `webhookCreate` and `webhooks` query, admin path is the control, settings page renders without crashing for non-admin. New seed user `e2e-member@test.local` (org role=member) drives the rejection path. |

---

## Highest-Value Gaps

These are the gaps most worth filling first, based on user-impact × regression risk × current absence of automated coverage. Tier 1, Tier 2, and the highest-leverage Tier 3/4 items are addressed.

### Tier 1 — core user paths with no real assertion (addressed)

1. 🟡 **Issue property mutations end-to-end (partial)** — `issue-properties.spec.ts` opens the popover for S/P/A/L/D/Q, commits a value via option-click for S and P (which exercises the resolver → service → SyncAction pipeline), and asserts the popover dismisses on a synthetic outside `mousedown`. **It does not yet read back the post-mutation state** — a row-level or detail-panel assertion that the issue's status/priority/etc. actually changed is still a gap. Bulk priority change (`bulk-actions.spec.ts`) and cross-tab status change (`sync.spec.ts`) cover the read-back side in their own scopes. Shift+P / Shift+E skipped because no in-row UI subscribes to those `openProperty` values today.
2. ✅ **Bulk actions toolbar** — `bulk-actions.spec.ts` covers the multi-select toolbar appearance, bulk archive, and bulk priority change on `/team/<key>/backlog`.
3. ✅ **Cross-tab sync beyond create** — `sync.spec.ts` extended to cover status change, archive, and create-then-delete cross-tab.
4. ✅ **Optimistic update rollback** — `optimistic-rollback.spec.ts` forces 500 on createIssue / updateIssue via `page.route` and asserts the MobX store rolls back.
5. ✅ **Offline coverage beyond create** — `offline.spec.ts` status-change, archive, and multi-create offline tests are now active. Backed by an IndexedDB-persisted `TransactionQueue` (Dexie `pendingTransactions` table) that rehydrates at app boot.

### Tier 2 — recently shipped features (addressed)

6. ✅ **Triage workflow actions** — `triage.spec.ts` Accept / Decline / Mark Duplicate / Snooze are all active. The previous `test.fixme` was a stale `useMemo` cache; replaced with inline computation under the wrapping `observer` so every `optimisticUpdate` re-runs the queue selector.
7. ✅ **Initiatives — beyond create** — `initiatives.spec.ts` extended with row expand panel, link-project flow, and status-change-persists-across-reload. Sub-initiatives, owner, target date, health, and updates timeline still untested.
8. ✅ **Webhooks** — `webhooks.spec.ts` extended with full create + persists in list, disable, delete (handles `window.confirm`), SSRF-protected URL rejection (regex match on the toast), and invalid-URL validation. Actual outbound delivery + HMAC + retry sweep is still uncovered (would need a local receiver and the 30s retry sweep makes E2E flaky).

### Tier 3 — large feature areas (round-3 progress)

9. 🟡 **Comments + activity timeline** — `comments.spec.ts` covers comment-create read-back and an activity-timeline entry after a status change. Reply / edit / delete / mention / reactions / resolve still uncovered.
10. ❌ **Sub-issues + relations** (blocks/blocked-by, duplicate auto-cancel cascade).
11. ❌ **Filter builder + custom views** (save, favorite, default-home, URL share).
12. ❌ **Cycles operations** — assign via Q, burndown chart, rollover.
13. ❌ **Projects beyond create** — milestones, updates, public roadmap visibility, password-gated `/r/[slug]`.
14. 🟡 **Documents** — `documents.spec.ts` covers team-scoped create + editor title-persists. Hierarchy / project-scope / nested children still uncovered.
15. 🟡 **Custom fields** — `custom-fields.spec.ts` covers admin define + render-on-detail. Value-edit / filter / CSV export still uncovered.
16. ❌ **Templates** — Alt+C application.
17. ❌ **Notifications** — mark read, snooze, mention auto-subscribe.
18. ✅ **Search — issue-ID instant jump** — `search-by-id.spec.ts`. Exact identifier hits are promoted to index 0 and Enter falls back to the first item.

### Tier 4 — non-functional / cross-cutting

19. ✅ **Permissions / role gating** — `permissions.spec.ts`. Non-admin gets `FORBIDDEN` on the admin-gated webhook surface; admin control passes; settings page renders without crashing for non-admin.
20. ❌ **Rate-limit UX** — over-budget request surfacing.
21. ❌ **Theme persistence** across reload + system-preference auto-switch.
22. ❌ **WebSocket reconnect** behavior and delta-sync catch-up after a disconnect window.

---

## Coverage by Spec File

After round 3 the suite has 35 spec files / 111 tests with 0 `test.fixme`. The mix has shifted further toward outcome-asserting specs:

- Strong (assert mutation outcome): `issue-crud.spec.ts`, `issue-archive.spec.ts`, `issue-detail.spec.ts`, `projects.spec.ts`, `initiatives.spec.ts`, `sync.spec.ts`, `offline.spec.ts`, `theme.spec.ts`, `bulk-actions.spec.ts`, `optimistic-rollback.spec.ts`, `webhooks.spec.ts`, `triage.spec.ts`, `comments.spec.ts` (new), `search-by-id.spec.ts` (new), `permissions.spec.ts` (new), `documents.spec.ts` (new), `custom-fields.spec.ts` (new).
- Smoke (renders / no runtime error): `backlog.spec.ts`, `cycles.spec.ts`, `inbox.spec.ts`, `team-crud.spec.ts`.
- Plumbing (opens / closes / keystrokes): `command-palette*.spec.ts`, `keyboard.spec.ts`, `chord-navigation.spec.ts`, `view-toggle.spec.ts`, `property-popovers.spec.ts`, `issue-properties.spec.ts`, `issue-context-menu.spec.ts`, `bulk-select.spec.ts`, `team-create.spec.ts`.
- Auth: `auth.spec.ts`, `logout.spec.ts`.

---

## Recommended Next Steps

Tier 1, Tier 2, and the highest-leverage Tier 3/4 picks are addressed. The next-most-leverage gaps are:

1. **Comments — beyond create**: reply, edit, delete, resolve, reactions, mention auto-subscribe.
2. **Sub-issues + relations**: create / nest / auto-close cascade; blocks / blocked-by / duplicate auto-cancel cascade.
3. **Filter builder + custom views**: build, save, favorite, default-home, URL share.
4. **Cycles operations**: assign via `Q`, burndown chart, rollover.
5. **Projects beyond create**: milestones, status updates, public roadmap visibility, password-gated `/r/[slug]`.
6. **Documents — beyond create**: hierarchy (children), project-scoped docs, content roundtrip.
7. **Custom fields — value edit + filter**: edit a field value on an issue and verify filter / column rendering.
8. **WebSocket reconnect / delta-sync catch-up** after a disconnect window.
9. **Theme persistence** across reload + system-preference auto-switch.
