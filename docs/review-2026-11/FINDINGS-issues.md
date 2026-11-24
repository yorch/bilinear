# UX / functionality review — core issue experience (2026-11-24)

Scope: issue list + board, filter/group/display, create modal, issue detail (panel + full page),
pickers, sub-issues, comments, My Issues, backlog, triage, cycles, command palette, shortcuts,
bulk actions, context menu, sidebar, mobile (390px), dark mode.

Method: Playwright against the dev server at 1280×800 and 390×844, light and dark, as
`demo@example.com`. Every finding was verified in the app or the code. No P0 issues; the core loop
(create → list → detail → edit) holds together. What hurts most is **wrong data** (overdue marks on
finished work, cycle scope metrics), **display state that does not persist**, and **dead-end filters**.

## Findings

| ID | Sev | Screen | Problem | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| ISS-01 | P1 | List/board/detail/My Issues | Past due dates render danger-red on Done/Canceled issues | `src/lib/issue-utils.ts:42-62`, `properties/due-date-picker.tsx:45` | Pass state type to `getDueDateColor`; muted when completed/canceled | S |
| ISS-02 | P1 | Cycle detail | Scope creep wrong: `issueUpdate` stamps `addedToCycleAt` even before cycle start (Cycle 2: Planned 0 / Scope creep 14 = 93%); burndown ideal line flat | `issue.service.ts:557-563,830,302`; `triage.service.ts:149`; `analytics.service.ts:354-371`; `cycle.service.ts:459-461` | Count creep only when `addedToCycleAt > cycle.startsAt` | S |
| ISS-03 | P1 | Filters | Project/Cycle/Estimate filters have no picker (free text vs UUID); Due date has no before/after | `filter-builder.tsx:311-330,466-475`; `filter-engine.ts:183-188` | Add value options + date operators | M |
| ISS-04 | P1 | List/board | View mode, group-by, order-by, swimlanes are `useState`; board reverts to list on reload | `team/[key]/page.tsx:87-88`; `use-issue-list-page.ts:103-105` | Persist per team | S |
| ISS-05 | P1 | Issue page | Only Shift+S bound; S/A/P/L/D etc. listed in help do nothing | `issue/[id]/page.tsx:150`; `use-issue-list-page.ts:318-357` | Register same bindings | M |
| ISS-06 | P1 | Detail page + panel | No actions menu; archive/delete only via right-click (unreachable on mobile) | `issue/[id]/page.tsx`, `issue-detail-panel.tsx`, `issue-context-menu.tsx:148-241` | Add ⋯ menu | S |
| ISS-07 | P1 | Detail | Cannot set/change parent of an existing issue | parentId written only in `sub-issue-list.tsx:252` | "Set parent…" + "Add existing" | M |
| ISS-08 | P1 | Sub-issues | Creation awaits server (hangs offline); bypasses `useIssueCreate` | `sub-issue-list.tsx:237-265` | Use `useIssueCreate` | S |
| ISS-09 | P1 | Bulk bar | No Cycle/Project/Due date/Move/Delete | `bulk-action-bar.tsx:67-237` | Add popovers | M |
| ISS-10 | P2 | Bulk bar | Covers last rows; cramped card at 390px | `bulk-action-bar.tsx:49` | `pb-20`; full-width mobile bar | S |
| ISS-11 | P2 | Filters | Form ignores Escape/outside click | `filter-builder.tsx:376-500` | Claim Escape + outside click | S |
| ISS-12 | P2 | Group/Order dropdowns | Options wrap & centre; no checkmark | `ui/select.tsx:99,111-125` | `w-max whitespace-nowrap text-left` + Check | S |
| ISS-13 | P2 | List display | No project/cycle/label grouping; no hide-completed | `issue-list-view.tsx:22` | Add group keys + completed option | M |
| ISS-14 | P2 | Team list | Un-triaged issues appear in main list/board | `team/[key]/page.tsx:126-140` | Exclude triage state when triage enabled | S |
| ISS-15 | P2 | Detail | Cycle name rendered twice | `issue-detail-content.tsx:298-309` | Delete trailing span | S |
| ISS-16 | P2 | Sidebar | On `/issue/[id]` expands first team, not issue's team | `sidebar.tsx:384-391` | Derive from issue.teamId | S |
| ISS-17 | P2 | Sidebar | Team order unstable (Map insertion order) | `team-store.ts:17-19`; `sidebar.tsx:361-373` | Sort by createdAt | S |
| ISS-18 | P2 | Context menu | Missing project/cycle/due/estimate, sub-issue, duplicate, copy MD, move | `issue-context-menu.tsx:148-241` | Add submenus | M |
| ISS-19 | P2 | List rows 1280 | Label/cycle columns truncate to "Fea…" | `issue-row.tsx:170-185` | One label + "+N"; cycle as "C2" | S |
| ISS-20 | P2 | Mobile list | 14×14 checkboxes; ~230px chrome above first row | `issue-row.tsx:246-253` | 44px hit area; Display sheet | S |
| ISS-21 | P2 | Backlog | No group/order/save-view; overlaps Todo | `team/[key]/backlog/page.tsx:34,161-170` | Reuse team controls | S |
| ISS-22 | P2 | My Issues | No Subscribed tab / display controls | `my-issues/page.tsx:34,50,181-182` | Add scope | S |
| ISS-23 | P2 | Triage | Hand-rolled snooze menu; Escape not claimed; Duplicate trigger looks disabled | `triage/page.tsx:94-135,543-551` | Use `SelectPopover` | S |
| ISS-24 | P2 | Shortcuts/a11y | Sidebar tooltip "⌘B" on all OS; j/k selection has no `aria-selected` | `locales/en.json:1320,1325`; `issue-row.tsx:213-236` | Interpolate modKey; ARIA | S |
| ISS-25 | P2 | Nav shortcuts | Only G I / G N; no team backlog/cycles chords | `workspace-client.tsx:58-59` | Add chords + palette entries | S |
| ISS-26 | P2 | Mobile detail | Ten property rows precede description | `issue/[id]/page.tsx` | Chip row below `md` | M |

Verified working: create-modal draft persistence + Mod+Enter, bottom-sheet on mobile, triage J/K/A/D/S/M
flow, dark-mode contrast, no horizontal scroll at 390px.

## Top 10 to fix first (impact ÷ effort)

1. **ISS-01** — `getDueDateColor(dueDate, stateType?)`: muted for completed/canceled; thread state type through `DueDatePicker` from row, detail and board card. Add a test that fails without the guard.
2. **ISS-15** — delete `issue-detail-content.tsx:305-309` and the unused `currentCycle` import.
3. **ISS-02** — scope creep = `addedToCycleAt > cycle.startsAt` in analytics and burndown; add service tests.
4. **ISS-04** — `useListDisplayPrefs(teamKey)` (localStorage, try/catch) for viewMode/groupBy/orderBy/swimlane.
5. **ISS-06** — extract `useIssueMenuItems(issue)`; ⋯ button in detail page header and panel.
6. **ISS-03** — project/cycle/estimate value options; before/after/overdue operators + tests.
7. **ISS-08** — route sub-issue creation through `useIssueCreate`.
8. **ISS-09 / ISS-10** — Cycle/Project/Due date in bulk bar; bottom padding while selecting.
9. **ISS-12 / ISS-11** — dropdown nowrap + checkmark; filter form Escape + outside click.
10. **ISS-16 / ISS-17** — sidebar active team from issue; stable team sort.
