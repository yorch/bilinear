# Frontend Review — Bilinear

_Last updated: 2026-06-07 · Status: All tiers complete_

## Conventions (baseline)

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 6 strict mode
- **Styling:** Tailwind CSS v4 only — no CSS Modules, no styled-components. `cn()` (clsx + tailwind-merge) for class merging. CSS custom properties for theme tokens (oklch). CVA for component variants.
- **State:** MobX 6 observable pools per domain (`IssueStore`, `TeamStore`, etc.) accessed via `useStore()`. Local `useState` for ephemeral UI state. No Redux/Zustand/React Query/SWR.
- **Structure:** `src/components/<feature>/` — feature-grouped, kebab-case filenames. Shared primitives in `src/components/ui/` (7 files). Cross-feature building blocks in `src/components/shared/`. Hooks in `src/hooks/`. Utilities in `src/lib/`.
- **Data fetching:** Custom `gql()` helper (no Apollo Client on the frontend). Bootstrap + delta sync via `/api/sync/*`. Real-time via WebSocket. All writes go through `TransactionQueue`.
- **Server/Client boundary:** Every interactive component is `'use client'`. Pages/layouts are server components. `dynamic()` with `ssr: false` for heavy client-only widgets (CommandPalette, TipTap).
- **Commands:** typecheck=`yarn typecheck` lint=`yarn lint` test=`yarn test` build=`yarn build`
- **Linting:** Biome 2.4 — single quotes, arrow parens as-needed, sorted imports/object-keys, block statements required. No ESLint/Prettier.
- **Component pattern:** `observer()` wraps any component that reads MobX stores. `useStore()` to access `RootStore`. `useHotkeys`, `useOutsideClick`, `usePopover` from `src/hooks/`.
- **Toast:** `@/lib/toast` wrapper only — never import sonner directly.
- **Lazy loading:** `.lazy.tsx` suffix for large components (`TipTapEditor`, `IssueDetailPanel`). `dynamic()` for Next.js code-splitting.

---

## Summary

| ID  | Title | Severity | Category | Tier | Status |
|-----|-------|----------|----------|------|--------|
| F01 | `cn()` not used in `PrStateIcon` className — appends `"undefined"` | Medium | Types | Safe | [x] |
| F02 | `useParams` type too broad in `WorkspaceClient` | Low | Types | Safe | [x] |
| F03 | Collapse button missing `aria-expanded` in `GroupSection` | Medium | A11y | Safe | [x] |
| F04 | Comment action buttons hidden from keyboard (opacity-0) | High | A11y | Safe | [x] |
| F05 | `QUICK_EMOJIS` constant duplicated in two files | Low | Reuse | Structural | [x] |
| F06 | `PRIORITY_LABELS`/`PRIORITY_OPTIONS` duplicated across `board-view` and `filter-builder` | Medium | Reuse | Structural | [x] |
| F07 | Update forms copy-pasted between `project-updates-section` and `initiative-updates-section` | High | Reuse | Structural | [x] |
| F08 | `CommentCard` and `CommentComposer` inlined in 660-line `comment-thread.tsx` | Medium | Composition | Structural | [x] |
| F09 | Sidebar (579 lines) mixes global nav, teams, favorites, and footer into one component | Medium | Composition | Structural | [x] |
| F10 | `CreateIssueModal` has 8 independent `useState` calls that could be one form-state object | Low | State | Structural | [x] |
| F11 | Derived issue counts recalculated inline on every render in `ProjectListView` and `ProjectDetailView` | High | Perf | Structural | [x] |
| F12 | `statesById`/`usersById` Maps rebuilt on every render in `CsvExportButton` | Low | Perf | Structural | [~] |
| F13 | Grouped-issues Map rebuilt on every render in `SubIssueList` | Low | Perf | Structural | [x] |
| F14 | `WorkspaceClient` `dynamic()` import wraps named export unnecessarily | Low | Convention | Structural | [x] |
| F15 | `reactionCounts` reduce runs on every render inside `CommentCard` | Low | Perf | Structural | [x] |

_[x] = done · [~] = won't do (false positive)_

---

## Findings

### F01 — `cn()` not used in `PrStateIcon` — string `"undefined"` injected into className

- **Severity:** Medium
- **Category:** Types / Convention
- **Tier:** Safe
- **Files:** `src/components/issues/pull-requests-section.tsx:89,92,96`
- **Problem:** `PrStateIcon` builds Tailwind classNames via template literals: `` `h-4 w-4 text-purple-500 ${className}` ``. When `className` is `undefined` (the prop's default), the string `"undefined"` is literally appended to the DOM class attribute. This conflicts with Tailwind's deduplication and is a pattern mismatch — the entire repo uses `cn()` for class merging.
- **Proposed change:** Replace all three template literals with `cn('h-4 w-4 text-...', className)`.
- **Status:** [x] Done — added `cn()` import and replaced template literals.

---

### F02 — `useParams` generic typed as `{ workspace?: string }` — makes key optionally undefined inside guaranteed route

- **Severity:** Low
- **Category:** Types
- **Tier:** Safe
- **Files:** `src/components/layouts/workspace-client.tsx:39`
- **Problem:** `WorkspaceClient` lives inside the `(workspace)/[workspace]/` segment, so `params.workspace` is always a non-empty string at runtime. Typing it as `string | undefined` creates dead-code branches and suppresses useful TypeScript narrowing downstream.
- **Proposed change:** Change generic to `{ workspace: string }`.
- **Status:** [x] Done

---

### F03 — Collapse button in `GroupSection` missing `aria-expanded`

- **Severity:** Medium
- **Category:** A11y
- **Tier:** Safe
- **Files:** `src/components/issues/group-section.tsx:105`
- **Problem:** The group header `<button>` toggles `collapsed` state but conveys no state to assistive technology. Screen readers announce it as a plain button with no indication of whether the group is expanded or collapsed.
- **Proposed change:** Add `aria-expanded={!collapsed}` to the button element.
- **Status:** [x] Done

---

### F04 — Comment action buttons invisible to keyboard users (`opacity-0` on hover only)

- **Severity:** High
- **Category:** A11y
- **Tier:** Safe
- **Files:** `src/components/issues/comment-card.tsx` (was `comment-thread.tsx:382`)
- **Problem:** The actions container (`flex items-center gap-1 opacity-0 group-hover:opacity-100`) is fully transparent until the mouse hovers over the comment card. Keyboard users who Tab into the contained buttons cannot see them and have no indication they exist. The "Resolve", "React", and "More" controls are effectively unreachable without a mouse.
- **Proposed change:** Add `group-focus-within:opacity-100` to the container className so keyboard focus on any child button reveals the bar.
- **Status:** [x] Done — applied in `comment-card.tsx` during WS3 extraction.

---

### F05 — `QUICK_EMOJIS` array defined identically in two files

- **Severity:** Low
- **Category:** Reuse
- **Tier:** Structural (WS2)
- **Files:** `src/components/issues/comment-thread.tsx`, `src/components/issues/issue-reaction-bar.tsx`
- **Problem:** `const QUICK_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '🚀', '👀', '😕']` was copy-pasted verbatim. Any future change to the emoji set required updating both files.
- **Proposed change:** Move to `src/lib/issue-utils.ts` and import from both sites.
- **Status:** [x] Done — exported from `issue-utils.ts`; local copies removed from both consumers.

---

### F06 — `PRIORITY_LABELS` / `PRIORITY_OPTIONS` duplicated across `board-view` and `filter-builder`

- **Severity:** Medium
- **Category:** Reuse
- **Tier:** Structural (WS2)
- **Files:** `src/components/issues/board-view.tsx`, `src/components/issues/filter-builder.tsx`
- **Problem:** Both files independently defined a mapping of priority integer → label + icon/color. The data was identical. Divergence would cause inconsistent labels.
- **Proposed change:** Extract to `src/lib/issue-utils.ts` and import from both sites.
- **Status:** [x] Done — `PRIORITY_LABELS` and `PRIORITY_OPTIONS` exported from `issue-utils.ts`; local copies removed.

---

### F07 — Update-form logic copy-pasted between `ProjectUpdatesSection` and `InitiativeUpdatesSection`

- **Severity:** High
- **Category:** Reuse
- **Tier:** Structural (WS1)
- **Files:** `src/components/projects/project-updates-section.tsx`, `src/components/initiatives/initiative-updates-section.tsx`
- **Problem:** Both files embedded nearly identical `CreateUpdateForm` and `EditUpdateForm` sub-components (≈ 140 lines each). The only differences were the GraphQL mutation name and the `projectId` vs `initiativeId` parameter. Any bug or UX change had to be applied in two places.
- **Proposed change:** Create `src/components/shared/update-forms.tsx` exporting `CreateUpdateForm` and `EditUpdateForm` that accept a generic `onSubmit`/`onSave` callback. Migrate both call sites.
- **Status:** [x] Done — shared forms extracted; both sections now import from `@/components/shared/update-forms`.

---

### F08 — `CommentCard` and `CommentComposer` inlined in 660-line `comment-thread.tsx`

- **Severity:** Medium
- **Category:** Composition
- **Tier:** Structural (WS3)
- **Files:** `src/components/issues/comment-thread.tsx`
- **Problem:** `CommentCard` (363 lines, 6 `useState` calls) and `CommentComposer` (57 lines) were unexported internal components defined at the bottom of the file. They were self-contained but impossible to test in isolation or reuse.
- **Proposed change:** Move `CommentCard` → `comment-card.tsx` and `CommentComposer` → `comment-composer.tsx`.
- **Status:** [x] Done — both extracted; `comment-thread.tsx` is now the orchestrator only. F04 (a11y) and F15 (perf) were applied during this extraction.

---

### F09 — `Sidebar` (579 lines) mixes global nav, team hierarchy, favorites, and footer

- **Severity:** Medium
- **Category:** Composition
- **Tier:** Structural (WS5)
- **Files:** `src/components/layouts/sidebar.tsx`
- **Problem:** A single 579-line file handled global navigation links, per-team sub-navigation, favorites fetching and rendering, and the user/workspace footer.
- **Proposed change:** Extract `SidebarFavoritesSection` and `SidebarTeamsSection` as named sub-components within the same file.
- **Status:** [x] Done — both sections extracted as self-contained `observer` components that call `useStore()` directly; module-level helpers `favoriteHref`/`favoriteLabel` extracted from the function body.

---

### F10 — `CreateIssueModal` uses 8 independent `useState` calls for form fields

- **Severity:** Low
- **Category:** State
- **Tier:** Structural (WS6)
- **Files:** `src/components/issues/create-issue-modal.tsx`
- **Problem:** Eight separate `useState` declarations each required their own reset call in the `useEffect` initializer. Adding a new field required touching three places.
- **Proposed change:** Consolidate into `const [form, setForm] = useState<FormState>(initialForm)` with a `patchForm` helper.
- **Status:** [x] Done — `FormState` interface + `initialForm()` helper introduced; 8 state hooks reduced to 1; `applyTemplate` uses a functional `setForm` update.

---

### F11 — Issue counts recalculated on every render in `ProjectListView` and `ProjectDetailView`

- **Severity:** High
- **Category:** Perf
- **Tier:** Structural (WS4)
- **Files:** `src/components/projects/project-list-view.tsx`, `src/components/projects/project-detail-view.tsx`
- **Problem:** `issueStore.findByProjectId(project.id)` was called inside a `.map()` over projects (O(n²)). In `ProjectDetailView` it ran unconditionally on every render with no memoization.
- **Proposed change:** Wrap in `useMemo([project.id, issueStore.pool.size])` per repo convention.
- **Status:** [x] Done — `progressByProject` Map pre-computed in `ProjectGroup`; issue stats wrapped in `useMemo` before early return in `ProjectDetailView`.

---

### F12 — `statesById`/`usersById` Maps rebuilt on every render in `CsvExportButton`

- **Severity:** Low
- **Category:** Perf
- **Tier:** Structural
- **Files:** `src/components/issues/csv-export-button.tsx`
- **Problem:** Two `new Map(...)` calls appeared to run in the component body on every render.
- **Status:** [~] Won't do — false positive. On closer reading, both Maps are constructed inside `handleExport()` (the click handler), not in the component body. No render-time cost.

---

### F13 — Grouped-issues Map rebuilt on every render in `SubIssueList`

- **Severity:** Low
- **Category:** Perf
- **Tier:** Structural (WS4)
- **Files:** `src/components/issues/sub-issue-list.tsx`
- **Problem:** A `Map<string, issue[]>` grouping sub-issues by workflow state category was built in the component body with no memoization.
- **Proposed change:** Wrap in `useMemo([parentIssueId, issueStore.pool.size, workflowStateStore.pool.size])`.
- **Status:** [x] Done — `subIssues` filter and `grouped` Map wrapped in a single `useMemo`.

---

### F14 — `WorkspaceClient` `dynamic()` import wraps named export via `.then({default: ...})` unnecessarily

- **Severity:** Low
- **Category:** Convention
- **Tier:** Structural (WS7)
- **Files:** `src/components/layouts/workspace-client.tsx`, `src/components/command-palette/command-palette.tsx`
- **Problem:** The `.then(m => ({ default: m.CommandPalette }))` pattern was needed because `CommandPalette` was a named export with no default export.
- **Proposed change:** Add `export default CommandPalette` to `command-palette.tsx`, then simplify the `dynamic()` call to `import('...')` with no `.then()`.
- **Status:** [x] Done — default export added; `dynamic()` simplified to a direct import.

---

### F15 — `reactionCounts` reduce runs on every render inside `CommentCard`

- **Severity:** Low
- **Category:** Perf
- **Tier:** Structural (WS3/WS4)
- **Files:** `src/components/issues/comment-card.tsx` (was `comment-thread.tsx`)
- **Problem:** The `reduce` that builds `Record<emoji, {count, reacted}>` ran unconditionally in the component body on every render.
- **Proposed change:** Wrap in `useMemo([comment.reactions, currentUserId])`.
- **Status:** [x] Done — applied during WS3 extraction into `comment-card.tsx`.
