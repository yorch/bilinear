# First-look visual defects (final-state screenshots, production build)

About 45 PNGs were viewed (desktop light/dark and mobile). This is a list only, nothing was fixed.
Each item shows the screenshot to open and a severity (H/M/L).

## Functional or behavioural
1. **H - Inbox renders empty on the first load in a fresh browser profile.** `inbox-*`: opening `/demo/inbox` showed "Priority 0 / Other 0 / No priority notifications" while the sidebar badge said 6 unread. The `notifications` GraphQL response contained rows. After one reload the same page showed Priority 2 / Other 2 and the rows. A client-side nav from the team page to Inbox was also empty. The inbox screenshots were therefore taken after a reload. Looks like a first-fetch race or reconcile problem in `useNotificationSync` / `notificationStore`.
2. **M - Cycle 2 chart is oddly shaped (`cycle-active-*`).** Planned = 0, Scope creep = 14 (93%), and the Remaining/Scope lines jump vertically on about Nov 23. This is probably an artifact of seeding all issues "today", but it makes the burndown demo unconvincing. The ideal line does render.
3. **L - "Avg cycle" shows 0.0d for every team** in workspace Analytics (`analytics-*`), while team analytics shows "—". The two screens are inconsistent.
4. **L - Webhook test failure text is a raw error string** (`settings-webhooks-*`): "fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND hooks.example.com)". That is a sandbox DNS failure, but the string is shown verbatim in the card and in the deliveries table (truncated with an ellipsis).

## Layout
5. **H - Mobile bulk action bar overflows (`team-eng-bulk-mobile-light`).** The bar is cut off on the right after "Assignee", so Label/Project/Cycle/Due date/Delete are off-screen. It is probably horizontally scrollable, but there is no affordance.
6. **H - Mobile triage duplicate suggestions are cramped (`team-triage-mobile-light`).** The "Mark as duplicate of ENG-xx" button takes most of the row, so duplicate titles shrink to "(", "Board vie…" or "T…" and the shared-terms text to "Shared terms: check…". The user cannot tell what they are marking as a duplicate.
7. **M - Issue "Set parent…" picker (`issue-parent-desktop-*`).** The "Search issues…" popover is anchored at the right edge and appears to run off the viewport (its right border touches or clips at the screen edge).
8. **M - Mobile admin tables (`admin-users-mobile-light`, `admin-tenants-mobile-light`).** Only name, organization and status are visible. The Actions column (Impersonate, Make admin, Suspend) is not visible. Rows are tall (about 113px) with a lot of empty space. This may be a horizontal scroll inside the table. Page-level overflow is false.
9. **M - Admin tenants desktop (`admin-tenants-desktop-*`).** The page loads 50 of 120 and the footer is below the fold, so "Showing 50 of 120 / Load more" is only visible after scrolling. The 110 filler "Acme Co N" orgs and "Test User N" users were added only to exercise this footer.
10. **L - Shortcut help modal (`shortcut-help-*`).** The header and footer separators render as brand-coloured (purple/blue) 2px lines. This looks like a focus ring on the scroll region rather than a divider. The Triage and View sections are below the fold until scrolled; see `shortcut-help-triage-*`.
11. **L - Mobile cycle detail header (`cycle-active-mobile-light`).** The back arrow and title take one row, and the Roll over (icon-only, no label) and "…" actions drop onto a second row, wasting vertical space.
12. **L - Board cards truncate label chips** ("Documentati…", "Customer Re…") (`team-eng-board-desktop-dark`).
13. **L - Mobile issue row (`team-eng-*-mobile-light`).** Rows show only checkbox, priority, ID, title and a state dot. No assignee, labels or dates are shown.
14. **L - Mobile issue detail Milestone chip (`issue-detail-mobile-light`).** The "Milestone" chip has no value, so it reads as a placeholder next to the filled chips.
15. **L - Custom field input on issue detail (`issue-detail-*`).** The "Budget" input is an unlabeled empty rounded box when no value is set, and it looks slightly different in height and radius from other fields.

## Copy and wording
16. **M - Integrations copy (`settings-integrations-*`).** The Slack and GitHub cards say "GitHub sign-in needs GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET" and "Slack sign-in needs SLACK_CLIENT_ID…", but these cards are about PR linking and the /bilinear slash command, not sign-in. The env-var text is also aimed at an operator, not a workspace admin.
17. **L - Native date inputs (`settings-audit-log-*`, `issue-reminder-menu-*`).** They show "mm/dd/yyyy" placeholders and browser-default styling. This is not themed and not localised.
18. **L - Audit log (`settings-audit-log-*`).** The IP column is empty ("—") for every row. This is expected only because TRUST_PROXY_HEADERS is unset on this server. Resource column shows truncated raw ids ("Team 7a5373f3", "OrganizationMember f6681a4d") rather than names.
19. **L - Onboarding (`onboarding-*`).** "Your name" is pre-filled with the email local-part "newbie". Left panel stats "Queued / <40ms / 2 languages" are marketing text with little context.

## Data and demo content
20. **L - Public roadmap not captured.** The public roadmap is disabled by default, so `/roadmap/demo` was not captured. Only the settings page `public-roadmap-*` is available.
21. **L - Reminder chip (`issue-reminder-chip-*`).** It sits between the title and the description and reads "Reminder: Nov 25, 5:14 PM". It looks fine, but with no description the page leaves a large empty gap.

## Not verified
- Spanish locale was not captured (not requested).
- Mobile dark was not captured (spec: dark is desktop only).
- Console and page errors: 0 on every final capture. One React error #418 (hydration mismatch) appeared on `/demo/settings` at mobile during an aborted attempt of the custom-fields flow, not in the final capture.
