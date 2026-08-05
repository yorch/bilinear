---
paths:
  - "src/components/**/*.{ts,tsx}"
  - "src/app/**/*.{ts,tsx,css}"
  - "src/hooks/**/*.{ts,tsx}"
  - "src/stores/**/*.ts"
---

# Frontend conventions

Long-form reference: `docs/PATTERNS.md` §79 (design system) and §80.6.

## Design tokens — no raw colours at all

`yarn lint:tokens` bans every shade-numbered Tailwind palette hue (`red-500`,
`zinc-700`, `blue-400`, …) and every hex literal across `src/components`,
`src/app`, `src/lib` and `src/hooks`, at a literal-zero baseline. It is a CI
gate. Use the token families:

- **surfaces** — `bg-background` / `bg-card` / `bg-muted` / `bg-accent` (hover) /
  `bg-surface-raised` / `bg-surface-sunken`
- **ink** — `text-foreground` / `-secondary` / `text-muted-foreground` /
  `text-foreground-faint`
- **brand** — `bg-brand`, `bg-brand-subtle`, `text-brand-subtle-foreground`,
  `border-brand-border`
- **status** — `danger` / `success` / `warning` / `info` / `merged`, each with
  `-subtle` and `-subtle-foreground`
- **elevation** — `shadow-e1` rows, `shadow-e2` popovers, `shadow-e3` modals

A fixed palette that genuinely can't be a token (priority swatches, cursor
colours, accent swatches) lives in `globals.css` and is referenced from `.ts` as
a `var()` string, never inlined.

**Brand roles follow the user's accent; status roles never do.** Status encodes
data — "this failed" must mean the same thing under every accent.
`src/lib/accent.test.ts` enforces both halves, `src/lib/contrast.test.ts`
asserts the fill/ink pairs.

`--border` is decorative and deliberately unasserted; `--input` is the control
boundary held at ≥3:1 for WCAG 1.4.11. Bound an input with `border-input`.

## Styling

- TailwindCSS v4 + shadcn/ui only — no CSS Modules, no styled-components. Dark
  mode via `next-themes` (class-based); accent colour via the `accent` cookie +
  `data-accent` on `<html>` (see `src/lib/accent.ts`).
- Use `cn()` from `@/lib/utils` (clsx + tailwind-merge) for all class merging —
  never template-literal concatenation.
- Typography: `--font-sans` is Instrument Sans, `--font-mono` is Geist Mono, both
  vendored under `src/app/fonts` and loaded with `next/font/local` (never
  `next/font/google` — the build must not depend on a font CDN). Identifiers,
  counts, estimates and timestamps go in `font-mono tabular-nums`.
- `/design` renders the whole token layer and every primitive across all three
  accents and both themes. Open it when changing anything in `ui/` or
  `globals.css`; this repo's CI has no visual regression suite.

## Primitives — extend these, don't hand-roll

In `src/components/ui/`:

- `Button` (CVA)
- `Badge` (CVA) — shape via `variant`: `pill` / `square`; colour via `tone`:
  `brand` / `danger` / `info` / `muted` / `none` / `outline` / `success` /
  `warning`. **There is deliberately no `solid` variant** — it hardcoded
  `text-white` over caller-supplied status fills and failed contrast (~1.4:1 on
  `--warning` in dark). Solid status chips are `tone` pills.
- `UserAvatar`, `Input`, `Textarea`, `Switch`, `EmptyState`
- `ProgressBar` — track sizing comes from `className` (`h-2`, `h-1.5 w-16`); the
  fill is `bg-brand` unless `fillClassName` overrides it (`bg-success` for the
  sub-issue completion bar).
- `ColorDot` — `sm` (8px, labels) / `md` (10px, workflow states). Backs
  `LabelDot` / `StatusDot`. The colour is entity data from the DB, so it stays an
  inline `backgroundColor`, not a token.
- `SegmentedControl` — the small bordered toggle used by the analytics sections.
- `SimpleSelect` (from `ui/select`)
- `Skeleton` + `LoadingRegion` / `RowsSkeleton` / `PageSkeleton` /
  `IssueListSkeleton` / `IssueSkeleton` / `DetailPanelSkeleton` /
  `SidebarSkeleton` (from `ui/skeleton`)
- `SelectPopover`, `SearchableSelectPopover` (generic searchable dropdown — see
  `CycleSelect` / `ProjectSelect` for usage)
- `ModalDialog` + `ModalHeader` / `ModalFooter` (native `showModal()` — real
  focus trap; Escape arrives as the `cancel` event)
- `PageHeader` / `Toolbar` — the single page-chrome header and its control strip.
  Never hand-roll a page header.

In `src/components/shared/`: `ConfirmDialog` (destructive confirmations — always
prefer over `window.confirm`), `InlineRetry` (a failed fetch must offer a retry,
never render as an authoritative empty state), `SettingToggleRow`,
`SyncErrorState`, `UpdateFormFields`, `CreateUpdateForm` / `EditUpdateForm`,
`DeleteUpdateButton`, `SectionHeader` + `SectionAddButton` (the uppercase
subsection header and its "+ Add X" control — pass `as` to keep the heading
level right; `SectionAddButton` is usable standalone where the surrounding row
isn't a `SectionHeader`). Add cross-feature building blocks here.

Feature-local shared pieces stay in their feature directory: `ReactionEmojiOptions`
(`issues/reaction-emoji-options.tsx`) is the QUICK_EMOJIS grid rendered inside a
reaction `SelectPopover`, shared by the issue reaction bar and comment cards.

Loading states shimmer **and** announce: a `Skeleton` is `aria-hidden`, so wrap
it in `LoadingRegion` (`role="status"` + `aria-busy` + sr-only text). Never
hand-roll an `animate-pulse` block. A pulsing *dot* is the exception — there a
pulse means "live" (connection status, pending write), not "loading".

## File layout

- Component files live in `src/components/<feature>/` — feature-grouped,
  kebab-case filenames. Interactive components are `'use client'`; pages and
  layouts are server components.
- Large client-only widgets use `dynamic(..., { ssr: false })` with a `.lazy.tsx`
  suffix (e.g. `tiptap-editor.lazy.tsx`, `issue-detail-panel.lazy.tsx`).

## MobX

- Wrap components with `observer()` from `mobx-react-lite`.
- Use the `useStore()` hook (from StoreProvider context) to access RootStore —
  never import `getRootStore()` directly. No Redux/Zustand/React Query/SWR; use
  `useState` for ephemeral local UI state only.
- Use `store.pool.size` as a `useMemo` dependency, not the Map itself.
- `TransactionQueue` instances share a singleton in-memory FIFO backed by an
  IndexedDB `pendingTransactions` table. `new TransactionQueue()` per component
  mount with `useMemo(() => new TransactionQueue(), [])` is still the convention
  — every instance enqueues into the shared queue. Pending transactions survive a
  page reload, scoped to the session that enqueued them (`orgId`/`userId` from
  the JWT). `SyncProvider` calls `TransactionQueue.setActiveSession(...)` then
  `TransactionQueue.hydrate(session)` once at app boot; rows from other sessions
  are deleted, not replayed.

## Hooks and interaction contracts

- Fetch-on-mount goes through `useRetryableFetch` — it owns the `reloadKey` /
  cancelled-flag state machine and pairs with `InlineRetry`. Pass
  `{ silent: true }` for post-mutation background refreshes so they don't
  re-flash the skeleton. See PATTERNS.md §80.6.
- Issue mutations from components: use `useIssueCreate(team, states)` and
  `useIssueUpdate()` — they own the optimistic apply, TransactionQueue enqueue,
  rollback and failure toast. Map store models with `toIssueUsers` /
  `toIssueLabels` from `@/lib/issue-mappers`; don't hand-roll the mapping.
- Emoji reactions: `useReactionCounts(reactions, viewerId)` returns the per-emoji
  `{ count, reacted }` map. Don't re-roll the reducer — it lived twice, verbatim,
  in the issue reaction bar and comment cards before it was extracted.
- Issue creation UI: there is exactly one create modal — `GlobalCreateIssueModal`,
  mounted in `WorkspaceClient` and driven by `uiStore.openCreateIssueModal()`.
  Open it via the store; never mount a second `CreateIssueModal`.
- Dropdown/popover state: use `usePopover({ open?, forceOpen?, onClose?,
  closeOnEscape? })` from `@/hooks/use-popover` — returns `{ open, setOpen, ref }`.
  `open` is fully controlled; `forceOpen` is a one-shot uncontrolled open. For
  outside-click only, use `useOutsideClick` directly.
- **Escape contract:** whichever surface consumes an Escape must claim it
  (`preventDefault` + `stopPropagation` — `useOutsideClick` does this for
  popovers, capture-phase). Window-level Escape listeners on parent surfaces must
  ignore handled events (`if (e.defaultPrevented) return`). One Escape closes
  exactly one surface.
- Toasts: use the `@/lib/toast` wrapper, never import sonner directly. It exposes
  `error` / `info` / `success` / `warning` plus `undo(message, label, onUndo)`,
  `loading`, `promise`, and `dismiss(id)`. `TransactionQueue` permanent failures
  with no per-call `onError` fall through to a default toast registered by
  `SyncProvider` — never rely on that as the primary UX for a known failure path.
