# Frontend Review — Bilinear

_Last updated: 2026-06-07 · Status: Auto-fixing Tier 1_

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
| F05 | `QUICK_EMOJIS` constant duplicated in two files | Low | Reuse | Structural | [ ] |
| F06 | `PRIORITY_LABELS`/`PRIORITY_OPTIONS` duplicated across `board-view` and `filter-builder` | Medium | Reuse | Structural | [ ] |
| F07 | Update forms copy-pasted between `project-updates-section` and `initiative-updates-section` | High | Reuse | Structural | [ ] |
| F08 | `CommentCard` and `CommentComposer` inlined in 660-line `comment-thread.tsx` | Medium | Composition | Structural | [ ] |
| F09 | Sidebar (579 lines) mixes global nav, teams, favorites, and footer into one component | Medium | Composition | Structural | [ ] |
| F10 | `CreateIssueModal` has 8 independent `useState` calls that could be one form-state object | Low | State | Structural | [ ] |
| F11 | Derived issue counts recalculated inline on every render in `ProjectListView` and `ProjectDetailView` | High | Perf | Structural | [ ] |
| F12 | `statesById`/`usersById` Maps rebuilt on every render in `CsvExportButton` | Low | Perf | Structural | [ ] |
| F13 | Grouped-issues Map rebuilt on every render in `SubIssueList` | Low | Perf | Structural | [ ] |
| F14 | `WorkspaceClient` `dynamic()` import wraps named export unnecessarily | Low | Convention | Structural | [ ] |
| F15 | `reactionCounts` reduce runs on every render inside `CommentCard` | Low | Perf | Structural | [ ] |

---

## Findings

### F01 — `cn()` not used in `PrStateIcon` — string `"undefined"` injected into className

- **Severity:** Medium
- **Category:** Types / Convention
- **Tier:** Safe
- **Files:** `src/components/issues/pull-requests-section.tsx:89,92,96`
- **Problem:** `PrStateIcon` builds Tailwind classNames via template literals: `` `h-4 w-4 text-purple-500 ${className}` ``. When `className` is `undefined` (the prop's default), the string `"undefined"` is literally appended to the DOM class attribute. This conflicts with Tailwind's deduplication and is a pattern mismatch — the entire repo uses `cn()` for class merging.
- **Proposed change:** Replace all three template literals with `cn('h-4 w-4 text-...', className)`.
- **Status:** [x] Done
- **Commit:** _(see batch 1)_

---

### F02 — `useParams` generic typed as `{ workspace?: string }` — makes key optionally undefined inside guaranteed route

- **Severity:** Low
- **Category:** Types
- **Tier:** Safe
- **Files:** `src/components/layouts/workspace-client.tsx:39`
- **Problem:** `WorkspaceClient` lives inside the `(workspace)/[workspace]/` segment, so `params.workspace` is always a non-empty string at runtime. Typing it as `string | undefined` creates dead-code branches and suppresses useful TypeScript narrowing downstream.
- **Proposed change:** Change generic to `{ workspace: string }`.
- **Status:** [x] Done
- **Commit:** _(see batch 1)_

---

### F03 — Collapse button in `GroupSection` missing `aria-expanded`

- **Severity:** Medium
- **Category:** A11y
- **Tier:** Safe
- **Files:** `src/components/issues/group-section.tsx:105`
- **Problem:** The group header `<button>` toggles `collapsed` state but conveys no state to assistive technology. Screen readers announce it as a plain button with no indication of whether the group is expanded or collapsed.
- **Proposed change:** Add `aria-expanded={!collapsed}` to the button element.
- **Status:** [x] Done
- **Commit:** _(see batch 1)_

---

### F04 — Comment action buttons invisible to keyboard users (`opacity-0` on hover only)

- **Severity:** High
- **Category:** A11y
- **Tier:** Safe
- **Files:** `src/components/issues/comment-thread.tsx:382`
- **Problem:** The actions container (`flex items-center gap-1 opacity-0 group-hover:opacity-100`) is fully transparent until the mouse hovers over the comment card. Keyboard users who Tab into the contained buttons cannot see them and have no indication they exist. The "Resolve", "React", and "More" controls are effectively unreachable without a mouse.
- **Proposed change:** Add `group-focus-within:opacity-100` to the container className so keyboard focus on any child button reveals the bar.
- **Status:** [x] Done
- **Commit:** _(see batch 1)_

---

### F05 — `QUICK_EMOJIS` array defined identically in two files

- **Severity:** Low
- **Category:** Reuse
- **Tier:** Structural
- **Files:** `src/components/issues/comment-thread.tsx:64`, `src/components/issues/issue-reaction-bar.tsx:26`
- **Problem:** `const QUICK_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '🚀', '👀', '😕']` is copy-pasted verbatim. Any future change to the emoji set requires updating both files.
- **Proposed change:** Move the constant to `src/lib/reactions.ts` (new small file) and import from both sites. Alternative: export from whichever component is considered the owner and import in the other.
- **Status:** [ ] Open

---

### F06 — `PRIORITY_LABELS` / `PRIORITY_OPTIONS` duplicated across `board-view` and `filter-builder`

- **Severity:** Medium
- **Category:** Reuse
- **Tier:** Structural
- **Files:** `src/components/issues/board-view.tsx:52–58`, `src/components/issues/filter-builder.tsx:39–45`
- **Problem:** Both files independently define a mapping of priority integer → label + icon/color. The data is identical. Divergence will cause inconsistent labels.
- **Proposed change:** Extract to `src/lib/issue-constants.ts` (or extend the existing `src/lib/issue-utils.ts`) and import from both sites.
- **Status:** [ ] Open

---

### F07 — Update-form logic copy-pasted between `ProjectUpdatesSection` and `InitiativeUpdatesSection`

- **Severity:** High
- **Category:** Reuse
- **Tier:** Structural
- **Files:** `src/components/projects/project-updates-section.tsx:144–280`, `src/components/initiatives/initiative-updates-section.tsx:168–319`
- **Problem:** Both files embed nearly identical `CreateUpdateForm` and `EditUpdateForm` sub-components (≈ 140 lines each). The only differences are the GraphQL mutation name and the `projectId` vs `initiativeId` parameter. Any bug or UX change must be applied in two places. `src/components/shared/` already exists for exactly this purpose; `UpdateFormFields` (shared form inputs) is already there, but the form wrapper components themselves are duplicated.
- **Proposed change:** Create `src/components/shared/update-forms.tsx` exporting `CreateUpdateForm` and `EditUpdateForm` that accept a generic `onSubmit` callback. Migrate both call sites.
- **Status:** [ ] Open

---

### F08 — `CommentCard` and `CommentComposer` inlined in 660-line `comment-thread.tsx`

- **Severity:** Medium
- **Category:** Composition
- **Tier:** Structural
- **Files:** `src/components/issues/comment-thread.tsx:239–601`, `src/components/issues/comment-thread.tsx:604–660`
- **Problem:** `CommentCard` (363 lines, 6 `useState` calls) and `CommentComposer` (57 lines) are unexported internal components defined at the bottom of the file. They are self-contained enough to live in separate files but being co-located makes the file hard to navigate and the components impossible to test in isolation or reuse.
- **Proposed change:** Move `CommentCard` → `src/components/issues/comment-card.tsx` and `CommentComposer` → `src/components/issues/comment-composer.tsx`. No behavior or prop API changes — pure file split.
- **Status:** [ ] Open

---

### F09 — `Sidebar` (579 lines) mixes global nav, team hierarchy, favorites, and footer

- **Severity:** Medium
- **Category:** Composition
- **Tier:** Structural
- **Files:** `src/components/layouts/sidebar.tsx`
- **Problem:** A single 579-line file handles global navigation links, per-team sub-navigation, favorites fetching and rendering, and the user/workspace footer. Sections have independent state and logic but no boundary between them. Adding or changing any section requires reading the whole file.
- **Proposed change:** Split into `SidebarTeamsSection`, `SidebarFavoritesSection`, and `SidebarFooter` sub-components (either as files in `src/components/layouts/` or as unexported sub-components extracted to named functions at the top of the same file). No API changes to `Sidebar`'s props.
- **Status:** [ ] Open

---

### F10 — `CreateIssueModal` uses 8 independent `useState` calls for form fields

- **Severity:** Low
- **Category:** State
- **Tier:** Structural
- **Files:** `src/components/issues/create-issue-modal.tsx:45–62`
- **Problem:** Eight separate `useState` declarations (`title`, `description`, `stateId`, `assigneeId`, `priority`, `labelIds`, `dueDate`, `projectId`) each require their own reset call in the `useEffect` initializer (lines 99–107). Adding a new field requires touching three places. A single `formState` object would make initialization, reset, and validation clearer.
- **Proposed change:** Consolidate into `const [form, setForm] = useState<FormState>(initialForm)` with a `patchForm` helper. Requires changing the prop API of no other component.
- **Status:** [ ] Open

---

### F11 — Issue counts recalculated on every render in `ProjectListView` and `ProjectDetailView`

- **Severity:** High
- **Category:** Perf
- **Tier:** Structural
- **Files:** `src/components/projects/project-list-view.tsx:128–132`, `src/components/projects/project-detail-view.tsx:36–44`
- **Problem:** `issueStore.findByProjectId(project.id)` is called inside a `.map()` over projects (O(n²) when the pool is large). In `ProjectDetailView` it's called unconditionally on every render with no memoization. Both sites also call `.filter(i => i.completedAt)` inline, creating a new array per render.
- **Proposed change:** Wrap per-project derivations in `useMemo([project.id, issueStore.pool.size])` (using `pool.size` as the MobX-reactive dependency per repo convention). Alternatively, expose a `getProjectStats(id)` computed on the store.
- **Status:** [ ] Open

---

### F12 — `statesById`/`usersById` Maps rebuilt on every render in `CsvExportButton`

- **Severity:** Low
- **Category:** Perf
- **Tier:** Structural
- **Files:** `src/components/issues/csv-export-button.tsx:61–62`
- **Problem:** Two `new Map(...)` calls run unconditionally in the component body. For typical team sizes (50–200 users, similar count of states) the cost is small but it fires on every render of the button, not just on export.
- **Proposed change:** Wrap in `useMemo([states, users])`.
- **Status:** [ ] Open

---

### F13 — Grouped-issues Map rebuilt on every render in `SubIssueList`

- **Severity:** Low
- **Category:** Perf
- **Tier:** Structural
- **Files:** `src/components/issues/sub-issue-list.tsx:50–58`
- **Problem:** A `Map<string, issue[]>` grouping sub-issues by workflow state category is built in the component body with no memoization. The computation runs on every render even when `subIssues` hasn't changed.
- **Proposed change:** Wrap in `useMemo([subIssues])`.
- **Status:** [ ] Open

---

### F14 — `WorkspaceClient` `dynamic()` import wraps named export via `.then({default: ...})` unnecessarily

- **Severity:** Low
- **Category:** Convention
- **Tier:** Structural
- **Files:** `src/components/layouts/workspace-client.tsx:19–25`
- **Problem:** The current pattern `import(...).then(m => ({ default: m.CommandPalette }))` works but is more verbose than necessary. Next.js `dynamic()` already accepts a promise resolving to a module with a named export via `.then(m => m.CommandPalette)`.
- **Proposed change:** Simplify to `dynamic(() => import('...').then(m => m.CommandPalette), { ssr: false })`.
- **Status:** [ ] Open

---

### F15 — `reactionCounts` reduce runs on every render inside `CommentCard`

- **Severity:** Low
- **Category:** Perf
- **Tier:** Structural
- **Files:** `src/components/issues/comment-thread.tsx:341–352`
- **Problem:** The `reduce` that builds `Record<emoji, {count, reacted}>` runs unconditionally in the component body. For typical comment reaction counts the cost is negligible, but it's an easily avoided allocation.
- **Proposed change:** Wrap in `useMemo([comment.reactions, currentUserId])`.
- **Status:** [ ] Open
