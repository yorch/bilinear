# Small-items final screenshots

Build: running production app at http://localhost:3000, workspace `demo`, ws sync on :3001.
Sessions minted for demo@example.com and e2e@test.local. Capture scripts: `scratchpad/small2/`.

**Data changes made during capture (demo DB `bilinear_shots`):**
- ENG-1 (`f09ef2bb-...`): added label `frontend-regression`, set start date to Nov 25 (today).
- ENG-1 was then moved to the Operations team for the toast check; it is now **OPS-22** (same issue id).
- Estimate could not be set: Engineering and Operations both have `issue_estimation_type = notUsed`, so no estimate control renders. Team settings were not changed.

## Files

| File | Route | Console errors | Notes |
|---|---|---|---|
| item1-eng1-mobile-light.png | /demo/issue/f09ef2bb-... (ENG-1), 390x844 | none | Labels row shows `frontend-regression`; `Due date Nov 26` with gap |
| item1-eng1-panel-t768-light.png | /demo/team/ENG, row click, 768x1024 | none | Side panel; each field once |
| item1-eng1-panel-w1000-light.png | /demo/team/ENG, row click, 1000x800 | none | Side panel; each field once |
| item1-eng1-panel-m390-light.png | /demo/team/ENG, row click, 390x844 | none | Full-screen sheet; each field once |
| item2-due-picker-mobile-390-light.png | ENG-1, 390x844, Due date chip tapped | none | Picker fully visible |
| item2-due-picker-mobile-375x667-light.png | ENG-1, 375x667, Due date chip tapped | none | Picker fully visible |
| item2-due-picker-desktop-light.png | ENG-1, 1280x800, Due date chip tapped | none | Picker bottom cut off (see item 2) |
| item3-admin-home-mobile-light.png | /admin, 390x844 | none | Not inspected in detail |
| item3-admin-users-mobile-light.png | /admin/users, 390x844 | none | Stacked cards with Impersonate / Make admin / Suspend |
| item3-admin-tenants-mobile-light.png | /admin/tenants, 390x844 | none | Stacked cards with Members / Issues / Created |
| item3-admin-users-desktop-light.png | /admin/users, 1280x800 | none | Table |
| item3-admin-tenants-desktop-light.png | /admin/tenants, 1280x800 | none | Table |
| item4-bulk-due-375x667-light.png | /demo/team/ENG, 2 rows selected, More > Due date, 375x667 | none | Sheet fully visible |
| toast-label-removed-desktop.png | ENG-1 issue page, More > Move to team > Operations, 1280x800 | none | Toast visible |
| item5-issue-ENG-1-desktop-light.png | /demo/issue/... (now OPS-22 route id same), 1280x800 | none | Regression check |
| item5-issue-ENG-1-desktop-dark.png | same, dark | none | Regression check |
| item5-issues-list-desktop-light.png | /demo/team/ENG, 1280x800 | none | Regression check |

Console errors: none recorded on any capture. No page errors.

## Verdicts

**1. Mobile ENG-1 detail, chips and panel layouts: FIXED.**
- Mobile 390: the second chip row shows the label name `frontend-regression`, and row 3 shows `Set parent…  Start date Nov 25  Due date Nov 26`. The Due date chip reads "Due date Nov 26" with a visible gap, styled like the other chips.
- Estimate: NOT VERIFIED. No estimate control renders because the team does not use estimation.
- Panel at 768, 1000 and 390: the innerText of `[data-testid=issue-detail-panel]` lists each field name exactly once (Status, Priority, Assignee, Labels, Project, Cycle, Parent, Start date, Due date, Branch). Screenshots confirm 768 and 390 (390 is a full-screen sheet). 1000 was checked by text only.

**2. Due-date picker: PARTLY FIXED.**
- 390x844 and 375x667: the picker is fully inside the viewport. Presets (Today to Next week), the date input, all calendar rows and Clear date are visible. It is an anchored popover under the chip, not a bottom sheet. The brief asked for a bottom sheet, so this is a mismatch with the spec, though it fits.
- Desktop 1280x800: the picker opens to the right of the chip (x 832 to 1098 CSS px), so it is not clipped horizontally. Its bottom edge is at 830 px in an 800 px viewport, so the Clear date row is cut off at the bottom. STILL BROKEN (vertical clipping).
- The "chip near the left edge of the panel" check was not done: the panel is on the right at md+, and I did not find a chip near the left edge. NOT VERIFIED for that case.

**3. Admin at 390: FIXED.**
- Nav: the tabs scroll horizontally with a fade; "Co…" is clipped at the right edge, which reads as a scroll affordance. The page has no horizontal overflow (scrollWidth 390 = clientWidth 390).
- Users (390): stacked cards. Impersonate, Make admin (or Revoke admin) and Suspend are visible on each card.
- Tenants (390): stacked cards with Members, Issues and Created labelled. Suspend and Archive are visible.
- Desktop 1280 light: users and tenants tables look unchanged, with all action buttons visible.

**4. Bulk bar More > Due date at 375x667: FIXED.** The sheet ("Due date" header, Today/Tomorrow/End of week/Next week, calendar, Clear date) is fully visible above the "2 selected" bar. The info toast, "Moved. Label removed because it doesn't exist in the new team: frontend-regression", is visible and readable at 1280 (captured via the issue page move, not the bulk bar).

**5. Regression check: NO REGRESSION SEEN.**
- Issue page 1280 light and dark: layout, chips, and dark background all render correctly. The body background is oklch(0.988) in light and oklch(0.148) in dark.
- Issues list 1280 light: groups, rows, the moved-chip row and the Nov 26 due date render correctly.
- The dark issues list and the admin dark views were not captured.

## Failed or skipped steps
- Estimate chip could not be set (team estimation disabled).
- Desktop due picker: bottom clipping confirmed visually; the left-edge-chip case was not tested.
- Item 3 home page was captured but not inspected in detail.
- The 1000px panel was verified by text only, not visually.
