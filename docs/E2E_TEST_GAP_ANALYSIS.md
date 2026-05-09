# E2E Test Gap Analysis

_Generated 2026-05-09 against branch `claude/e2e-test-gap-analysis-YHpZP`._

This document compares the existing Playwright E2E suite (`tests/e2e/`, 27 spec files / 76 tests) against the full feature surface of the product (PRD, PATTERNS.md, shipped routes, services, and Prisma models). Each domain lists what is covered, what is partially covered, and what has no E2E coverage today.

Legend: ✅ covered · 🟡 partial / smoke only · ❌ not covered

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
| Issues — bulk select | 🟡 | One row toggle + X to clear; no bulk action toolbar tests (status/priority/assignee/labels/project/cycle/archive/delete in bulk) |
| Issues — context menu | 🟡 | Open + Esc only; no actual menu actions exercised |
| Issues — archive (single) | ✅ | `issue-archive.spec.ts` (Backspace) |
| Issues — unarchive / soft-delete / permanent delete / trash recovery | ❌ | None |
| Issues — set status via S | 🟡 | `keyboard.spec.ts` opens selector but doesn't pick |
| Issues — set priority via P | 🟡 | Same — opens selector only |
| Issues — set assignee (A), labels (L), due date (D), estimate (Shift+E), project (Shift+P), cycle (Q), templates (Alt+C) | ❌ | No coverage; only S and P shortcuts open the popover |
| Issues — property popovers select-and-dismiss | ✅ | `property-popovers.spec.ts` (status, priority) |
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
| Initiatives — link projects, sub-initiatives, updates, owner, target date, health | ❌ | None |
| Triage — page renders | 🟡 | `triage.spec.ts` smoke only |
| Triage — accept / decline / duplicate / snooze actions | ❌ | None |
| Triage — auto-route on issue creation when triage enabled | ❌ | None |
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
| Keyboard — full property shortcut catalog (A, L, D, Shift+E, Shift+P, Q, Alt+C) | ❌ | Only S and P are tested |
| Sidebar — basic links | ✅ | `navigation.spec.ts` (inbox, projects, backlog, cycles, analytics) |
| Sidebar — team hierarchy / docs tree / custom views list / collapse persistence | ❌ | Only collapse keystroke is tested |
| Theme — dark/light toggle | ✅ | `theme.spec.ts` |
| Theme — system preference / persistence across reload | ❌ | None |
| Real-time sync — cross-tab issue create | ✅ | `sync.spec.ts` |
| Real-time sync — cross-tab updates (status, assignee, comments, projects, cycles) | ❌ | Only create is asserted |
| Offline — create while offline + reconcile | ✅ | `offline.spec.ts` |
| Offline — update / delete / multiple queued mutations / rollback on server error | ❌ | None |
| Optimistic update rollback (server rejects mutation) | ❌ | None |
| Delta sync after disconnect window | ❌ | None |
| WebSocket reconnect / auth failure | ❌ | None |
| Analytics dashboard — velocity / cycle time / workload charts render | ❌ | Route is reachable from sidebar but no assertions on charts |
| Templates — issue templates create / apply via Alt+C | ❌ | None |
| Custom fields — define on team, render on detail panel, edit value | ❌ | None |
| CSV export | ❌ | None |
| Webhooks — create form open + cancel | ✅ | `webhooks.spec.ts` |
| Webhooks — full create / list / edit / archive / delivery + retry / signature verification | ❌ | None |
| Rate limiting — over-budget responses (UI surfacing) | ❌ | None |
| Roles & permissions — admin-gated routes (webhooks, settings) | ❌ | None |

---

## Highest-Value Gaps

These are the gaps most worth filling first, based on user-impact × regression risk × current absence of automated coverage.

### Tier 1 — core user paths with no real assertion

1. **Issue property mutations end-to-end.** S/P open the popover but no test selects a value and asserts the issue mutated, the SyncAction was emitted, and the list refreshes. Same for assignee (A), labels (L), due date (D), estimate (Shift+E), project (Shift+P), cycle (Q). One parameterised spec can cover all property popovers.
2. **Bulk actions toolbar.** `bulk-select.spec.ts` only toggles the checkbox. No test exercises bulk status / priority / assignee / labels / archive / delete — high-blast-radius operations.
3. **Cross-tab sync beyond create.** `sync.spec.ts` only covers issue creation. Status changes, assignee changes, deletes, comment additions, project / cycle updates all flow through the same SyncAction → WS path but are unverified.
4. **Optimistic update rollback.** No test forces a server error (e.g. via route stubbing) and asserts the MobX store rolls back and a toast surfaces. This is the single most fragile invariant in the client.
5. **Offline coverage beyond create.** Updates and deletes queued offline are not tested. Multiple queued mutations + reconciliation order is not tested.

### Tier 2 — recently shipped features (per CLAUDE.md "Recently shipped")

6. **Triage workflow actions.** Smoke test exists, but accept / decline / duplicate / snooze are the entire feature and have no assertions. Auto-routing of new issues into triage state when team has triage enabled is also untested.
7. **Initiatives — beyond create.** Linking projects (the m:n join that defines progress rollup) is untested. Sub-initiatives, updates, owner/target/health are untested.
8. **Webhooks — actual delivery.** Form open/cancel is tested but no test verifies the full create → event-emitted → outbound POST → HMAC signature → retry-on-failure path. Given SSRF and signing logic, this is a security-relevant gap. (May need a local webhook receiver test fixture.)

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

Existing 27 spec files focus mostly on **navigation, rendering, and keyboard plumbing**, with relatively few that drive a mutation through to a server-confirmed state change:

- Strong (assert mutation outcome): `issue-crud.spec.ts`, `issue-archive.spec.ts`, `issue-detail.spec.ts` (inline title), `projects.spec.ts`, `initiatives.spec.ts`, `sync.spec.ts`, `offline.spec.ts`, `theme.spec.ts`.
- Smoke (renders / no runtime error): `backlog.spec.ts`, `cycles.spec.ts`, `inbox.spec.ts`, `triage.spec.ts`, `team-crud.spec.ts`.
- Plumbing (opens / closes / keystrokes): `command-palette*.spec.ts`, `keyboard.spec.ts`, `chord-navigation.spec.ts`, `view-toggle.spec.ts`, `property-popovers.spec.ts`, `issue-context-menu.spec.ts`, `bulk-select.spec.ts`, `team-create.spec.ts`, `webhooks.spec.ts`.
- Auth: `auth.spec.ts`, `logout.spec.ts`.

The pattern across the suite is "open the UI affordance, dismiss it, move on." Filling Tier 1 and Tier 2 gaps would meaningfully strengthen the suite without large new fixtures — most reuse the existing `loginAs` + seeded org/team/issue.

---

## Recommended Next Step

Open a tracking issue with the Tier 1 list and pick **issue property mutations** + **optimistic rollback** as the first two PRs — they are the highest-leverage tests and exercise the resolver → service → SyncAction → WS pipeline that nearly every other feature also depends on.
