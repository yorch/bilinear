# UI/UX Assessment — bilinear

_Date: 2026-07-04. Method: six parallel code audits (design system, navigation/IA, core issue flows, accessibility, feedback/states, responsive+i18n) over `src/components` (~92 components), `src/app`, and the sync/i18n/toast infrastructure. All headline findings were re-verified against the source before inclusion; file:line references point at the audited revision (`4855b34`)._

> **Progress (same branch, 2026-07-04):** Phases 0–2 of the roadmap in §8 are implemented, followed by a full code-review + simplify pass over the changes.
>
> - **Phase 0** — all nine §1 bugs fixed (dead sidebar links + new saved-view route, destructive token, palette submenus wired + persisted, `showModal()`, board due dates, `--font-sans`, global shortcuts + `GlobalCreateIssueModal`, automations link).
> - **Phase 1** — toast wrapper extended (`undo`/`promise`/`loading`/`dismiss`); every silent optimistic rollback now toasts; archive undo (new `issueUnarchive` client mutation); shared `ConfirmDialog` gating issue delete; `ConnectionStatus` pill + `ConnectionToasts`; `global-error.tsx` + `not-found.tsx`; `TransactionQueue` default error handler for callback-less permanent failures.
> - **Phase 2** — `SelectPopover`/`SearchableSelectPopover` ARIA + keyboard + focus management with a coherent Escape contract (an open popover consumes the keypress; parent surfaces ignore handled Escapes); new `Input`/`Textarea`/`Switch` primitives (switches fully migrated; create-project/team/save-view modals on `Input`/`Textarea`); `prefers-reduced-motion`; skip link; board `KeyboardSensor` with labeled drag handles; shared `useIssueCreate`/`useIssueUpdate` hooks and `toIssueUsers`/`toIssueLabels` mappers replacing per-page copies.
>
> Still open: Phase 3 (token migration), Phase 4 (flow polish — includes `ConfirmDialog`/`SettingToggleRow` adoption across settings, remaining `Input` call sites), Phase 5 (mobile), plus the Phase 1 leftovers (inline retry for swallowed fetch errors, bootstrap-error retry, pending-write indicators, in-modal team picker for the global create modal).
>
> **Rebased onto `main` (2026-07-04, PRs #87/#88):** three of the four §7 i18n gaps and most of Phase 6 landed independently on `main` — admin console fully translated under `admin.*`, real `Intl.PluralRules` pluralization (`_one`/`_other` suffixes, replacing the manual `*Singular`/`*Plural` pairs this branch's new keys were careful not to depend on), and locale-aware admin dates via the new `useFormatters()` hook. This branch's `board-view.tsx` due-date formatting was migrated to `useFormatters()` to match. Remaining open: `formatFileSize` decimal locale, sidebar text-expansion audit, surfacing the locale toggle outside the sidebar footer.

---

## Executive summary

The product has a **strong engine and an under-invested surface**. The offline-first sync stack (Dexie bootstrap, optimistic writes, delta sync), the command palette, slash commands, mention pickers, and the i18n core are genuinely good — several are better than typical. But the UI layer systematically bypasses its own design system, stays silent when things fail, has broken navigation links in the sidebar, is desktop-only, and concentrates its accessibility debt in the three shared primitives every feature reuses.

The encouraging part: most problems are **systemic, not scattered**. Roughly five root causes (token-layer bypass, a four-method toast wrapper, three flawed shared primitives, no shared page-header/confirm primitives, zero responsive strategy) explain the large majority of the ~140 individual findings. Fixing the shared pieces fixes dozens of call sites at once.

### Scorecard

| Dimension | Grade | One-line verdict |
|---|---|---|
| Design system & styling | ⚠️ Poor | Good oklch token layer exists but is bypassed by ~1,255 raw `zinc/indigo` usages and ~1,046 manual `dark:` overrides — two parallel design systems |
| Navigation & IA | ⚠️ At risk | Solid Linear-style shell, but sidebar contains dead links, settings sub-pages are dead-ends, shortcuts advertised as global aren't |
| Core issue flows | 🟡 Mixed | Create/list/board/triage all functional and fast; failure feedback, keyboard coverage, and detail-panel performance lag |
| Accessibility | 🟡 Moderate | Biome a11y lint on, palette is exemplary; but `SelectPopover`, `ModalDialog`, and `usePopover` fail basics, multiplied across the app |
| Feedback & state UX | ⚠️ Weak | Silent optimistic rollbacks, no offline indicator, destructive delete with no confirm/undo, swallowed fetch errors |
| Responsiveness | 🔴 Absent | 10 breakpoint utilities in the whole tree; no mobile nav; fixed 480px panel; desktop-only today |
| i18n | 🟢 Good | ~85% coverage, locale-threaded dates, no flash-of-English; admin console and plural rules fixed on `main` since; remaining gap: `formatFileSize` |

---

## 1. Verified bugs (fix first — these are broken today)

Each of these was re-verified by hand, not just agent-reported.

### 1.1 Sidebar favorite links to issues 404
`src/components/layouts/sidebar.tsx:108` builds `${base}/team/${key}/issues/${e.id}`, but no `team/[key]/issues/[id]` route exists (team subroutes are only `analytics/backlog/cycles/docs/settings/triage`). The real route — used by the command palette — is `/{workspace}/issue/{id}`.
**Fix:** `return `${base}/issue/${e.id}``.

### 1.2 All saved-custom-view links 404
`sidebar.tsx:116` (favorites) and `sidebar.tsx:380` (per-team list) link to `${base}/team/${key}/view/${id}`; no `view` route exists anywhere under `src/app`. Users can *create* views (`team/[key]/page.tsx:716`) but every sidebar entry for them is a dead link.
**Fix:** add `team/[key]/view/[id]/page.tsx` rendering `IssueListView` with the view's stored filters.

### 1.3 Destructive buttons render red-on-red in light mode
`src/app/globals.css:52-53`: `--destructive-foreground` is set to the **same value** as `--destructive` (`oklch(0.577 0.245 27.325)`). `Button variant="destructive"` (`bg-destructive text-destructive-foreground`) produces invisible text. Dark mode pairs two saturated reds too (`:85`).
**Fix:** `--destructive-foreground: oklch(0.985 0 0)` in both themes.

### 1.4 Command-palette quick-action submenus are unreachable dead code
`command-palette.tsx:34-48` defines setStatus/setAssignee/setPriority/setLabel submenus and renders them (`:239-308`), but nothing ever sets `subMenu` to a `set*` type — the keyboard handler (`:475-497`) only navigates/selects/escapes, and `selectItem` (`:407`) only routes to the issue. The only writes to `setSubMenu` reset it to `'none'`.
**Fix:** add an entry point (e.g. `Tab`/`→` on a highlighted issue result opens the action submenu), or delete the feature.

### 1.5 Modals aren't modal
`src/components/ui/modal-dialog.tsx:26-49` renders `<dialog open>` (never calls `showModal()`): no focus trap, no inert background, no focus restoration, and Escape only works if focus happens to be inside. This backs create-issue, create-project, create-team, save-view, etc.
**Fix:** call `dialogRef.current.showModal()` on open (native trap + Escape + top layer), restore focus on close. This one change fixes modal a11y app-wide.

### 1.6 Board cards show raw ISO due dates
`src/components/issues/board-view.tsx:117` renders `{issue.dueDate}` directly → `2026-07-04T00:00:00.000Z` on cards, while list rows and the detail panel use `formatDueDate` + `getDueDateColor`.
**Fix:** reuse the same formatter/color helpers.

### 1.7 The app never uses its own font token
`globals.css:29` defines `--font-sans: ui-sans-serif, system-ui, ...`, but `body` (`globals.css:101`) hardcodes `font-family: Arial, Helvetica, sans-serif`. The whole app renders in Arial.
**Fix:** `font-family: var(--font-sans)` (and consider a proper UI font, e.g. Inter var).

### 1.8 Shortcut-help modal advertises shortcuts that don't work globally
`shortcut-help-modal.tsx:21,28,31` lists `C` (create), `G→I`, `G→N` as global, but they're registered only inside `team/[key]/page.tsx:375,478,480`. On projects, initiatives, inbox, settings, or issue detail they silently do nothing.
**Fix:** register them in `workspace-client.tsx` beside the existing global Cmd+K / Cmd+B / `?`.

### 1.9 `/settings/automations` is orphaned
The page exists but is absent from the settings index quick-links (`settings/page.tsx:912-942`) and nothing else links to it (verified: zero references).
**Fix:** add it to the settings nav (see §3.4).

---

## 2. Root causes — five fixes that resolve most findings

### RC1. The token layer is bypassed app-wide
`globals.css` has a complete, well-structured oklch token set with light/dark parity — and the app doesn't use it. ~1,255 raw `zinc-*`/`indigo-*` class usages and ~1,046 manual `dark:` overrides across ~108 files re-implement what `bg-background/card/popover`, `text-muted-foreground`, and `border-border` already encode. Even the UI primitives meant to enforce the system hardcode zinc (`select-popover.tsx:44,59`, `select.tsx:46,66,82`, `modal-dialog.tsx:43`, `skeleton.tsx:9`).

Two knock-on effects:
- **No brand token.** `--primary` is near-black (`globals.css:44`) while the product's actual primary is `indigo-600`, hand-rolled on 35+ buttons. That's *why* `Button` is imported in only ~11 files — its default variant renders black.
- **Visible drift.** e.g. the issue detail panel border is `dark:border-zinc-700` (`issue-detail-panel.tsx:180`) while every other panel is `dark:border-zinc-800`; chart tokens (`--chart-*`) exist but charts hardcode the same hex (`burndown-chart.tsx:116-124`, `burnup-chart.tsx:116-122`, `analytics/page.tsx:208-243`).

**Fix (ordered):**
1. Point `--primary`/`--ring` at indigo oklch values (light+dark); fix `--destructive-foreground` (§1.3).
2. Convert the `ui/` primitives to tokens first — they're the reference everything copies.
3. Codemod raw palette → tokens (`bg-white→bg-card`, `border-zinc-200 dark:border-zinc-700→border-border`, `text-zinc-500 dark:text-zinc-400→text-muted-foreground`, `bg-indigo-600...→<Button>`), deleting the now-redundant `dark:` variants.
4. Wire charts to `var(--chart-*)`; set `body` to `var(--font-sans)`.
5. Add a lint guard (Biome `noRestrictedImports`-style regex or a CI grep) banning raw `zinc-`/`indigo-`/hex classes in `src/components` and `src/app`.

### RC2. The toast wrapper structurally prevents good feedback
`src/lib/toast.ts` exposes only `error/info/success/warning`. No `promise`, `loading`, `dismiss`, or `action`. Undo toasts, pending-write toasts, and long-op progress toasts are therefore *impossible*, and the app defaulted to silence:

- **Silent optimistic rollback** on every TransactionQueue mutation on the main surfaces — status/assignee/priority/label edits, drag-reorder, archive (`team/[key]/page.tsx:228-234,331-333`, `my-issues/page.tsx:128-132`, `backlog/page.tsx:296`, `cycle-detail-view.tsx:219`). The UI just snaps back. Triage does it right (`triage/page.tsx:203-207`) — proving the inconsistency.
- **Silent create failure**: `team/[key]/page.tsx:303-308` only `console.error`s and deletes the temp row; the user believes the issue was saved.
- **One-click permanent delete**: context-menu Delete (`team/[key]/page.tsx:346-367`) has no confirmation and no undo. Archive (`E`) has no undo either.
- **Dropped writes after reload**: re-hydrated queue transactions process without callbacks and are dropped on permanent failure (`transaction-queue.ts:42-48,135-144,219-224`) — the optimistic edit stays visible in IndexedDB-backed UI even though it never reached the server.

**Fix (ordered):**
1. Extend `lib/toast.ts` to pass through sonner's `action`, `promise`, `loading`, `dismiss`.
2. Add `toast.error` to every `TransactionQueue.enqueue` `onError`; better, add a `mutateOptimistic(store, id, patch, mutation)` helper so feedback can't be forgotten.
3. "Deleted — Undo" / "Archived — Undo" toasts for the destructive issue actions (or a shared `<ConfirmDialog>`; today three confirm patterns coexist — `window.confirm` in settings, inline two-step in team-member management, nothing for issue delete).
4. Surface a "some changes couldn't be saved" notice for dropped rehydrated transactions.

### RC3. Offline-first product with zero connection UI
`syncStore.status`/`wsConnected` are tracked (`sync-store.ts:9,31`) and flipped on WS disconnect and browser online/offline events (`sync-manager.ts:1062-1105`) — but **never rendered**. No indicator, no "reconnecting…", no "back online" (PATTERNS.md §865 documents a toast that was never implemented). Queued/pending writes are pixel-identical to synced ones. Bootstrap failure sets an error string that is never displayed and has no retry path (`sync-manager.ts:307-311,508-514`).

**Fix:** a connection-status pill in the sidebar footer bound to `syncStore`, offline→online transition toasts, a subtle "syncing" dot on rows with in-flight transactions, and a retry button on the bootstrap-error state. This is the single most differentiating polish item for an offline-first tracker.

### RC4. Three shared primitives carry the a11y debt
Biome's a11y rules are on and the command palette is genuinely well-built (roles, aria-modal, arrow keys). The debt is concentrated where it multiplies:

| Primitive | Gaps | Blast radius |
|---|---|---|
| `SelectPopover` (`ui/select-popover.tsx:42-67`) + `usePopover` (`hooks/use-popover.ts:15`) | No `aria-expanded`/`aria-haspopup`, no `listbox`/`option` roles, no arrow-key navigation, focus never moves in or restores, and **Escape is off by default** (`closeOnEscape=false`) | Every property picker: status, priority, assignee, project, cycle, label, estimate, due date |
| `ModalDialog` (§1.5) | Non-modal `<dialog open>`; no trap/restore | Every modal |
| `SearchableSelectPopover` (`ui/searchable-select-popover.tsx:69-124`) | Same ARIA gaps, no arrow keys | All searchable selects |

Plus four cheap global wins: no `prefers-reduced-motion` handling anywhere; no skip-to-content link; form fields labeled by placeholder only (`create-issue-modal.tsx:243-251` representative); validation errors not announced outside auth (`aria-invalid`/`aria-describedby` in only 2 files). Board drag-and-drop has no `KeyboardSensor` (`board-view.tsx:412-418`) — the kanban is pointer-only.

**Fix:** repair the three primitives (roles + keyboard + focus + Escape default true), add the reduced-motion media query and skip link (both ~5 lines), add `KeyboardSensor` with `sortableKeyboardCoordinates`, and adopt a labeled-input pattern in `ui/input.tsx` (see RC5).

### RC5. Missing shared primitives → per-page drift
No `Input`, `Textarea`, `Switch`, `PageHeader`, `Breadcrumb`, `EmptyState`, or `ConfirmDialog` primitives exist, so each page hand-rolls them and drifts:

- The exact input class string is copy-pasted 4× in `create-project-modal.tsx` alone (`:127,147,208,224`) and across every modal/settings page (346 raw `<input>/<button>/<select>` in 89 files).
- The iOS switch is re-implemented with template literals in at least 5 places (`settings/roadmap/page.tsx:208-214`, `settings/page.tsx:611,887`, `team/[key]/settings/page.tsx:502,529`).
- Page headers disagree on size, padding, and tokens: `text-sm`+`px-6 py-3` vs `text-xl` vs `text-lg`, `px-6 py-4` vs `px-5 py-3` (`settings/page.tsx:369` vs `security/page.tsx:310` vs `automations/page.tsx:152`; `projects/page.tsx:76` vs `my-issues/page.tsx:269` vs `analytics/page.tsx:456`).
- Three focus-ring conventions coexist (`focus-visible:ring-1 ring-ring` vs `focus:ring-1 ring-indigo-500` vs `focus:ring-2 ring-indigo-400 ring-offset-2`; 59 occurrences).
- Empty states range from icon+copy+CTA (issues, projects, notifications) to a bare gray sentence (initiatives `initiatives/page.tsx:330`, no-teams first-run `workspace-no-teams.tsx:8`).

**Fix:** add `ui/input.tsx`, `ui/textarea.tsx`, `ui/switch.tsx`, `shared/page-header.tsx`, `shared/empty-state.tsx`, `shared/confirm-dialog.tsx`; standardize on `focus-visible:ring-2 ring-ring`; migrate incrementally (each modal/settings page is a small, safe PR).

---

## 3. Navigation & IA improvements

1. **Settings needs a layout shell.** 8 settings pages, no `settings/layout.tsx`, no back-links — every sub-page is a dead-end reachable only via browser-back. Add a persistent settings nav rail (Linear pattern) with active-section highlight; include the orphaned Automations page (§1.9).
2. **No document titles.** No `generateMetadata` in any `(workspace)` page — every tab reads the same root title. Add per-route titles (issue identifier + title, project name, team key).
3. **No breadcrumbs / lost context.** Issue detail close always routes to the team root (`issue/[id]/page.tsx:136`), discarding where you came from (my-issues, project, search). Add breadcrumbs on detail routes and return-to-referrer on close.
4. **Command palette is thin.** Only two actions (Create Issue, Go to Settings — `command-palette.tsx:98-123`). Add navigation verbs (Inbox/My Issues/Projects/Initiatives/teams), create-project/view, and theme + language switch. Identifier jump and recent items are already good.
5. **Sidebar scale problems.** Teams always render all subroutes + every custom view inline with no per-team collapse (`sidebar.tsx:327-398`); favorites vanish entirely in collapsed mode (`:174`); Initiative/Cycle favorites don't deep-link to their target (`:113,120`); active state is a fragile `startsWith` exclusion chain (`:292-303`). Add per-team collapse (persisted), favorite icons in the rail, deep links, and segment-based active state.
6. **Discoverability.** `?` help is hinted nowhere; add it to the palette footer and sidebar help entry. No visible search affordance — add a search row in the sidebar that opens the palette. No workspace/team switcher in the header.
7. **First-run experience.** `workspace-no-teams.tsx` is one gray sentence; the only create affordance is a small "+" in the sidebar. Give it an empty state with a primary "Create your first team" CTA and next steps.

---

## 4. Core-flow improvements (issues surface)

**Issue creation** (`create-issue-modal.tsx`)
- No "Create more" toggle; modal always closes on submit.
- Draft silently lost on Escape/backdrop click (no dirty-guard, no persistence).
- No `mod+Enter` submit once focus is in the TipTap body.
- Cannot set cycle or estimate at creation even on teams that use them (`:280-306`).

**Issue detail panel** (`issue-detail-panel.tsx`)
- **Query waterfall:** AiInsights, sub-issues, relations, PRs, attachments, comments, activity, reactions each fetch independently on mount — the panel pops in section by section. Batch into one detail query or lazy-load below-the-fold sections.
- Property sidebar is missing **Cycle** (present in row + creation paths).
- Real-time conflict: incoming sync reseeds `titleDraft` via `useEffect([issue])` (`:86-94`) and can clobber a title mid-edit (description is Yjs-safe). Skip reseed while editing.
- Read-only description mounts the full lazy TipTap bundle just to display HTML (`:359-368`) — render static sanitized HTML until edit.
- No backdrop dim; 480px panel reads detached (`:172`).

**List** (`issue-list-view.tsx`, `group-section.tsx`)
- No select-all; `x` toggles single selection rather than the checked set; shift-click ranges only.
- Per-group virtualization creates nested scrollbars (600px inner scroll containers inside the page scroll, `group-section.tsx:42-99`); flatten to one page-level virtualizer.
- List is hard-grouped by state with fixed sort — no group-by/sort controls (board has group-by; list doesn't).
- Context menu lacks status/assignee/priority quick edits (`issue-context-menu.tsx:59-106`).
- `Issue.branchName` exists in schema and create flow but "Copy git branch name" is surfaced nowhere — table stakes for a Linear-alike.

**Board** (`board-view.tsx`)
- No `KeyboardSensor` (RC4); no column collapse or WIP indicators; raw ISO due date (§1.6); click model (single-select, double-open) differs from the list and is undiscoverable.

**Filters** (`filter-builder.tsx`)
- Value pickers are native `<select>`s — unsearchable, inconsistent with `SelectPopover` (`:207-256`).
- Single global AND/OR toggle; no grouped conditions.
- No "update saved view in place" from current filter state.

**Triage** (`triage/page.tsx`)
- Entirely click-driven — add row focus + `a`/`d`/`s`/`m` hotkeys (Linear triage is keyboard-first).
- "Mark duplicate" uses `window.prompt` for the identifier (`:277`, same in `relations-section.tsx:145,339`) — replace with a searchable issue picker.
- Accept always targets the first backlog state with no choice (`:184-213`).
- Otherwise the triage optimistic/rollback/toast pattern is the model the rest of the app should copy.

**Full issue page** — `issue/[id]/page.tsx:158-168` renders the 480px peek panel floating in an empty flex row. Refresh/open-in-new-tab lands on this awkward view. Build a real full-page layout (wide description + right property rail).

**Other**
- Reactions and comment reactions refetch the whole list per toggle — make them optimistic.
- Image paste/upload has no placeholder, progress, or failure feedback; >2MB files are silently dropped (`tiptap-editor.tsx:107-156`). Attachments upload sequentially behind one indeterminate spinner (`file-attachments.tsx:74-97`).
- Bulk update of up to 200 issues has no progress and all-or-nothing silent rollback.
- Empty state doesn't distinguish "no issues" from "filters match nothing" (`issue-list-view.tsx:134-145`) — offer "Clear filters".
- Link insertion uses `window.prompt` (`tiptap-editor.tsx:742`).

---

## 5. Error/loading-state gaps

- **Missing `global-error.tsx`**: a provider crash in the root layout renders Next's unstyled default. Add one (with own `<html>/<body>`).
- **Missing `not-found.tsx`** at every level: bad workspace/team/issue URLs lose the app shell.
- **Swallowed fetch errors**: `issue-reaction-bar.tsx:40-42`, `activity-timeline.tsx:105-106`, `comment-thread.tsx:63-64`, `file-attachments.tsx:62` all `catch {}` — a failed fetch is indistinguishable from "no data". Add inline "Couldn't load — Retry".
- **Cold-load empty-state flash**: projects and inbox don't gate on `syncStore.status`, so they flash "No projects yet" during bootstrap (`projects/page.tsx:119-123`) — unlike team/my-issues/backlog which gate correctly.
- **Loading treatment drift**: route `loading.tsx` shows proper skeletons, but in-page branches render plain "Loading…" text (`my-issues/page.tsx:250-256`; error branch at `:258-263` has no retry). Reuse the skeleton components; add retry.

---

## 6. Responsive & mobile (largest single investment)

Current state: 10 breakpoint utilities across 8 files, none on the app frame. The `w-56` sidebar is always visible (60% of a 375px viewport), the detail panel is fixed `w-[480px]` (`issue-detail-panel.tsx:176`), modals have no `max-h`/scroll and touch the screen edges (`modal-dialog.tsx:28,42-45`), board columns are fixed `w-72`, and the bulk-action bar overflows both edges (`bulk-action-bar.tsx:33`). Hover-only affordances (7 files) and sub-40px icon buttons (110 occurrences across 44 files, mostly `title`-only labels) make touch use impossible.

**Phased fix:**
1. **App frame:** off-canvas sidebar drawer + backdrop below `md`, mobile top bar with hamburger; keep static rail at `md+`. (Unblocks everything else by reclaiming width.)
2. **Overlays:** detail panel becomes a full-screen sheet below `md` (`w-full max-w-[480px]`); `ModalDialog` gets `max-h-[90vh] overflow-y-auto` + bottom-sheet treatment below `sm`.
3. **Content:** board columns `w-[85vw] max-w-72 sm:w-72`; bulk bar `max-w-[calc(100vw-2rem)] flex-wrap`; toolbars get `flex-wrap`.
4. **Touch:** ≥44px hit areas via padding; persist hover-revealed actions below `md` (or `@media (hover: none)`); `aria-label` on all icon buttons (fixes a11y finding simultaneously).

---

## 7. i18n gaps

1. ~~**Admin console is 0% translated**~~ — **Fixed on `main`** (PR #87): the `(admin)` console and `ImpersonationBanner` are now fully translated under the `admin.*` namespace.
2. ~~**No plural rules**~~ — **Fixed on `main`** (PR #87): `translate()` resolves `key_one`/`key_other` CLDR-category siblings via `Intl.PluralRules` whenever a call passes `{ count }`; the manual `*Singular`/`*Plural` key pairs were deleted in favor of the suffixed form.
3. **`formatFileSize`** hardcodes `.` decimals (`src/lib/utils.ts:51-59`) — use `Intl.NumberFormat` with the active locale. *(Still open.)*
4. ~~**Admin dates** use bare `.toLocaleDateString()` with no locale~~ — **Fixed on `main`** (PR #87): admin pages now go through the new `useFormatters()` hook (`src/hooks/use-formatters.ts`), which threads `INTL_LOCALES` automatically.
5. **Text-expansion headroom**: Spanish runs ~25% longer; the frozen `w-56` sidebar truncates "Configuración"/"Cerrar sesión". Verify truncating labels against `es`, consider `w-60`. *(Still open.)*
6. Locale toggle only lives in the sidebar footer — it disappears once the sidebar becomes a mobile drawer; also surface in settings. *(Still open.)*

---

## 8. Suggested roadmap

| Phase | Theme | Contents | Effort |
|---|---|---|---|
| **0. Bug fixes** | Broken today | §1.1–1.9: sidebar dead links, custom-view route, destructive token, palette submenu entry point, `showModal()`, board due date, `var(--font-sans)`, global hotkeys, automations link | ~1–2 days |
| **1. Feedback layer** | Trust | Extend toast wrapper (`action/promise/loading/dismiss`); error toasts on all queue `onError`s; delete/archive undo; connection-status pill + offline toasts; pending-write dots; `global-error.tsx` + `not-found.tsx`; retry on swallowed fetches | ~3–5 days |
| **2. Primitive repair** | Multiplied wins | `SelectPopover`/`usePopover`/`SearchableSelectPopover` ARIA + keyboard + focus + Escape; `ModalDialog` sub-components (Header/Footer, max-h); new `Input`/`Textarea`/`Switch`/`ConfirmDialog`/`PageHeader`/`EmptyState`; reduced-motion + skip link; board `KeyboardSensor` | ~1 week |
| **3. Token migration** | Design system | Indigo `--primary`; primitives → tokens; codemod raw palette → tokens (deletes ~1k `dark:` overrides); charts → `var(--chart-*)`; lint guard; Button/Badge adoption | ~1 week, mechanical |
| **4. Flow polish** | Linear parity | Settings layout rail; document titles; breadcrumbs/return-to-referrer; palette actions; create-more + dirty-guard; detail-panel batching + cycle field; select-all + list group/sort; context-menu quick edits; copy-branch-name; triage hotkeys; searchable duplicate picker; filter popovers; full issue page | ~2 weeks, parallelizable |
| **5. Mobile** | New surface | §6 phases 1–4 | ~1–2 weeks |
| **6. i18n round-out** | Coverage | ~~Admin namespace; plural rules; number/date locale in admin~~ (done on `main`, PR #87); `formatFileSize` locale, expansion audit, locale-toggle discoverability remain | ~1 day remaining |

Phases 1–3 are the highest leverage: they fix shared infrastructure that every later phase builds on, and phase 3 is largely mechanical once the primitives are token-based.

---

## 9. What's already good (don't regress)

- Offline-first data layer: instant cache-hit loads, IndexedDB-persisted transaction queue with session scoping, delta sync.
- Command palette internals: fuzzy identifier jump, recent items, correct dialog/listbox semantics, lazy loading.
- Editor: slash commands, `@`/`#`/`~` mention pickers with viewport clamping, code-block highlighting, Yjs-collaborative descriptions.
- i18n core: shared client/server resolver, cookie persistence, SSR `<html lang>`, no flash-of-English, locale-threaded `date-fns`/`Intl` in the workspace app, near-total attribute coverage.
- Triage's optimistic snapshot → rollback → toast pattern (the template for RC2).
- Biome a11y linting enabled with honest, justified suppressions; lucide-react used consistently; `cn()` discipline (only 5 template-literal violations); route-level skeletons.
