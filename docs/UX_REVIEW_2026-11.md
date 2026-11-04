# bilinear — UX / UI / Layout review (2026-11-04)

> **Status:** every finding below was either fixed in the same PR, or is listed under
> [Deferred](#deferred-after-remediation). The per-finding evidence (screenshots,
> file:line) lived in per-area reports that are not checked in; the IDs (DOC-02,
> ISS-01, …) are referenced from the code comments and tests that guard each fix.

Method: seven parallel reviewers (Opus ×2, Sonnet ×4, Haiku ×1) drove the live app
(Chromium, desktop 1440 + mobile 390, light + dark) and read the source. 163 findings in
total across 30 routes. Every finding cites a screenshot or file:line in the per-area
reports (listed at the end). The seed DB was sparse, so reviewers created `UXR-` data;
a few areas (valid invite page, public roadmap with data, collab presence, non-admin
views, offline pill) were checked from source only and are marked as such.

## Verdict

The visual system is genuinely good — consistent tokens, real typefaces, calm density, dark
mode that holds up, no console errors or failed requests were captured by the mechanical sweep (see its data caveat below). The problems are not taste; they are **correctness bugs that
present as UX**: screens that show wrong data without saying so, a Markdown surface whose
headings and lists don't render, and mobile layouts that were not carried across the whole app.

## Blockers (fix first)

| ID | Where | Problem | Fix | Effort |
|---|---|---|---|---|
| DOC-02 | Editor | Inserting a Mermaid diagram throws "Content hole not allowed in a leaf node spec"; the error boundary replaces the whole page. | Drop the `0` hole in `mermaid-node.tsx` `renderHTML`; keep source in `data-code`. | S |
| DOC-01 | Editor everywhere (docs, issues, comments) | `prose*` classes are dead — `@tailwindcss/typography` isn't installed. h1/h2 compute to 16px/400, `ul/ol` to `list-style:none`. | Write real editor typography in `tiptap-editor.css` (or install the plugin). | M |
| ISS-01 | Issue list, Backlog, saved views, ≤390px | Title column measures 0px, rows 560px wide: phones show IDs and icons only. | Rework `issue-row.tsx` grid below `md` (title `minmax(0,1fr)`, drop secondary columns). | M |

## High

**Wrong results, no warning**
- ISS-02 — "is any of / is none of" filters always match nothing (form saves a scalar, engine expects an array); multi-label "is / is not" is wrong. Live: "Status is any of Todo" → 0 rows with 11 Todo issues (`filter-builder.tsx`, `filter-engine.ts:95-118,169`).
- DET-01 — one "blocks" relation renders as both "Blocks ENG-9" and "Blocked by ENG-9" (`relations-section.tsx:211-225`).
- DET-02 — Triage sub-issues are counted but never listed (`'triage'` missing in `sub-issue-list.tsx:20`).
- DET-03 — full issue page is a one-time snapshot: start date/parent not fetched, remote edits don't appear (`issue/[id]/page.tsx:37-52`).
- DOC-03 — title and body autosave share one debounce timer; editing both within 1s drops one (reproduced: title stayed "Untitled" after reload). No flush on unmount, no saved indicator.
- PLAN-02 — `paused` projects vanish from the Projects list (in neither status set).
- AUTH-15 — creating a workspace with an existing URL key shows "Internal server error" (reproduced).

**Dates (one root cause, four symptoms)** — `gantt-view.tsx` `parseDate` splits on `-` and can't read full ISO timestamps: ISS-03 (issue timeline draws everything starting today; dragging saves invented dates) and PLAN-01 (project Gantt same; project list and initiatives print `2026-10-01T00:00:00.000Z`). One shared date-parse + `useFormatters()` fix.

**Destructive / irreversible without a guard**
- TEAM-01 — team delete preselects "delete all issues", no typed confirmation, handler has no catch.
- ADM-02/03 — Suspend user, Make admin, Delete tenant (actually archives) are one click; your own row offers Suspend.
- SET-09 — "Enforce SSO" saves with no confirm; Test SSO redirect omits the workspace slug.
- ADM-04 — clearing a number field in the config console writes `0`.

**Mobile never finished**
- SET-01 — 208px settings rail never collapses; content crushed to ~110px.
- ADM-01 — admin shell has no responsive layout; 6–7 elements overflow at 320/390 (confirmed by sweep).
- NAV-01 — closed mobile sidebar drawer is only translated off-screen: Tab walks ~15 hidden controls, Escape doesn't close it, no focus trap. Use `inert` + Escape, or build on `ModalDialog`.
- Sweep — `/onboarding` overflows at 320 (15 elements); `/demo` has 269 targets <44px at 320/390 light.

**Design-system holes**
- SET-02 — Security, Integrations, Import use `border-border`/`border-input` with no `border` width: measured 0px, so cards and inputs have no boundary.
- DOC-05/06 — `tiptap-editor.css` has ~17 hex literals; `lint:tokens` doesn't scan `.css`, so it passed. Mentions have no CSS; code blocks vanish in dark mode; collab caret classes unstyled.
- PAL-01 — every command-palette row is centre-aligned (`<button>` default). Add `text-left` (`command-palette.tsx` 288, 323, 463).
- DOC-17/19 — docs list is identical "Untitled" rows with no date/author/actions; sidebar "Docs" highlight is lost on a doc page.
- PLAN-03 — create-project: two "Project created" toasts, target-before-start accepted, no lead picker.

## Medium themes

1. **Loading/empty flashes.** Sidebar shows "+ New team" and the URL key `demo` before "Demo Org" (NAV-02); empty / "Team not found" states flash before bootstrap (PLAN); editor area blank while the lazy bundle loads (DOC-11). Show skeletons until `syncStore` is ready.
2. **Command palette & shell.** Palette can't reach teams/projects/docs (PAL-03) and has no combobox/`aria-activedescendant` (PAL-02). No unread indicator anywhere in the shell (NAV-03); opening a notification doesn't mark it read (INB-01). Unknown workspace URL drops out of the shell to the root 404 (ERR-01). Favorite-remove button unreachable by keyboard/touch. Collapsed rail loses workspace name, favorites and team identity.
3. **Issue list ergonomics.** No grouping/ordering controls; labels are colour dots with no names; filtered-to-empty still says "press C to create one"; `x` clears the row cursor instead of selecting; context menu runs off-screen and isn't keyboard-operable; Save view only works in list mode; create modal has a single-line title and no ⌘↵; Status/Assignee/Label pickers have no search.
4. **Charts.** Burndown letterboxes on desktop, ~5px text on mobile, no scope line (late scope reads as a spike), last two x-labels collide.
5. **Forms & settings.** Team settings mixes instant-apply and save-on-click with one mid-page Save and no dirty cue (TEAM-02); automations builder wants hand-written JSON and uses an emoji toggle (SET-12). Roadmap settings placeholders look like values (PLAN); public roadmap password goes in `?password=` and a wrong one gives no error (AUTH-22, source only).
6. **Auth.** `/verify` has no Resend, wrong code isn't selected, no-email state is a dead end (AUTH-08/09/11); login says "sign-in link" but it's a 6-digit code (AUTH-01); no language/theme toggle on auth pages (AUTH-02); email input lacks `name`/autofocus/`inputMode` (AUTH-03); onboarding hardcodes `issuetracker.app/` (AUTH-13); invalid-invite page has no brand or CTA (AUTH-16).
7. **Consistency.** `PageHeader` filled in unevenly (Cycles lacks the team name, some lists lack counts, Triage count is plain text); hand-rolled 404 "Go home" and OAuth-error button; `/design` covers few of the primitives CLAUDE.md says not to hand-roll and clips a column on mobile (AUTH-26/27); start date reuses due-date red; "Todo" state colour invisible in light, blown out in dark.

## Accessibility (mechanical sweep)

**Data caveat:** the dev server dropped mid-sweep. Only ~56 records (all at 320px) come from a clean serial run; the 390/768/1440 numbers are from concurrent runs that sometimes captured pages before hydration, so treat counts (especially `h1` counts and small-target totals) as indicative, not exact. Contrast, overflow-at-320 and unnamed-control findings below were stable. Re-run `SWEEP_CONC=1 node sweep/run-sweep.js` against a healthy app to firm up the rest.

- Contrast: user-avatar initials fail — white on `#10b981` 2.54:1, on `#f97316` 2.8:1 (8–10px text, on ~14 routes). Sidebar team key `ENG` 4.18–4.29:1. `--foreground-faint` "—" cells 2.8–3.1:1 (audit log). `text-brand` links 4.43:1 in admin. Required-asterisk `text-destructive` 2.88:1 in dark. Fix avatar ink per swatch (the `--primary-foreground` approach used elsewhere).
- Unlabelled controls: bulk-select row checkboxes (14×14, three routes) and ~8 text/file inputs in settings/admin/`/design`.
- Tap targets: most pages have 8–12 <44px controls at 390; `/demo` and Backlog have hundreds (row checkboxes/avatars).
- Editor toolbar: 19-stop glyph strip with no `role="toolbar"`/`aria-pressed` (DOC-08).
- Sidebar nav links and the account button are 24–34px tall below `md` on ~22 routes; the 768px collapse button is 28×28.
- `/demo/issue/:id` reported no `h1`; `/admin/config` clips text at 320/390; `/demo/analytics` TOTAL header clipped.
- No console errors, failed requests or images missing `alt` were captured (subject to the caveat above).

**One discrepancy to be aware of:** the settings reviewer measured sideways overflow on settings/import/audit at 390 (143/192/50px); the sweep found none, probably because the overflowing elements sit inside a scroll container (unconfirmed). Either way the content column is crushed to ~110px, so SET-01 stands.

## What works well
Token layer and dark mode; the Linear-style information density; optimistic updates with undo toasts; command palette concept and keyboard coverage; `SectionCard`/`PageHeader`/`EmptyState` primitives where used; reduced-motion handling; i18n coverage.

## Suggested order of work
1. **Day 1 (all S):** DOC-02, PAL-01, SET-02, AUTH-15, shared ISO-date parsing (ISS-03/PLAN-01), `paused` status, duplicate toast, avatar ink contrast.
2. **Week 1:** DOC-01 editor typography + DOC-05 tokens (and extend `lint:tokens` to `.css`), ISS-01 mobile rows, ISS-02 filters, DET-01/02/03, DOC-03 save queue.
3. **Week 2:** mobile shell for settings + admin, NAV-01 drawer a11y, destructive-action guards (TEAM-01, ADM-02/03, SET-09), skeletons for first load.
4. **Then:** palette scope + combobox semantics, inbox unread, grouping/ordering controls, chart legibility, auth polish, `/design` completeness.

Worth a separate backend ticket: `issueCreate` with a completed `stateId` leaves `completedAt` null, so project progress shows 0% until the issue is updated.

## Per-area reports (full evidence)
`scratchpad/reports/`: `app-shell-navigation.md` (25), `issue-core-flows.md` (31), `planning-analytics.md` (35), `docs-editor.md` (23), `settings-admin.md` (22), `auth-public.md` (31), `sweep.md` (mechanical, all routes).
Screenshots: `scratchpad/{shell,ux,my,setadm,sweep/shots}/`.

## Deferred after remediation

Fixed in the remediation PR: every Blocker and High, and nearly every Medium/Low. What was
knowingly left, with the reason:

- **Editor:** selection bubble menu (no floating-ui dependency), floating table menu (a toolbar row ships instead), avatars in the `@` list, link hover card + scheme validation, an archived-docs view with restore (the archive copy no longer promises one).
- **Issue list/board:** one tab stop per row (ISS-11), nested scroller for very large groups (ISS-14), adding a filter with a single click, filters serialised to the URL (closing the detail panel replaces the URL), per-column "+" on the board (needs a default-status argument on the global create modal), hiding the Status cell when grouped by status (would break the `s` shortcut).
- **Planning:** `PageHeader` height (shared chrome), stat-card colour legend, a phone-width pass on analytics, Gantt sticky name column and legend rework, project detail tabs/right rail (PLAN-14).
- **Settings/admin:** splitting personal vs workspace settings into an "Account" rail entry (SET-06), admin pages still hand-roll their `h1` (ADM-07), no server guard against self-impersonation.
- **Auth:** product-copy decisions on the canvas headline (AUTH-07), live URL-key availability check, `/design` Tooltip/Tabs and side-by-side contrast ratios.
- **Shell:** "mark unread" needs a server mutation; Triage keeps its count in `actions` because five e2e specs assert "{n} to triage"; create-modal heading/position (NEW-01).
- **Unverified:** RT-05 (Mermaid occasionally saved empty source in 2 of ~8 early runs) could not be reproduced in 12 later runs; the node now only closes after the attribute lands, with one retry.
- **Visible design changes worth a look:** the light Aurora/Ion brand text is darker (L 0.55) so `text-brand` clears 4.5:1; mid-tone avatar swatches are darkened for legible initials.
