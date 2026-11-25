# Verified visual-QA defects (final screenshots, production build)

How this list was made: I opened the PNGs in `screenshots/final/` myself. For each defect I read the source, and where it was cheap I reproduced the behaviour against the running build (:3000, DB `bilinear_final`) with a fresh Playwright profile. The probe scripts are in the session scratchpad under `qa/`. No source code was changed.

Severity:
- **P1** means functional or wrong data.
- **P2** means visual or UX.
- Nits are dropped.

Items marked **[seed]** come from how the demo data was seeded, not from a product bug.

---

## P1: functional

### 1. The Inbox is empty after any full bootstrap (fresh profile, stale cursor, delta failure)

**Reproduced:** in a fresh profile on `/demo/inbox`, the page shows "Priority 0 / Other 0 / No priority notifications". The header's "N unread" pill and the sidebar badge are gone. IndexedDB `notifications` has 0 rows. The `NotificationsWithCount` response at about 420 ms had 4 unread rows and a count of 4. Firing a `visibilitychange` event re-runs the fetch, and the list fills ("4 unread, Priority 2 / Other 2"). The hook is still mounted, so the first result was applied and then erased.

**Root cause: an ordering race between two writers.**
1. `useNotificationSync` (`src/components/notifications/use-notification-sync.ts:35-42`) fetches at mount (about 250 ms). It reconciles the rows into `notificationStore.pool` and sets `serverUnread`, `baselineUnread` and `loadState='loaded'`.
2. `SyncManager.fullBootstrap` finishes after that and calls `this.stores.clearEntityPools()` (`src/lib/sync-manager.ts:717`).
3. `clearEntityPools` (`src/stores/root-store.ts:84-100`) clears **every** Map on every store except `syncStore` and `uiStore`. That includes `notificationStore.pool`.
4. The bootstrap stream carries no `Notification` rows, because it is a per-user model (`src/server/services/sync.service.ts:143-147`). So `batches.notifications` is empty and the pool stays empty.
5. `loadState` is still `'loaded'`, so the Inbox shows the authoritative empty state, not a skeleton.
6. The badge also goes wrong. `unreadCount` = `serverUnread + pooled − baselineUnread` = 4 + 0 − 4 = 0 (`src/stores/notification-store.ts:128-134`), so unread notifications vanish from the badge as well.
7. Nothing repairs this until the 60 s interval or a tab-visibility change.

The same wipe runs on every `staleCursor` re-bootstrap and on every delta-failure fallback during a session, not only on first load.

**Fix (pick one, ideally both):**
- Exclude the per-user, fetch-owned pools from `clearEntityPools`. Either keep an explicit skip-list (`notificationStore`, `favoriteStore`), or give those stores a `bootstrapOwned = false` flag the reflective loop checks.
- After `clearEntityPools()` in `fullBootstrap`, reset `notificationStore` (`serverUnread=null`, `baselineUnread=0`, `loadState='idle'`) and call `fetchNotifications(notificationStore)`.
- Add a regression test: reconcile 4 rows, run `clearEntityPools()`, then assert the inbox count is still 4 (or that a refetch was triggered).

### 2. Favourite stars show "not favourited" for real favourites, because favourites are never bootstrapped

**Reproduced:** in a fresh profile, open project "Public API v2", which is in the sidebar Favorites list. The header button reads **"Add to favorites"** (`aria-pressed=false`). It still does after a reload. IndexedDB `favorites` has 0 rows. This is visible in `project-detail-desktop-light.png`: an empty star top-right, while the sidebar highlights the project as a favourite.

**Root cause:**
- `FavoriteStore` is filled only from Dexie (`sync-manager.ts:423/483`) and from WS/delta SyncActions (`sync-manager.ts:196`).
- `fullBootstrap`'s `batches` (`sync-manager.ts:545-567`) has no `favorites` key.
- The server does not stream `Favorite` rows, because it is a per-user model.
- `clearEntityPools` wipes whatever was there.
- The sidebar works only because it runs its own `SidebarFavorites` query.

`useFavoriteToggle` (`src/hooks/use-favorite-toggle.ts:33,42`) therefore reports `isFavorite=false`. Clicking the star calls `favoriteCreate` again for an entity that is already favourited, which gives a duplicate or an error toast. The issue context menu's "Add to favorites" (`issue-context-menu.tsx:128`) has the same bug.

**Fix:**
- Stream the caller's own `Favorite` rows in `/api/sync/bootstrap`, filtered to `userId`, as is already done for other per-user models in deltas. Add `favorites` to `batches` and to the Dexie clear/bulkPut list.
- Or: have the sidebar's `SidebarFavorites` result `replaceAll` into `favoriteStore`.
- Also exclude `favoriteStore` from `clearEntityPools` (see item 1).

### 3. The Insights table has two identical "Issues" columns, and the second is clipped on mobile

**Screenshots:** `analytics-insights-desktop-light.png` shows STATUS | ISSUES | ISSUES with the same numbers. In `analytics-insights-mobile-light.png` the third header is cut to "ISSU" and its values are off-screen inside `overflow-x-auto`.

**Root cause:** `src/components/analytics/insights-explorer.tsx`
- Lines 258-260 render `valueHeader`. For `measure==='count'` that is `analytics.explorer.valueHeader.count` = "Issues" (`en.json`).
- Lines 266-268 and 288-290 always add `analytics.explorer.issues` / `r.issueCount`. For the count measure, `value === issueCount`.
- The CSV export (lines 111-121) has the same duplicate column.

**Fix:** render the trailing Issues column only when `measure !== 'count'` (header, body cell, and CSV). With that change, the mobile table also fits within `min-w-[20rem]`.

---

## P2: visual and UX (real product bugs)

### 4. The mobile bulk action bar overflows with no affordance (`team-eng-bulk-mobile-light`)

The bar ends at "Assignee | L…". Label, Project, Cycle, Due date and Delete are off-screen.

**Cause:** `src/components/issues/bulk-action-bar.tsx:130`. The bar is `flex-nowrap overflow-x-auto` below md, by design, but it has no fade or chevron. "Delete", the destructive action, is the one that is hidden.

Separately, the fixed bar covers the last list rows: there is no bottom padding on the list while a selection is active.

**Fix:**
- Below md, make it a two-row bar: count and Select-all on the first row, actions on a second row with `flex-wrap`.
- Or keep the scroller, add a right-edge gradient mask (`mask-image`), and pin Delete or "More" at the end outside the scroller.
- Add `pb-[var(--bulk-bar-h)]` to the list while a selection is active.

### 5. Mobile triage duplicate suggestions are unreadable (`team-triage-mobile-light`)

The titles collapse to "(", "Board vie…" and "T…". The matched terms collapse to "Shared terms: check…".

**Cause:** `src/components/issues/triage-duplicate-suggestions.tsx:120` (`flex items-center gap-3` row) together with lines 145-154. The full-text button "Mark as duplicate of ENG-48" is `shrink-0` by default and takes about 45% of the row.

**Fix:**
- Make the row `flex-col items-stretch gap-2 sm:flex-row sm:items-center`, so the button wraps under the text on phones.
- Or shorten the label below sm to "Mark duplicate", keeping the full text as `aria-label`/`title`.

### 6. The "Set parent…" popover is clipped at the right viewport edge (`issue-parent-desktop-*`)

**Cause:** `src/components/issues/issue-picker.tsx:47-61` passes no `align` prop. `SearchableSelectPopover` therefore uses `left-0` (`src/components/ui/searchable-select-popover.tsx:196-197`) with `panelClassName="w-72"`. The trigger sits at x≈1157 in a 1440 viewport, so the 288 px panel ends at about 1445.

`usePopoverFlip` only flips vertically.

Also, before anything is typed the panel is a bare input with no list and no hint (lines 104-113: in live-search mode the list is `[]` and the empty state is suppressed). It looks broken.

**Fix:**
- Pass `align="right"` from `IssuePicker` (or add an `align` prop and set it in the detail rail). Better: teach `usePopoverFlip` to flip horizontally when `rect.left + panelWidth > innerWidth`.
- Show recent or same-team issues, or a "Type to search issues" hint, when the query is empty.

### 7. The project burn-up's last x-axis label is clipped (`project-detail-desktop-light`: "Dec 1⟩")

**Cause:** `src/components/analytics/project-burnup-section.tsx:270-279` draws every x label with `textAnchor="middle"` at `xScale(i)`. The last tick is at `width − PADDING_RIGHT` (`src/components/cycles/chart-geometry.ts:19`, `PADDING_RIGHT = 12`), so half the label falls outside the SVG.

**Fix:** use `textAnchor="end"` for the last label and `"start"` for the first (or clamp x). Alternatively raise `PADDING_RIGHT` to about 24. Check the cycle burndown too, which shares `chart-geometry`.

### 8. Mobile admin tables hide the Actions column and rows are about 113 px tall (`admin-users-mobile-light`, `admin-tenants-mobile-light`)

**Cause:** `src/app/(admin)/admin/users/page.tsx:179-231`, and the same pattern in `tenants/page.tsx`. The table is `w-full` with no min-width inside `overflow-x-auto`. The Actions cell (`flex flex-wrap justify-end gap-1.5`) is squeezed, so its buttons stack vertically: that is the source of the tall, mostly empty rows. The column itself is scrolled off to the right with no indication.

**Fix:**
- Below sm, render each row as a card with the actions under the user cell.
- Or give the table `min-w-[44rem]`, put `flex-nowrap` on the actions, and add a scroll hint.

### 9. "Avg cycle" shows 0.0d in workspace Analytics but "—" in team Analytics (`analytics-desktop-*` vs `team-analytics-*`)

**Cause:**
- `src/app/(workspace)/[workspace]/analytics/page.tsx:251` prints `toFixed(1)` for any value `> 0`. Sub-0.05-day values therefore render as "0.0d".
- The team page (`team/[key]/analytics/page.tsx:474`) explicitly maps "0.0" to "—" ("a rounding artefact, not a measurement").
- The server's `AVG(...)` (`src/server/services/analytics.service.ts:511-519`) also averages zero and negative durations, whereas the client filters `ms > 0`.

The seed triggers it (started and completed seconds apart), but the inconsistency is in the code.

**Fix:** use one shared formatter: `null` or rounds to `0.0` gives "—", otherwise "<0.1d" or "N.Nd". Add `AND completed_at > started_at` to the SQL so both sides compute the same thing.

### 10. Integrations cards say "sign-in" for non-sign-in features (`settings-integrations-*`)

**Cause:** `en.json:2210` has `settings.integrations.notConfiguredHint` = "{provider} sign-in needs {envVars}…", used at `settings/integrations/page.tsx:104`. The cards are for PR linking and the `/bilinear` slash command.

**Fix:** change the copy to "The {provider} integration isn't set up on this server. Ask whoever runs this deployment to configure it." Move the env-var names to a `title` tooltip or an operator-only line. Update `es.json` too.

### 11. The shortcut help modal shows brand-coloured 2 px "separators" (`shortcut-help-*`)

These are not dividers. They are the `:focus-visible` outline (`src/app/globals.css:511-513`, `outline: 2px solid var(--ring)`) on the scroll body `div.max-h-[70vh].overflow-y-auto` (`src/components/layouts/shortcut-help-modal.tsx:133`).

Chrome makes scrollable containers keyboard-focusable. `showModal()` focuses the first focusable element, which is the scroller. The outline's side edges are clipped by the `ModalDialog` wrapper's `overflow-y-auto` (`src/components/ui/modal-dialog.tsx:93-94`), so only the top and bottom edges show and they read as lines.

**Fix:**
- Add `autoFocus` (or `data-autofocus`) on the dialog's heading or close control.
- Or give the scroller `outline-offset:-2px` and `rounded`, so a focused scroller shows a complete inset ring.

### 12. The default "Todo" state dot is nearly invisible in light mode (`my-issues-mobile-light`, `team-eng-*-mobile-light`)

**Cause:**
- The default workflow colour is `#e2e2e2` (`src/server/services/team.service.ts:24`). The seed uses `#e2e8f0`.
- `ColorDot` (`src/components/ui/color-dot.tsx:26`) has no border, so the contrast against white is about 1.2:1.

This affects every new team, not only the seed.

**Fix:** add `ring-1 ring-inset ring-foreground/15` (or a token-based `ring-border`) to `ColorDot`. Optionally also darken the default Todo colour (for example `#b8bcc4`).

### 13. Mobile issue detail: start and due dates are unlabelled ("Nov 16  Nov 26") (`issue-detail-mobile-light`)

**Cause:** below lg, the property labels are hidden (`issue-detail-content.tsx:237`, `labelClass … max-lg:hidden`). When a date is set, `DueDatePicker` renders only the formatted date (`src/components/properties/due-date-picker.tsx:74-77`). The icon is used only for the empty placeholder. The estimate chip "13" has the same problem.

**Fix:** always prefix the value with the `CalendarClock`/`CalendarDays` icon in compact mode. Do the same for estimate (gauge icon).

### 14. The webhook test error is a raw undici string (`settings-webhooks-*`)

"fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND hooks.example.com)" appears in the card (`settings/webhooks/page.tsx:582-585`) and in the deliveries table.

**Fix:** map known codes to readable copy in `webhook.service.ts` (ENOTFOUND gives "Couldn't resolve host hooks.example.com"; ECONNREFUSED, timeout, TLS). Keep the raw text in `title`.

### 15. The audit-log Resource column shows raw model names and 8-character ids ("OrganizationMember f6681a4d")

**Cause:** `settings/audit-log/page.tsx:414-423`. `resourceType` is not localised and `resourceId.slice(0, 8)` is shown.

**Fix:** localise `resourceType` and resolve names from the stores where available (team, member, webhook). Fall back to the short id.

### 16. The mobile cycle detail header wraps onto two rows (`cycle-active-mobile-light`)

Roll over (icon-only, unlabelled) and "…" drop below the title.

**Fix:** move Roll over into the "…" menu below sm, or put the actions on the title row with the title set to `truncate`.

### 17. Native date inputs are unthemed and show "mm/dd/yyyy" (`settings-audit-log-*`, `issue-reminder-menu-*`, bulk bar due date `bulk-action-bar.tsx:337-341`)

**Fix:** use the existing `DueDatePicker` or a shared themed date field. Low priority.

---

## Seed or demo artifacts (not product bugs)

- **[seed] Cycle 2 burndown** (`cycle-active-*`): Planned 0, Scope creep 14 (93%), and Remaining/Scope jump from 0 to about 10–15 on Nov 24. Every issue was created or added to the cycle "today", after the cycle start (Nov 16). The ideal line starts at 15 while Planned is 0, which is correct for that data. Fix in `prisma/seed.ts` by back-dating `createdAt` and the cycle-add history.
- **[seed]** Admin "Showing 50 of 120" footer below the fold: 110 filler orgs and users were added just for this. The pagination works.
- **[seed/env]** Audit-log IP column is all "—": `TRUST_PROXY_HEADERS` is unset.
- **[env]** Webhook ENOTFOUND: sandbox DNS. Only the copy is a bug (item 14).
- **[capture]** Public roadmap is disabled by default, so only the settings page was captured.
- **[seed]** The "0.0d" values are triggered by seed timing, but the inconsistency is real (item 9).

## Rejected or downgraded from the first look

- **#10 "Triage/View below the fold"** in the shortcut modal: this is expected scrolling. The real defect is the focus ring (item 11).
- **#12 board label chips truncate** and **#13 mobile rows omit assignee/labels**: these are intentional density choices. Nit.
- **#14 Milestone placeholder chip** and **#15 empty Budget input**: they are consistent with the other empty-property placeholders. The Budget field has a label on desktop. Nit.
- **#19 onboarding name prefill** and the marketing stats: intentional. Nit.
- **#21 reminder chip gap**: there is no defect. The gap is just an empty description.
- **First-look note "badge says 6" for the inbox:** in my reproduction the badge and the header pill drop to 0 along with the list (see the arithmetic in item 1), which is worse: unread items disappear entirely. A non-zero badge next to an empty list only happens when the bootstrap clear lands between two reconciles. Same root cause either way.

## Checked with no defect found

Dark-mode contrast on the list, board, triage, analytics, audit log, import, integrations and custom-fields pages; avatar ink (uses `--avatar-ink-*`); command palette mobile; display menu mobile; docs sub-page; cycles list; initiative detail; login and onboarding; inbox mobile after a populated load. No raw i18n keys were visible in any of the 156 captures.
