# Frontend Review — bilinear

_Last updated: 2026-06-06 · Status: Complete_

## Conventions (baseline)

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 6 strict (`"strict": true`, `noEmit`)
- **Styling:** Tailwind CSS v4 — no CSS modules, no styled-components. Design tokens as OKLCH CSS custom properties in `src/app/globals.css`. Utility: `cn()` from `@/lib/utils` (`clsx` + `tailwind-merge`).
- **State:** MobX 6 + mobx-react-lite. Entity pools in `src/stores/`. `observer()` wraps every reactive component. Local `useState` for ephemeral UI (open/closed, drafts). No Redux, no React Query, no SWR.
- **Data fetching:** Custom `gql()` fetch wrapper (`src/lib/graphql.ts`) calling `/api/graphql`. No Apollo Client on the client side. WebSocket (`src/lib/ws-client.ts`) + IndexedDB (Dexie) for offline-first sync.
- **Structure:** Feature-grouped under `src/components/<feature>/`. Shared primitives in `src/components/ui/` (currently only `button.tsx`, `select.tsx`, `skeleton.tsx`). Property pickers in `src/components/properties/`. Hooks in `src/hooks/`. Shared utilities in `src/lib/`.
- **UI kit:** shadcn-style CVA button; everything else is hand-rolled Tailwind.
- **Client boundary:** `'use client'` on ~91 files; no server actions (`'use server'` appears 0 times).
- **Commands:** `typecheck=yarn typecheck` · `lint=yarn lint` · `lint:fix=yarn lint:fix` · `test=yarn test` · `build=yarn build`
- **Lint/format:** Biome 2 — single quotes, 100-char lines, trailing commas, sorted imports+keys, recommended rules (includes `useButtonType`).

---

## Summary

| ID  | Title                                         | Severity | Category     | Tier        | Status     |
|-----|-----------------------------------------------|----------|--------------|-------------|------------|
| F01 | `formatRelativeDate` duplicates `formatRelativeTime` | High | Reuse     | Safe        | [x] Done   |
| F02 | 12 components inline outside-click listener   | Medium   | Hooks/Reuse  | Structural  | [x] Done (WS-A) |
| F03 | No shared popover/dropdown primitive          | High     | Reuse/Composition | Structural | [x] Done (WS-E) |
| F04 | `ProjectUpdatesSection` and `InitiativeUpdatesSection` near-duplicate | High | Reuse | Structural | [x] Done (WS-D) |
| F05 | `UserAvatar` mis-located; inline re-implementations elsewhere | Medium | Structure | Structural | [x] Done (WS-B) |
| F06 | No shared `Badge` component despite 4+ badge patterns | Medium | Reuse | Structural | [x] Done (WS-C) |
| F07 | `GroupSection` falls back to index key when `getKey` omitted | Low | Perf/Keys | Structural | [x] Done (WS-F) |

---

## Findings

### F01 — `formatRelativeDate` is a private duplicate of the public `formatRelativeTime`

- **Severity:** High
- **Category:** Reuse
- **Tier:** Safe
- **Files:**
  - `src/components/projects/project-updates-section.tsx:399–423`
  - `src/components/initiatives/initiative-updates-section.tsx:463–487`
  - `src/lib/utils.ts:19` (the canonical implementation)
- **Problem:** Both files define a private `formatRelativeDate` whose logic is byte-for-byte identical to the exported `formatRelativeTime` in `src/lib/utils.ts`. They are not imported from utils; the local copies were written independently. Any future divergence would silently produce inconsistent timestamps across the app.
- **Proposed change:** Delete both local functions. Import `formatRelativeTime` from `@/lib/utils` in their place. Rename all local call sites from `formatRelativeDate(...)` to `formatRelativeTime(...)`.
- **Status:** [x] Done
- **Commit:** _(see below)_

---

### F02 — 12 components manually inline the outside-click `useEffect` instead of using the existing `useOutsideClick` hook

- **Severity:** Medium
- **Category:** Hooks / Reuse
- **Tier:** Structural
- **Files:**
  - `src/components/properties/assignee-select.tsx:77–86`
  - `src/components/properties/status-select.tsx:49–58`
  - `src/components/properties/priority-select.tsx:34–43`
  - `src/components/properties/label-select.tsx:47–57`
  - `src/components/properties/due-date-picker.tsx` (analogous)
  - `src/components/properties/project-select.tsx` (analogous)
  - `src/components/properties/cycle-select.tsx` (analogous)
  - `src/components/ui/select.tsx:40–48`
  - `src/components/issues/relations-section.tsx:276–284`
  - `src/components/issues/template-selector.tsx:82–89`
  - `src/components/issues/comment-thread.tsx:356–367` (CommentCard — two popovers in one effect)
  - `src/components/notifications/notification-inbox.tsx:160–169`
- **Reference (correct pattern):** `src/components/properties/estimate-picker.tsx:98–105` already uses `useOutsideClick` correctly.
- **Out of scope:** `src/components/issues/column-picker.tsx` and `src/components/issues/issue-context-menu.tsx` both mix `mousedown` with a `keydown` listener in the same effect — those need bespoke handling.
- **Problem:** The hook `src/hooks/use-outside-click.ts` exists and is fully correct, but 12 components ignore it. The repeated 6-line `useEffect` adds noise and the two patterns have a subtle difference: the inline version always attaches the listener (even when the dropdown is closed), while the `estimate-picker` reference passes `open` as the `enabled` flag so the listener is only live when needed.
- **Proposed change:** In each of the 12 files, replace the `useEffect` block with:
  ```ts
  useOutsideClick(ref, () => { setOpen(false); onClose?.(); }, open);
  ```
  Remove the now-unused `useEffect` import if it was only used for that block. For `comment-thread.tsx` the two-popover variant requires two separate `useOutsideClick` calls with their respective refs and state setters.
- **Status:** [x] Done — WS-A. Replaced the inline `mousedown` effect in all 12 files with `useOutsideClick(ref, handler, open)`. `comment-thread.tsx` split into two separate calls for its two popovers.

---

### F03 — No shared popover/dropdown primitive; all property selects re-implement the same structure

- **Severity:** High
- **Category:** Reuse / Composition
- **Tier:** Structural
- **Files (all instances):**
  - `src/components/properties/assignee-select.tsx`
  - `src/components/properties/status-select.tsx`
  - `src/components/properties/priority-select.tsx`
  - `src/components/properties/label-select.tsx`
  - `src/components/properties/due-date-picker.tsx`
  - `src/components/properties/project-select.tsx`
  - `src/components/properties/cycle-select.tsx`
  - `src/components/properties/estimate-picker.tsx`
  - `src/components/ui/select.tsx`
  - `src/components/issues/template-selector.tsx`
  - `src/components/issues/relations-section.tsx`
- **Problem:** Every property select contains the same boilerplate: `useState(false)` for open, `useRef<HTMLDivElement>` for the container, `useEffect` (or `useOutsideClick`) for outside-click, `useEffect` for `forceOpen`, a trigger `<button>`, and a dropdown `<div>` with identical positioning/shadow classes (`absolute … top-full z-50 mt-1 … rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900`). The trigger and content vary, but the shell is repeated 11 times.
- **Proposed change:** Add a `src/components/ui/popover.tsx` primitive (or rename the existing `select.tsx` to `popover.tsx`) exposing:
  ```tsx
  <Popover trigger={<...>} open={open} onOpenChange={setOpen} forceOpen={forceOpen} onClose={onClose}>
    {/* dropdown content */}
  </Popover>
  ```
  Internally this handles the ref, outside-click, and forceOpen effect. Each property select becomes trigger + content only. Prop API must be designed from all 11 usages before implementation.
- **Status:** [x] Done — WS-E. Created `src/hooks/use-popover.ts` encapsulating `open` state, `ref`, `forceOpen` effect, and `useOutsideClick`. Migrated `AssigneeSelect`, `StatusSelect`, `PrioritySelect`, `LabelSelect`, `DueDatePicker`, and `TemplateSelector` to `usePopover({ forceOpen, onClose })`.

---

### F04 — `ProjectUpdatesSection` and `InitiativeUpdatesSection` are near-duplicates

- **Severity:** High
- **Category:** Reuse
- **Tier:** Structural
- **Files:**
  - `src/components/projects/project-updates-section.tsx` (423 lines)
  - `src/components/initiatives/initiative-updates-section.tsx` (487 lines)
- **Problem:** The two files share:
  - An identical `UpdateFormFields` component (health picker buttons + textarea), differing only in whether a "None" health option is included.
  - Near-identical `CreateUpdateForm`, `EditUpdateForm` layouts — same markup, different GQL mutation strings and an extra `onCreated`/`onSaved` callback in the initiative variant.
  - An identical `DeleteUpdateButton` confirm flow (the only difference is the GQL mutation called and whether a callback fires post-delete).
  - Identical `formatRelativeDate` helpers (already fixed in F01).
  - Identical section header structure ("Updates (n)" + "Add update" button).
  - Identical empty state ("No updates yet. …").
  - Near-identical update card layout — the project variant adds a `UserAvatar` and the `avatarBgColor` field; the initiative variant omits it.
- **Proposed change:** Extract into `src/components/shared/updates-section.tsx` a set of shared sub-components (`UpdateFormFields`, `DeleteUpdateButton`, section header/empty state), parameterized on the entity-specific GQL strings and whether the avatar is shown. `ProjectUpdatesSection` and `InitiativeUpdatesSection` become thin wrappers.
- **Note:** The prop API for the shared components must be designed to accommodate both variants before migrating the call sites.
- **Status:** [x] Done — WS-D. Extracted `UpdateFormFields` (with `showNone` prop for the project variant's "None" health button) and `DeleteUpdateButton` (accepts a `mutation` string) into `src/components/shared/`. Both update sections are now thin wrappers.

---

### F05 — `UserAvatar` is co-located in `assignee-select.tsx` but used (and re-implemented) across several files

- **Severity:** Medium
- **Category:** Structure / Reuse
- **Tier:** Structural
- **Files:**
  - `src/components/properties/assignee-select.tsx:23–57` — canonical definition, exported
  - `src/components/issues/comment-thread.tsx:10` — imports it from assignee-select
  - `src/components/issues/board-view.tsx:121–129` — inline reimplementation (no `img` fallback, no `initials` prop used properly)
  - `src/components/projects/project-updates-section.tsx:88–99` — another inline reimplementation (no `img` fallback, different size)
- **Problem:** `UserAvatar` is a general-purpose presentational component that currently lives inside a feature-specific file (`assignee-select.tsx`). Two other files re-implement the same avatar circle rather than importing it; the `board-view` version omits image fallback support entirely.
- **Proposed change:** Move `UserAvatar` to `src/components/ui/user-avatar.tsx`. Update the import in `comment-thread.tsx`. Migrate the inline avatars in `board-view.tsx` and `project-updates-section.tsx` to use it (adding a compatible `user` prop shape as needed).
- **Status:** [x] Done — WS-B. Created `src/components/ui/user-avatar.tsx`. Updated imports in `comment-thread.tsx` and `assignee-select.tsx` (backward-compat re-export kept). Replaced inline avatar implementations in `board-view.tsx` and `project-updates-section.tsx`.

---

### F06 — No shared `Badge` component despite 4+ distinct badge patterns

- **Severity:** Medium
- **Category:** Reuse
- **Tier:** Structural
- **Files (badge instances):**
  - `src/components/properties/estimate-picker.tsx:51–76` — `EstimateBadge`, indigo pill
  - `src/components/issues/pull-requests-section.tsx` — `PrStateBadge`, several color variants
  - `src/components/issues/comment-thread.tsx:456–460` — "Resolved" green pill (inline)
  - `src/components/projects/project-updates-section.tsx:103–111` — health badge, colored bg (inline)
  - `src/components/initiatives/initiative-updates-section.tsx:164–170` — same health badge (inline)
- **Problem:** There are at least 4–5 distinct badge patterns across the codebase with no shared `<Badge>` component. Each inline badge repeats the same `rounded px-1.5 py-0.5 text-xs font-medium` base and applies a color variant inline or via a switch/config lookup.
- **Proposed change:** Add `src/components/ui/badge.tsx` with a `variant` prop (e.g. `'indigo' | 'green' | 'red' | 'health'`) or a generic `className`/`color` override approach, mirroring the existing `<Button>` CVA pattern. Migrate the 5 call sites.
- **Status:** [x] Done — WS-C. Created `src/components/ui/badge.tsx` with CVA `variant: 'pill' | 'solid'`. Migrated `EstimateBadge`, `PrStateBadge`, "Resolved" pill in `comment-thread.tsx`, health badges in both update sections, and "Active" badge in `cycle-select.tsx`. Color classes are passed via `className` at each call site.

---

### F07 — `GroupSection` falls back to array index as key when `getKey` is omitted on the non-virtual path

- **Severity:** Low
- **Category:** Perf / Keys
- **Tier:** Structural
- **Files:** `src/components/issues/group-section.tsx:127`
- **Problem:**
  ```tsx
  items.map((item, i) => (
    <div key={getKey ? getKey(item, i) : i}>{renderItem(item, i)}</div>
  ))
  ```
  When `getKey` is not passed (it is optional), items are keyed by position. If a status change moves an issue to a different position within its group, React will reuse the DOM node at that index, potentially preserving stale popover-open state or focus in the issue row component.
- **Context:** Current callers appear to use the `children` path rather than `items` + `renderItem`, so this is not actively causing bugs. It is a latent risk for future callers.
- **Proposed change:** Make `getKey` required whenever `items` is provided (use a discriminated union on `GroupSectionProps`), or default to `item.id` via a type constraint. This changes the public prop contract.
- **Status:** [x] Done — WS-F. Replaced the single `GroupSectionProps` interface with a discriminated union (`GroupSectionChildrenProps | GroupSectionItemsProps`). `getKey` is now required when `items` is provided; the index fallback is removed. The existing caller already passed `getKey`.
