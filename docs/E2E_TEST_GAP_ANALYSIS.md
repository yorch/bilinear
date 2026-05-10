# E2E Test Gap Analysis

_Initial analysis: 2026-05-09. Updated after Tier 1 + Tier 2 closure on the same branch._

This document compares the Playwright E2E suite against the full feature surface of the product (PRD, PATTERNS.md, shipped routes, services, and Prisma models).

## Status snapshot

| Metric | Before | After |
| --- | ---: | ---: |
| Spec files | 27 | 30 |
| Tests | 76 | 104 (28 new) |
| Tier 1 gaps closed | 0 / 5 | 3 closed + 1 partial + 1 fixme |
| Tier 2 gaps closed | 0 / 3 | 2 closed + 1 fixme |
| Final full-suite result | n/a | **94 passed / 10 skipped / 0 failed** (chromium, ~3 min) |

**Tier 1 #1 ("issue property mutations end-to-end") is _partial_, not closed**: the new `issue-properties.spec.ts` exercises S/P/A/L/D/Q popover open + commit (the option click commits the mutation through the resolver/service path) and verifies the popover dismisses cleanly. It does NOT read back the issue's post-mutation state — a row-level / detail-panel read-back is still a coverage gap. Bulk priority change (`bulk-actions.spec.ts`) and cross-tab status change (`sync.spec.ts`) DO assert the post-mutation state in their own scopes.

Three new specs added: `issue-properties.spec.ts`, `bulk-actions.spec.ts`, `optimistic-rollback.spec.ts`. Five existing specs extended: `sync.spec.ts`, `offline.spec.ts`, `initiatives.spec.ts`, `triage.spec.ts`, `webhooks.spec.ts`. Seed (`prisma/seed.ts`) updated to enable triage on ENG and add a Triage workflow state plus three triage-state issues so triage tests have queued items.

### Tracked product limitations

The new tests surfaced two real product limitations, captured as `test.fixme`:

1. **Offline mutations don't survive `page.reload()`.** `TransactionQueue` is in-memory and per-component-mount with a 14s retry budget (1s + 3s + 10s). If the queue doesn't drain before reload, the offline mutation is lost. Affects status-change-offline, archive-offline, and multi-create-offline tests. Fix: persist the queue to IndexedDB.
2. **Triage actions on API-bootstrapped issues don't optimistically remove the row.** Accept / Decline / Mark Duplicate / Snooze work on issues present at sync-bootstrap, but for an issue inserted after bootstrap (via post-login GraphQL `issueCreate`), the optimistic update doesn't propagate to the queue render within the assertion window. Needs investigation of `issueStore.optimisticUpdate` interaction with newly-bootstrapped issues.

Two issue-row hotkeys are also skipped because they have no in-row UI to drive: `Shift+P` (project) and `Shift+E` (estimate, which only renders when the team has an `estimationType`). The hotkey sets `openProperty` on the page but no in-row component subscribes.

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
| Search — issue ID instant jump | ❌ | None |
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
| Triage — accept / decline / duplicate / snooze actions | ⚠️ | `test.fixme` — buttons fire but optimistic remove on API-bootstrapped rows doesn't propagate in time. Works on seed-time rows. Needs investigation. |
| Triage — auto-route on issue creation when triage enabled | 🟡 | Implicitly verified: `createFreshTriageIssue` helper relies on auto-route and the row appears in /triage |
| Labels — CRUD, label groups, archive vs delete | ❌ | None |
| Comments — create / reply / edit / delete / mention / reactions / resolve | ❌ | None |
| Activity timeline (field changes shown on detail panel) | ❌ | None |
| Notifications — inbox renders | 🟡 | `inbox.spec.ts` smoke only |
| Notifications — mark read / mark all read / snooze / unread count | ❌ | None |
| Notifications — auto-subscribe on assign / mention / create | ❌ | None |
| Documents — CRUD, hierarchy, team/project scope, editor | ❌ | None |
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
| Offline — status change / archive / multi-create queued offline | ⚠️ | `test.fixme` — TransactionQueue is in-memory; `page.reload()` drops queued mutations. Needs IndexedDB persistence. |
| Optimistic update rollback (server rejects mutation) | ✅ | `optimistic-rollback.spec.ts`: forces 500 on createIssue / updateIssue via `page.route` and asserts rollback |
| Delta sync after disconnect window | ❌ | None |
| WebSocket reconnect / auth failure | ❌ | None |
| Analytics dashboard — velocity / cycle time / workload charts render | ❌ | Route is reachable from sidebar but no assertions on charts |
| Templates — issue templates create / apply via Alt+C | ❌ | None |
| Custom fields — define on team, render on detail panel, edit value | ❌ | None |
| CSV export | ❌ | None |
| Webhooks — create form open + cancel | ✅ | `webhooks.spec.ts` |
| Webhooks — full create persists + appears in list, disable, delete (window.confirm), SSRF-protected URL rejection, invalid-URL validation | ✅ | `webhooks.spec.ts` (extended) |
| Webhooks — actual outbound delivery + HMAC signature + retry-on-failure | ❌ | Out of scope here; needs a local receiver and the 30s retry sweep makes E2E flaky |
| Rate limiting — over-budget responses (UI surfacing) | ❌ | None |
| Roles & permissions — admin-gated routes (webhooks, settings) | ❌ | None |

---

## Highest-Value Gaps

These are the gaps most worth filling first, based on user-impact × regression risk × current absence of automated coverage. Tier 1 and Tier 2 were addressed on this branch; Tier 3 and Tier 4 remain.

### Tier 1 — core user paths with no real assertion (addressed)

1. 🟡 **Issue property mutations end-to-end (partial)** — `issue-properties.spec.ts` opens the popover for S/P/A/L/D/Q, commits a value via option-click for S and P (which exercises the resolver → service → SyncAction pipeline), and asserts the popover dismisses on a synthetic outside `mousedown`. **It does not yet read back the post-mutation state** — a row-level or detail-panel assertion that the issue's status/priority/etc. actually changed is still a gap. Bulk priority change (`bulk-actions.spec.ts`) and cross-tab status change (`sync.spec.ts`) cover the read-back side in their own scopes. Shift+P / Shift+E skipped because no in-row UI subscribes to those `openProperty` values today.
2. ✅ **Bulk actions toolbar** — `bulk-actions.spec.ts` covers the multi-select toolbar appearance, bulk archive, and bulk priority change on `/team/<key>/backlog`.
3. ✅ **Cross-tab sync beyond create** — `sync.spec.ts` extended to cover status change, archive, and create-then-delete cross-tab.
4. ✅ **Optimistic update rollback** — `optimistic-rollback.spec.ts` forces 500 on createIssue / updateIssue via `page.route` and asserts the MobX store rolls back.
5. ⚠️ **Offline coverage beyond create** — written but `test.fixme` because `TransactionQueue` is in-memory and per-component-mount with a 14s retry budget. `page.reload()` discards queued mutations. Needs IndexedDB persistence to test end-to-end.

### Tier 2 — recently shipped features (per CLAUDE.md "Recently shipped") (addressed)

6. ⚠️ **Triage workflow actions** — `triage.spec.ts` extended with Accept / Decline / Mark Duplicate / Snooze tests, all marked `test.fixme`. Buttons fire and the mutation reaches the server, but the optimistic queue removal doesn't propagate within the assertion window for issues created via post-login GraphQL `issueCreate`. Auto-routing of new issues into the triage state is implicitly verified by the `createFreshTriageIssue` helper. Smoke test confirms queue / counter / Accept buttons render.
7. ✅ **Initiatives — beyond create** — `initiatives.spec.ts` extended with row expand panel, link-project flow, and status-change-persists-across-reload. Sub-initiatives, owner, target date, health, and updates timeline still untested.
8. ✅ **Webhooks** — `webhooks.spec.ts` extended with full create + persists in list, disable, delete (handles `window.confirm`), SSRF-protected URL rejection (regex match on the toast), and invalid-URL validation. Actual outbound delivery + HMAC + retry sweep is still uncovered (would need a local receiver and the 30s retry sweep makes E2E flaky).

### Tier 3 — large feature areas with no coverage

9. **Comments + activity timeline** — entire surface unexercised.
10. **Sub-issues + relations** (blocks/blocked-by, duplicate auto-cancel cascade).
11. **Filter builder + custom views** (save, favorite, default-home, URL share).
12. **Cycles operations** — assign via Q, burndown chart, rollover.
13. **Projects beyond create** — milestones, updates, public roadmap visibility, password-gated `/r/[slug]`.
14. **Documents** — entire feature.
15. **Custom fields** — define, value edit, filter, CSV export.
16. **Templates** — Alt+C application.
17. **Notifications** — mark read, snooze, mention auto-subscribe.
18. **Search** — issue-ID instant jump (`ENG-123` → opens issue) is the marquee search behavior and is uncovered.

### Tier 4 — non-functional / cross-cutting

19. **Permissions / role gating** — admin-only routes (webhooks, org settings) accessed by member/guest should redirect or 403.
20. **Rate-limit UX** — over-budget request surfacing.
21. **Theme persistence** across reload + system-preference auto-switch.
22. **WebSocket reconnect** behavior and delta-sync catch-up after a disconnect window.

---

## Coverage by Spec File

After Tier 1 + Tier 2 closure the suite has 30 spec files / 104 tests. The mix has shifted toward outcome-asserting specs:

- Strong (assert mutation outcome): `issue-crud.spec.ts`, `issue-archive.spec.ts`, `issue-detail.spec.ts` (inline title), `projects.spec.ts`, `initiatives.spec.ts`, `sync.spec.ts`, `offline.spec.ts`, `theme.spec.ts`, `bulk-actions.spec.ts` (new), `optimistic-rollback.spec.ts` (new), `webhooks.spec.ts` (extended).
- Smoke (renders / no runtime error): `backlog.spec.ts`, `cycles.spec.ts`, `inbox.spec.ts`, `team-crud.spec.ts`.
- Plumbing (opens / closes / keystrokes): `command-palette*.spec.ts`, `keyboard.spec.ts`, `chord-navigation.spec.ts`, `view-toggle.spec.ts`, `property-popovers.spec.ts`, `issue-properties.spec.ts` (new), `issue-context-menu.spec.ts`, `bulk-select.spec.ts`, `team-create.spec.ts`, `triage.spec.ts` (smoke + 4 fixme).
- Auth: `auth.spec.ts`, `logout.spec.ts`.

---

## Recommended Next Steps

Tier 1 and Tier 2 are addressed. The next-most-leverage gaps are:

1. **Resolve the two `test.fixme` cases** — IndexedDB-persisted `TransactionQueue` (unblocks 3 offline tests) and the triage-actions optimistic-update interaction (unblocks 4 triage tests).
2. **Pick from Tier 3** — comments + activity timeline (entire feature unexercised), sub-issues + relations, filter builder + custom views, search-by-issue-ID, projects beyond create.
3. **Tier 4 cross-cutting** — admin-only route gating, theme persistence, WebSocket reconnect / delta-sync catch-up.
