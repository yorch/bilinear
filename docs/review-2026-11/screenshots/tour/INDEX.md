# Tour screenshots index

Run: 2026-11-25, production build at http://localhost:3000, workspace `demo`, signed in as demo@example.com (sign-in via a minted access cookie against the bilinear_shots database the server uses).

Totals: 57 PNG files. Screens 01-08 have desktop light, desktop dark and mobile light. Screens 09-20 are desktop light only.

Failed steps: none. Screen 19 (admin) is a redirect, not an admin page: the demo user cannot reach /admin.

Console errors: none recorded on any capture or flow step (captured per page, first 5 kept).

Data notes: the seed has no cycles, so cycle detail was not captured; only one doc exists. Flows a-e mutated ENG-1 and created ENG-44 in the shots database.

| File | Route | What it shows | Viewed | Console errors | Visible problems |
|---|---|---|---|---|---|
| 01-login-desktop-dark.png | /login (signed out) | Sign-in page: email field, Continue with email, Continue with SSO | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 01-login-desktop-light.png | /login (signed out) | Sign-in page: email field, Continue with email, Continue with SSO | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 01-login-mobile-light.png | /login (signed out) | Sign-in page: email field, Continue with email, Continue with SSO | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 02-team-eng-issue-list-desktop-dark.png | /demo/team/ENG | Engineering issue list grouped by status, 15 rows, triage link and New issue button | desktop light and dark, mobile light: yes | none recorded | None seen in viewed capture |
| 02-team-eng-issue-list-desktop-light.png | /demo/team/ENG | Engineering issue list grouped by status, 15 rows, triage link and New issue button | desktop light and dark, mobile light: yes | none recorded | None seen in viewed capture |
| 02-team-eng-issue-list-mobile-light.png | /demo/team/ENG | Engineering issue list grouped by status, 15 rows, triage link and New issue button | desktop light and dark, mobile light: yes | none recorded | None seen in viewed capture |
| 03-team-eng-board-desktop-dark.png | /demo/team/ENG (Board view) | Kanban board, Backlog/Todo/In Progress/Done columns | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 03-team-eng-board-desktop-light.png | /demo/team/ENG (Board view) | Kanban board, Backlog/Todo/In Progress/Done columns | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 03-team-eng-board-mobile-light.png | /demo/team/ENG (Board view) | Kanban board, Backlog/Todo/In Progress/Done columns | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 04-issue-ENG-1-detail-desktop-dark.png | /demo/issue/<ENG-1> | Issue detail: title, status/priority/assignee sidebar, sub-issues, relations, comments | desktop light and mobile light: yes | none recorded | None seen in viewed capture |
| 04-issue-ENG-1-detail-desktop-light.png | /demo/issue/<ENG-1> | Issue detail: title, status/priority/assignee sidebar, sub-issues, relations, comments | desktop light and mobile light: yes | none recorded | None seen in viewed capture |
| 04-issue-ENG-1-detail-mobile-light.png | /demo/issue/<ENG-1> | Issue detail: title, status/priority/assignee sidebar, sub-issues, relations, comments | desktop light and mobile light: yes | none recorded | None seen in viewed capture |
| 05-issue-create-modal-desktop-dark.png | /demo/team/ENG (C key) | Create issue modal with title, description and property chips | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 05-issue-create-modal-desktop-light.png | /demo/team/ENG (C key) | Create issue modal with title, description and property chips | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 05-issue-create-modal-mobile-light.png | /demo/team/ENG (C key) | Create issue modal with title, description and property chips | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 06-my-issues-desktop-dark.png | /demo/my-issues | My issues: Assigned tab, two rows grouped by status | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 06-my-issues-desktop-light.png | /demo/my-issues | My issues: Assigned tab, two rows grouped by status | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 06-my-issues-mobile-light.png | /demo/my-issues | My issues: Assigned tab, two rows grouped by status | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 07-inbox-desktop-dark.png | /demo/inbox | Inbox: Priority/Other tabs, 1 unread notification (status change on ENG-16) | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 07-inbox-desktop-light.png | /demo/inbox | Inbox: Priority/Other tabs, 1 unread notification (status change on ENG-16) | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 07-inbox-mobile-light.png | /demo/inbox | Inbox: Priority/Other tabs, 1 unread notification (status change on ENG-16) | desktop light: yes; others: no | none recorded | None seen in viewed capture |
| 08-command-palette-desktop-dark.png | /demo/team/ENG (Ctrl+K) | Command palette with Actions list (create issue/project/team, navigation) | desktop light and mobile light: yes | none recorded | None seen in viewed capture |
| 08-command-palette-desktop-light.png | /demo/team/ENG (Ctrl+K) | Command palette with Actions list (create issue/project/team, navigation) | desktop light and mobile light: yes | none recorded | None seen in viewed capture |
| 08-command-palette-mobile-light.png | /demo/team/ENG (Ctrl+K) | Command palette with Actions list (create issue/project/team, navigation) | desktop light and mobile light: yes | none recorded | None seen in viewed capture |
| 09-triage-desktop-light.png | /demo/team/ENG/triage | Triage split view: queue on left, selected issue (ENG-4) on right | desktop light: yes | none recorded | None seen in viewed capture |
| 10-backlog-desktop-light.png | /demo/team/ENG/backlog | Backlog: three backlog issues | desktop light: yes | none recorded | None seen in viewed capture |
| 11-cycles-list-desktop-light.png | /demo/team/ENG/cycles | Cycles Active tab empty state ("No cycles yet") - seed has no cycles, so no cycle detail page was captured | desktop light: yes | none recorded | Empty state only, expected for seed data |
| 12a-projects-list-desktop-light.png | /demo/projects | Projects list with one active project (Public API v2, Planned) | desktop light: yes | none recorded | None seen in viewed capture |
| 12b-project-detail-desktop-light.png | /demo/project/public-api-v2 | Project detail: progress and burn-up show empty-data states, properties panel | desktop light: yes | none recorded | None seen in viewed capture |
| 13-initiatives-desktop-light.png | /demo/initiatives | Initiatives list: Q4 Platform Reliability, Derived: No data, 0 projects | desktop light: yes | none recorded | None seen in viewed capture |
| 14a-docs-list-desktop-light.png | /demo/docs | Docs list: one doc (Release checklist) | desktop light: yes | none recorded | None seen in viewed capture |
| 14b-doc-detail-desktop-dark.png | /demo/docs/<release-checklist> | Doc editor: title, formatting toolbar, short body | desktop light: yes | none recorded | None seen in viewed capture |
| 14b-doc-detail-desktop-light.png | /demo/docs/<release-checklist> | Doc editor: title, formatting toolbar, short body | desktop light: yes | none recorded | None seen in viewed capture |
| 14b-doc-detail-mobile-light.png | /demo/docs/<release-checklist> | Doc editor: title, formatting toolbar, short body | desktop light: yes | none recorded | None seen in viewed capture |
| 15-workspace-analytics-desktop-light.png | /demo/analytics | Workspace analytics: KPI tiles, team table, insights bar chart with slice/filter controls | desktop light: yes | none recorded | None seen in viewed capture |
| 16-team-analytics-desktop-light.png | /demo/team/ENG/analytics | Team analytics (90d): KPI tiles, issues by state, assignee workload | desktop light: yes | none recorded | None seen in viewed capture |
| 17a-settings-general-desktop-light.png | /demo/settings | Workspace settings top: profile, organization, custom fields | desktop light: captured, not viewed | none recorded | None seen in viewed capture |
| 17b-settings-members-desktop-light.png | /demo/settings (Members) | Members list (3 members with roles) and invite form | desktop light: yes | none recorded | None seen in viewed capture |
| 17c-settings-integrations-desktop-light.png | /demo/settings/integrations | Integrations: GitHub and Slack both show Not configured on this server | desktop light: yes | none recorded | None seen in viewed capture |
| 17d-settings-webhooks-desktop-light.png | /demo/settings/webhooks | Webhooks: Pager bridge and Deploy notifier, enabled, action buttons | desktop light: yes | none recorded | None seen in viewed capture |
| 17e-settings-security-desktop-light.png | /demo/settings/security | Security: SCIM base URL, bearer tokens, SAML service provider details | desktop light: yes | none recorded | None seen in viewed capture |
| 17f-settings-audit-log-desktop-light.png | /demo/settings/audit-log | Audit log table: sign-ins, role changes, webhook and team events | desktop light: yes | none recorded | None seen in viewed capture |
| 18-profile-account-desktop-light.png | /demo/settings (Profile) | Same page as 17a: Profile (name/email) and Organization cards. No separate account route exists | desktop light: captured and viewed | none recorded | None seen in viewed capture |
| 19-admin-desktop-light.png | /admin (requested) -> /demo/team/ENG | NOT the admin area: demo user is redirected to the Engineering team page. Captured as evidence of the redirect | desktop light: yes | none recorded | Redirect, not an admin page (see above) |
| 20-design-system-desktop-light.png | /design | Design reference: token layer, accent picker, surfaces | desktop light: captured, not viewed | none recorded | None seen in viewed capture |
| flow-a-create-issue-1-open-desktop-light.png | /demo/team/ENG | Flow a step 1: New issue modal opened | not viewed | none recorded | None seen in viewed capture |
| flow-a-create-issue-2-filled-desktop-light.png | /demo/team/ENG | Flow a step 2: title "Tour: haiku flow issue" typed | not viewed | none recorded | None seen in viewed capture |
| flow-a-create-issue-3-in-list-desktop-light.png | /demo/team/ENG | Flow a step 3: new issue shown in list (ENG-44, Backlog) | not viewed (seen in flow c) | none recorded | None seen in viewed capture |
| flow-b-status-priority-1-status-menu-desktop-light.png | /demo/issue/<ENG-1> | Flow b step 1: status menu open | not viewed | none recorded | None seen in viewed capture |
| flow-b-status-priority-2-status-changed-desktop-light.png | /demo/issue/<ENG-1> | Flow b step 2: status changed to In Progress | not viewed | none recorded | None seen in viewed capture |
| flow-b-status-priority-3-priority-menu-desktop-light.png | /demo/issue/<ENG-1> | Flow b step 3: priority menu open | not viewed | none recorded | None seen in viewed capture |
| flow-b-status-priority-4-priority-changed-desktop-light.png | /demo/issue/<ENG-1> | Flow b step 4: status In Progress, priority High | yes | none recorded | None seen in viewed capture |
| flow-c-bulk-select-1-two-selected-bulk-bar-desktop-light.png | /demo/team/ENG | Flow c: two rows selected, bulk bar (Status, Priority, Assignee, Label, Due date, More, Archive, Delete) | yes | none recorded | None seen in viewed capture |
| flow-d-comment-1-typed-desktop-light.png | /demo/issue/<ENG-1> | Flow d step 1: comment text typed | not viewed | none recorded | None seen in viewed capture |
| flow-d-comment-2-posted-desktop-light.png | /demo/issue/<ENG-1> | Flow d step 2: comment posted by Demo User | yes | none recorded | None seen in viewed capture |
| flow-e-reminder-1-reminder-menu-desktop-light.png | /demo/issue/<ENG-1> | Flow e step 1: More actions > Remind me submenu | not viewed | none recorded | None seen in viewed capture |
| flow-e-reminder-2-reminder-set-desktop-light.png | /demo/issue/<ENG-1> | Flow e step 2: reminder chip (Nov 25, 1:00 PM) and confirmation toast | yes | none recorded | Confirmation toast overlaps the comment box at bottom right (transient) |
