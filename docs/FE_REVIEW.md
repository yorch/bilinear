# Frontend Review — bilinear

_Last updated: 2026-06-06 · Status: Auto-fixing Tier 1_

---

## Conventions (baseline)

- **Framework:** Next.js 16.2.6 (App Router), React 19.2.6, TypeScript 6.0.3 strict
- **Styling:** Tailwind CSS v4 (PostCSS plugin). No CSS Modules or styled-components. Design tokens via CSS custom properties + `next-themes` class-based dark mode. No hardcoded hex — semantic tokens only. shadcn/ui primitives in `src/components/ui/`.
- **State:** MobX 6 (`makeObservable`, `observer()`). 16 domain stores under `src/stores/`, assembled in `RootStore`. Local `useState` only for ephemeral UI (modals, form drafts). No React Context for data — one `StoreContext` holds the singleton root store. No React Query / SWR — bootstrap + delta-sync + WebSocket via custom `SyncManager`.
- **Structure:** `src/components/<domain>/` for feature components, `src/components/ui/` for primitives (button, badge, select, skeleton, user-avatar), `src/components/shared/` for cross-feature building blocks (currently very small). `src/hooks/` for custom hooks (7 total).
- **Data fetching:** `gql()` thin fetch wrapper to `/api/graphql`. `TransactionQueue` for optimistic mutations with IndexedDB persistence. Bootstrap → delta-sync → WebSocket for live updates. No generated types (manual interfaces).
- **Server/client boundary:** `'use client'` on all interactive components, all hooks, all providers. API routes in `src/app/api/`. Server components used at page level only for initial HTML; all data comes from MobX stores hydrated client-side.
- **Commands:** typecheck=`yarn typecheck` · lint=`yarn lint` · test=`yarn test` · build=`yarn build`
- **Linter/formatter:** Biome 2.4.13 — single quotes, arrow parens as-needed, 100-char line width, sorted imports & object keys. ESLint not used.

---

## Summary

| ID  | Title | Severity | Category | Tier | Status |
|-----|-------|----------|----------|------|--------|
| F01 | Dead `UserAvatar` re-export in `assignee-select` | Low | Reuse | Safe | [x] Done |
| F02 | Property selector popover shell duplicated across 8 files | Medium | Reuse | Structural | [ ] Open |
| F03 | `<dialog>` wrapper duplicated across 3 create-modals | Medium | Reuse | Structural | [ ] Open |
| F04 | `CommandPalette` observer subscribes to 6 stores | Low | Perf | Structural | [ ] Open |
| F05 | GraphQL query strings inline in component files | Low | Convention | Structural | [ ] Open |

---

## Findings

### F01 — Dead `UserAvatar` re-export in `assignee-select`

- **Severity:** Low
- **Category:** Reuse / Dead code
- **Tier:** Safe
- **Files:** `src/components/properties/assignee-select.tsx:92`
- **Problem:** Line 92 re-exports `UserAvatar` from `../ui/user-avatar`. No file imports `UserAvatar` from `assignee-select` — all three consumers of this file (`create-issue-modal.tsx`, `issue-detail-panel.tsx`, `issue-row.tsx`) only destructure `AssigneeSelect`. The barrel re-export creates an invisible, untested public API surface on a file that isn't a barrel module.
- **Proposed change:** Remove line 92.
- **Status:** [x] Done
- **Commit:** _(see below)_

---

### F02 — Property selector popover shell duplicated across 8 files

- **Severity:** Medium
- **Category:** Reuse / Composition
- **Tier:** Structural
- **Files:**
  - `src/components/properties/status-select.tsx`
  - `src/components/properties/priority-select.tsx`
  - `src/components/properties/assignee-select.tsx`
  - `src/components/properties/label-select.tsx`
  - `src/components/properties/due-date-picker.tsx`
  - `src/components/properties/cycle-select.tsx` (slight variation — uses `useOutsideClick` + `internalOpen` directly instead of `usePopover`)
  - `src/components/properties/project-select.tsx` (same variation)
  - `src/components/properties/estimate-picker.tsx` (uses `useOutsideClick` directly)
- **Problem:** All 8 files hand-roll the same outer shell:
  1. A `relative` container div (or `relative inline-block`) with a forwarded ref.
  2. A trigger `<button>` with `e.stopPropagation()`, `type="button"`, and hover styles.
  3. A conditionally-rendered `absolute left-0 top-full z-50 mt-1 … rounded-md border border-zinc-200 bg-white … shadow-lg dark:border-zinc-700 dark:bg-zinc-900` popover div.

  The CSS string for the popover panel is copy-pasted verbatim in status-select, priority-select, assignee-select, and label-select (exact match). Cycle-select, project-select use a slightly wider `w-56` variant with a search input inside but the same positioning/shadow pattern. Estimate-picker is another variant.

  Each file also duplicates the click-to-close + `onClose?.()` dance.

- **Proposed change:** Extract a `SelectPopover` primitive in `src/components/ui/` that owns:
  - The `relative` container + `ref` forwarding
  - The trigger slot (render prop or `children` for the button)
  - The popover panel slot with consistent positioning/shadow CSS
  - `usePopover` integration (or the `internalOpen` pattern for the search-input variants)

  Prop API must accommodate the two real variants: plain list (status/priority/assignee/label) and search-input list (cycle/project). The call-site migration is the risk surface — each must be verified to render identically.

- **Status:** [ ] Open — awaiting approval

---

### F03 — `<dialog>` wrapper duplicated across 3 create-modals

- **Severity:** Medium
- **Category:** Reuse / Composition
- **Tier:** Structural
- **Files:**
  - `src/components/issues/create-issue-modal.tsx:186-199`
  - `src/components/projects/create-project-modal.tsx:110-124`
  - `src/components/teams/create-team-modal.tsx:121-135`
- **Problem:** All three modals repeat an identical `<dialog>` outer shell:
  - CSS: `"fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black/40 p-0 m-0 border-none max-w-none max-h-none"` — verbatim identical in all three.
  - Backdrop-click close: `onClick={e => { if (e.target === e.currentTarget) { onClose(); } }}` — identical.
  - Escape keydown: `onKeyDown={e => { if (e.key === 'Escape') { onClose(); } }}` — identical.
  - Early-return guard: `if (!open) return null` — identical.
  - Inner card: `w-full max-w-md/lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900` — nearly identical (only max-width differs: `max-w-lg` for issues, `max-w-md` for projects and teams).

  Any future change to modal behaviour (focus trap, animation, scroll lock) must be applied to three files.

- **Proposed change:** Extract a `ModalDialog` wrapper in `src/components/ui/` that accepts `open`, `onClose`, `maxWidth?`, and `children`. Internally it renders the `<dialog>` shell and handles backdrop-click and Escape. Migration straightforward — each modal's interior `<div>` becomes the `children`.
- **Status:** [ ] Open — awaiting approval

---

### F04 — `CommandPalette` observer subscribes to 6 MobX stores

- **Severity:** Low
- **Category:** Perf / State
- **Tier:** Structural
- **Files:** `src/components/command-palette/command-palette.tsx:62`
- **Problem:** The top-level `observer()` component destructures `uiStore`, `issueStore`, `workflowStateStore`, `userStore`, `labelStore`, and `teamStore` in one render function. MobX `observer` tracks all accessed observables; any change to any of those six stores will re-render the whole palette, including sections that don't depend on the changed store. The palette is mounted persistently in the app shell, so this fires frequently.
- **Proposed change:** Split into child `observer` components, one per logical section (e.g. `IssueActions`, `TeamActions`), each subscribing to only the stores it reads. The outer palette becomes a thin coordinator that renders each child.
- **Status:** [ ] Open — awaiting approval

---

### F05 — GraphQL query strings defined inline in component files

- **Severity:** Low
- **Category:** Convention / Reuse
- **Tier:** Structural
- **Files:**
  - `src/components/issues/activity-timeline.tsx:31`
  - `src/components/issues/comment-thread.tsx:53`
  - `src/components/issues/issue-detail-panel.tsx:34`
  - `src/components/issues/create-issue-modal.tsx:16`
  - (and others)
- **Problem:** Query and mutation strings are defined as module-level `const` template literals inside their consuming component file. There is no GraphQL code generation, so each query is effectively a magic string. This makes it difficult to audit what queries exist, find duplicate/overlapping queries, or adopt codegen later.
- **Proposed change:** Centralize all GraphQL strings in `src/lib/graphql-queries.ts` (or a `src/lib/graphql/` folder by domain). No runtime change — same strings, same execution path — purely organizational. Value is moderate; no behavior risk.
- **Status:** [ ] Open — awaiting approval

---

## Observations (no action required)

- **O1 — `void refetchKey`** (`activity-timeline.tsx:89`): The `void refetchKey;` inside the `useEffect` body is an intentional idiom to make Biome include the prop in the tracked dependency set without triggering the `noUnusedExpressions` rule. The justifying comment is present. This is correct.
- **O2 — Index-as-key** (`skeleton.tsx`, `group-section.tsx`): All index-key usages are in static lists (loading skeletons) or inside the virtualized window where items are positionally stable. Each has a `biome-ignore` with justification. Correct.
- **O3 — `user-avatar.tsx` alt text**: The `<img>` already carries `alt={user.displayName}`. The audit agent initially flagged this; on reading the file it is fine.
- **O4 — `biome-ignore` dependency skips**: Intentional skips in `create-issue-modal.tsx`, `sidebar.tsx`, `command-palette.tsx`, and `tiptap-editor.tsx` are all justified with comments explaining the MobX reactive trigger pattern or stable-extension constraint. Correct.
- **O5 — Large component files**: `tiptap-editor.tsx` (946 lines) and `cycle-detail-view.tsx` (755 lines) are large but not god components — each has a single well-defined responsibility. The line count reflects legitimate feature complexity (collab editing, burndown SVG). Not a problem.
- **O6 — `dangerouslySetInnerHTML` in `mermaid-node.tsx`**: Input is mermaid-generated SVG (not raw user HTML). The `biome-ignore` is justified.
