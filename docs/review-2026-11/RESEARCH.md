# Competitive and UX Research (2026-11-24)

Scope: what is worth adopting in bilinear. Sources are pages actually fetched on 2026-11-24.
Legend: **V** = verified from a fetched page; **U** = unverified (not fetched or page 404; treat as a lead only).
Effort: S = under half a day, M = about 1-2 days, L = more than 2 days.

Coverage notes: Height, Shortcut, Notion Projects, Fibery and the Jira overhaul could not be verified
(Jira URL 404, Fibery redirect not followed, others not fetched). Huly's repo is frozen and its hosted
service is shut down (V), so treat it as a feature reference only. Linear "project updates" doc 404'd, but
update/health behaviour is verified via the Initiatives page. Several Linear AI features are Business/Enterprise-gated.

## 1. Feature table

| # | Feature | Source | What it is | Why users value it | Effort | Link | Status |
|---|---------|--------|-----------|--------------------|--------|------|--------|
| 1 | Triage Intelligence: duplicate suggestions | Linear | Issues in Triage that are semantically similar to existing ones get a "link as duplicate" suggestion with hover reason; accept/dismiss | Cuts duplicate noise at intake, reasoning is visible | M (pgvector or FTS similarity + chip UI) | https://linear.app/docs/triage-intelligence | V |
| 2 | Triage property suggestions (team, project, assignee, labels) with per-property show/hide/auto-apply | Linear | Suggestions from historical trends; admin chooses mode per property; custom guidance text at workspace/team level | Faster routing, human stays in control | M-L | https://linear.app/docs/triage-intelligence | V |
| 3 | Triage keyboard actions: 1 accept, 2 decline, 3/MM duplicate, H snooze | Linear | Single-key triage; duplicate merge moves attachments to original; snooze until time or new activity | Inbox-zero triage with no mouse | S | https://linear.app/docs/triage | V |
| 4 | Triage responsibility rotation | Linear | Round-robin assignment/notify of triagers; skips inactive/out-of-office; optional on-call schedule sync | Intake never falls on one person | M | https://linear.app/docs/triage | V |
| 5 | Asks (Slack /ask, email, web form to issue) | Linear | Internal requests become issues in team Triage; replies stay synced across Slack/email/Linear | Non-Linear users can file work | M (you already have Slack integration) | https://linear.app/docs/linear-asks | V |
| 6 | Pulse feed + daily/weekly digest | Linear | Feed of project/initiative updates (For me / Popular / Recent) plus summaries delivered to Inbox ~6am | Stakeholders follow progress without opening projects | M | https://linear.app/docs/pulse | V |
| 7 | Insights (Measure, Slice, Segment; click to drill to table; CSV export) | Linear | Ad hoc charts on any filtered view: count, effort, cycle time, lead time, age | Self-serve analytics, shareable by link | M | https://linear.app/docs/insights | V |
| 8 | Project graph with scope line and predicted completion (optimistic/pessimistic ~40%) | Linear | Burn-up with scope creep line, target date marker, velocity-based forecast | Early risk detection | M | https://linear.app/docs/project-graph | V |
| 9 | Customer requests (customers, importance flag, filter by tier/revenue) | Linear | Links feedback to issues/projects; customer pages; sort work by customer count/revenue | Prioritise by real demand | L | https://linear.app/docs/customer-requests | V |
| 10 | Initiative health, sub-initiatives, team-led initiatives, status Proposed/Planned/Active/Completed/Canceled | Linear | Health comes from latest update; roll-up of project update colours | One-glance portfolio view | M | https://linear.app/docs/initiatives | V |
| 11 | Inbox Priority/Other tabs, snooze (H), mark unread (U), delete read (Shift+Backspace), 2,000 cap | Linear | Notification triage with unread-first and grouped display options | Notification overload control | S-M | https://linear.app/docs/inbox | V |
| 12 | Agent delegation and @mention | Linear | Assign an issue to an agent (still shown in My issues) or @mention in comment | AI as a first-class assignee | L | https://linear.app/docs/agents-in-linear | V |
| 13 | Loops (agent runs triggered by Slack/GitHub/initiative/cycle changes; workspace templates) | Linear | Reusable automations that respond to PM events and post Slack updates | Automates status chasing | L | https://linear.app/changelog | V (changelog only, details unverified) |
| 14 | Priority inbox tab (Sep 2026) and mobile Diffs (Nov 2026) | Linear | Recent changelog items | Shows direction: mobile + review | n/a | https://linear.app/changelog | V |
| 15 | GitHub Projects: saved views (table/board/roadmap), up to 50 custom fields, insights charts, built-in workflows, status updates On track/At risk | GitHub | High-density table, slice/group, automation by field changes | Familiar spreadsheet-like power view | M | https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects | V |
| 16 | Plane: percent/currency formatting for number properties | Plane | Display format without changing stored value | Custom fields feel native | S | https://plane.so/changelog | V |
| 17 | Plane: initiative progress rolled up from selected work item types only | Plane | Roll-up filter by type | Accurate progress when mixed types | S-M | https://plane.so/changelog | V |
| 18 | Plane: Development panel (branches, commits, PRs on item) | Plane | Git artefacts shown on item | Context without leaving the issue | S (if GitHub integration already stores links) | https://plane.so/changelog | V |
| 19 | Plane: subscribe to Pages (email on edits/comments); dashboard widgets inside Pages | Plane | Doc-level watch; embedded charts | Docs become living status pages | M | https://plane.so/changelog | V |
| 20 | Plane: synced blocks (reuse content across pages) | Plane | Single source block | DRY docs | L (Yjs) | https://plane.so/changelog | V |
| 21 | Reminders on issues, docs, projects, initiatives | Linear | Notify at chosen time, shown atop item | Personal follow-up without external tool | S-M | https://linear.app/docs/inbox | V |

## 2. Ranked shortlist (each scoped to a few hours on the existing stack)

1. **Single-key triage actions (1/2/3/MM/H) + snooze-until-activity.** Bind in the keyboard-chord layer on the triage view; accept = move to team default status, decline = Canceled with optional comment, duplicate = reuse existing merge flow (move attachments, cancel). Every action goes through existing mutations so SyncActions are created. Add chord entries to command palette. (#3)
2. **Inbox Priority/Other tabs + snooze + mark-unread.** Priority = mentions, assignments, and status changes on subscribed items; Other = rest. Reuse the snooze mechanism from item 1. Persist tab choice in user prefs; add an unread-first display option. (#11)
3. **Duplicate suggestions on new triage issues.** Start with Postgres FTS/trigram on title+description (no model), show top 3 as chips with accept/dismiss and a "why" tooltip (matching terms). Leave an interface so embeddings can replace the scorer later. (#1)
4. **Issue reminders.** One `Reminder` model (userId, entityType, entityId, fireAt), a background job emitting an inbox notification, command-palette action "Remind me...". Register the poll interval via `defineSetting`. (#21)
5. **Insights v0: Measure x Slice on any saved view.** Reuse analytics queries; a drawer on views with Measure (count, cycle time, lead time, age), Slice (assignee, label, status, week), click-bar-to-filter, CSV export. (#7)
6. **Project burn-up with scope line and forecast.** Daily snapshot or compute from SyncAction history; scope line, completed line, target-date marker, naive velocity forecast (last 4 weeks) with optimistic/pessimistic band. (#8)
7. **Initiative health roll-up.** Derive colour from latest project updates (green/yellow/red/gray) and show an Active Projects column on the initiatives list; add a Proposed to Canceled status set if missing. (#10)
8. **Custom-field number display formats (percent, currency, decimals).** Display-only formatter stored in field config; zero migration risk to data. Pairs with GitHub-style saved views. (#16)

Deferred as too large for a few hours: customer requests (#9), agents/Loops (#12-13), triage property suggestions (#2), synced blocks (#20).

## 3. UX heuristics checklist for reviewers

Basis: NN/g ten heuristics (https://www.nngroup.com/articles/ten-usability-heuristics/, V) and WCAG 2.2 new criteria
(https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/, V). Items marked (opinion) are general practice, not verified to a specific source.

1. **System status.** Every async write shows state (pending, synced, failed). Offline/reconnecting is visible without opening a menu. (NN/g 1)
2. **Undo over confirm.** Reversible actions (status, assignee, archive) show a toast with Undo; confirm dialogs only for destructive and irreversible ones. (NN/g 3, 5)
3. **Keyboard parity.** Every mouse action has a key or command-palette entry; shortcuts are shown in tooltips and menus. (NN/g 7)
4. **Chord discoverability.** After pressing a chord prefix (G, O), show available continuations. (opinion)
5. **Focus visibility.** Focused element is never fully hidden by sticky headers, panels or toasts (WCAG 2.4.11 AA); focus ring is visible in light and dark themes.
6. **Target size.** Pointer targets at least 24x24 CSS px or sufficiently spaced (WCAG 2.5.8 AA); check dense list rows and icon buttons.
7. **No drag-only actions.** Kanban reorder, roadmap resize and priority sort have a click/menu/keyboard alternative (WCAG 2.5.7 AA).
8. **No redundant entry.** Forms prefill known values (team, project, last-used labels); creation dialogs remember defaults (WCAG 3.3.7 A).
9. **Accessible sign-in.** Magic-link/code entry allows paste and password-manager autofill, with no cognitive puzzles (WCAG 3.3.8 AA).
10. **Dense but scannable lists.** One line per issue, fixed column alignment, truncation with tooltip, group headers with counts; verify at 200+ rows. (opinion)
11. **Empty states teach.** Each empty list states what the thing is, shows one primary action and its shortcut, and distinguishes "nothing yet" from "filtered to nothing" with a clear-filters action. (NN/g 6, 9; opinion on specifics)
12. **Bulk edit.** Multi-select via checkbox and shift-range; a floating bar shows count and the common actions; operation is undoable as a single unit. (opinion)
13. **Saved filters.** Active filters are always visible as removable chips; "modified view" state is shown with save/reset; share link reproduces the view. (NN/g 1, 6)
14. **Error messages.** Name the problem and next step in plain language; optimistic rollbacks explain what was reverted. (NN/g 9)
15. **Mobile and PWA.** Core flows (create, triage, comment, inbox) work at 360px with thumb-reachable actions; no hover-only controls; offline create is queued and indicated.
16. **Notifications.** Separate "needs me" from "FYI"; snooze and mark-unread exist; badge count is configurable. (Linear inbox pattern, V)

## 4. Unverified leads (not fetched; do not rely on)
- Jira recent UX overhaul (atlassian.com URL returned 404).
- Fibery, Height, Shortcut, Notion Projects: no page successfully read.
- Any claims about AI auto-labelling quality or summarisation benchmarks: not researched; Linear's auto-label behaviour is verified only as "suggestions based on historical trends" (#2).
