# Small-items screenshot pass (2026-11-25)

Environment: production build at http://localhost:3000, workspace `demo`, DB `bilinear_shots`.
Signed in as demo@example.com (desktop/mobile issue pages, bulk, toast) and e2e@test.local (admin).

Environment notes that affect the captures:
- Postgres 16 cluster `main` was stopped and was started. Redis was stopped and was started.
- The WebSocket sync server (ws://localhost:3001) is NOT running. Every issue page shows "Reconnecting..." in the sidebar and logs repeated WebSocket errors to ws://localhost:3001. These are environment noise, not app regressions. Real-time sync was not exercised.
- Data changes made by this pass: ENG-1 due date set to Nov 26. ENG-11, ENG-33 and ENG-43 moved from Engineering to Operations (they become OPS-20, OPS-21 and so on). Those moves are persistent in `bilinear_shots`.

## Verdicts for items 1-5

1. Mobile ENG-1 chips: **partly fixed.** Short labels now appear (Project, Cycle, Set parent..., Start date, Due date). With a due date set, the chip reads "Due dateNov 26" with no space and no chip styling, on its own line below the row. This is still broken.
2. Due-date picker: **desktop fixed, mobile still broken for the set state.** Desktop with a date set: the Nov 26 day button takes focus, Enter is pressed, and the date stays Nov 26 (not cleared). Desktop with no date: the YYYY-MM-DD input has focus. Mobile 390px with a date set: the popover runs off the left edge, cutting the Today/Tomorrow column and the left part of the calendar (Sun/Mon/Tue cut). Mobile 390px with no date: fits fully.
3. Bulk bar, More -> Due date: **fixed.** At 390x844 and 375x667 the full month grid (1-30), "Clear date" and the bulk bar ("3 selected") are visible. The sheet has a close (X) control in its header. Rows behind the sheet are covered by it rather than removed.
4. Info toast "Label removed...": **fixed.** Toast text: "Moved. Label removed because it doesn't exist in the new team: frontend-regression". Computed opacity is 1 at capture time (1.2s after appearing) in desktop light, desktop dark and mobile light. The mobile toast sits over the bottom of the issue page and is readable.
5. Admin area: **no console or page errors on any admin page.** Mobile tables scroll sideways inside their containers and clip columns (see admin-users and admin-tenants mobile). The users Actions column (Impersonate / Make admin / Suspend) is off-screen on mobile. The top nav is also clipped at 390px ("Co..." for Configuration).

## Per-file

Console errors listed as "WS only" means the only console errors were the ws://localhost:3001 connection failures described above.

### Item 1: ENG-1 issue detail
- `issue-ENG-1-no-due-mobile-light.png` | /demo/issue/f09ef2bb-75db-4092-a985-e83941eda130 (390x844) | Mobile. Second chip row: Project, Cycle, Set parent..., Start date. "Due date" wraps to a third line. Short labels are shown. | Console: WS only.
- `issue-ENG-1-due-set-mobile-light.png` | same route, after setting due date to Nov 26 via the picker (390x844) | Shows "Due dateNov 26" as plain text on its own line, no space between label and value, no chip styling. | Console: WS only.
- `issue-ENG-1-desktop-light.png` | same route (1280x800) | Desktop sidebar detail, Due date value "Nov 26" in the properties column. Layout unchanged. | Console: WS only.
- `issue-ENG-1-desktop-dark.png` | same route (1280x800, dark) | Same layout in dark, due date "Nov 26" visible in accent colour. | Console: WS only.

### Item 2: due-date picker
- `due-picker-set2-desktop-light.png` | ENG-1, desktop 1280x800 | Picker open with date set. Focus on the Nov 26 day button (aria "Thursday, November 26, 2026"). Shortcuts and calendar visible. | Console: none.
- `due-picker-set2-after-enter-desktop-light.png` | ENG-1 after pressing Enter | Date still "Nov 26" after Enter. Not cleared. | Console: none.
- `due-picker-none11-desktop-light.png` | ENG-11 (no due date), desktop | Picker open. Typed-entry YYYY-MM-DD input has focus. Calendar visible. | Console: none.
- `due-picker-set-m-mobile-light.png` | ENG-1, 390x844 | Picker is clipped off the left edge: Today/Tomorrow date column and left calendar columns are cut. Does NOT fit. | Console: none.
- `due-picker-none-m-mobile-light.png` | ENG-11, 390x844 | Picker fits: shortcuts, typed input (focused), full month grid through 30. | Console: none.

### Item 3: bulk bar on /demo/team/ENG
- `bulk-bar-selected-390x844.png` | /demo/team/ENG, 390x844, 3 rows selected | Bulk bar at the bottom: "3 selected", "Select all 16", Status, Priority, Assignee, More, archive, delete. | Console: none.
- `bulk-bar-selected-375x667.png` | same, 375x667 | Same bulk bar, fits. | Console: none.
- `bulk-due-picker-390x844.png` | More -> Due date, 390x844 | Full month grid (1-30), "Clear date" visible, close (X) in sheet header, bulk bar visible. | Console: none.
- `bulk-due-picker-375x667.png` | More -> Due date, 375x667 | Same; full grid, Clear date and bulk bar visible. | Console: none.

### Item 4: info toast after move to Operations
- `toast-label-removed-desktop-light.png` | ENG-11 moved to Operations, 1280x800 light | Toast fully opaque, bottom-right: "Moved. Label removed because it doesn't exist in the new team: frontend-regression". | Console: WS only.
- `toast-label-removed-desktop-dark.png` | ENG-33 moved, 1280x800 dark | Opaque toast, bottom-right, readable. | Console: WS only.
- `toast-label-removed-mobile-light.png` | ENG-43 moved, 390x844 | Opaque toast above the bottom edge over the issue page, readable. | Console: WS only.

### Item 5: admin (e2e@test.local)
- `admin-home-desktop-light.png` | /admin | Platform overview: organizations 1, users 3, platform admins 1, total issues 44, most-active table. | Console: none.
- `admin-users-desktop-light.png` | /admin/users | Table of 3 users with Impersonate / Make admin / Suspend. "Showing 3 of 3". No Load more (only 3 users, so pagination was not exercised). | Console: none.
- `admin-users-desktop-dark.png` | /admin/users, dark | Same table in dark; buttons and status badges legible. | Console: none.
- `admin-users-mobile-light.png` | /admin/users, 390x844 | Table scrolls horizontally inside its card: Status column clipped and the Actions column is not visible. Nav clipped ("Co"). | Console: none.
- `admin-tenants-desktop-light.png` | /admin/tenants | Not separately viewed; same route and data as the dark capture. | Console: none.
- `admin-tenants-desktop-dark.png` | /admin/tenants, dark | Table: Demo Org (demo, US), Active, 3 members, 44 issues, created 11/25/2026, Suspend and Archive buttons. "Showing 1 of 1". Legible. | Console: none.
- `admin-tenants-mobile-light.png` | /admin/tenants, 390x844 | Table clipped at the right ("Iss" cut). Horizontal scroll needed for the Issues column. | Console: none.
- `admin-audit-desktop-light.png` | /admin/audit | Platform audit log empty state: "No platform actions recorded yet." | Console: none.
- `admin-config-desktop-light.png` | /admin/config | Platform configuration: AI assistant (provider dropdown set to anthropic, model fields at Default), Branding (Bilinear), Cycles (upcoming count 15), each marked "Inherited from code-default". Filter box at top. | Console: none.

## Could not verify
- Real-time sync behaviour (ws server down).
- Load more on admin users and tenants (too few rows).
