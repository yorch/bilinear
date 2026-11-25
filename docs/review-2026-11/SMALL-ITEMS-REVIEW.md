# Small-items follow-up — adversarial review

Scope: `git diff origin/main...HEAD` on `claude/zealous-albattani-fgfku5` (13 files:
bulk-bar Due-date sheet, toast opacity, mobile chip labels, DatePanel in the
due-date picker, `src/server/yjs/sweep.test.ts`).

Verification done: read every changed file plus `Calendar`, `SelectPopover`,
`usePopoverPanel`, `usePopoverFlip`, sonner's `styles.css`, `globals.css` and both
locale files. `yarn vitest run` → 276 files / 3599 tests green; `sweep.test.ts`
5/5 green runs in a row (~1.5 s each). The local run used Node 22, not the pinned
Node 24. Nothing was measured in a real browser. The layout numbers below are
worked out from the Tailwind classes.

No Critical findings.

---

## High

### H1. Panel layout: the new mobile chip labels repeat the visible row labels
`src/components/issues/issue-detail-content.tsx:357-358, 383-384, 400, 411, 427`
(and `labelClass` at :237)

`labelClass` hides the row labels below `lg` **only when `isPage`**
(`cn('text-muted-foreground', isPage && 'max-lg:hidden')`). The new
`labelBelowLg` props are passed to every layout without that condition. In
`layout="panel"` (`issue-detail-panel.tsx:220`), the panel is the full-screen
sheet on phones and the 480 px side panel at 768–1023 px. There every row now
reads "Due date | Due date Nov 16", "Start date | Start date Dec 1",
"Project | ◎ Project", "Cycle | ⟳ Cycle" and "Estimate | Estimate 3". Visible
text is duplicated, which is exactly what the item set out to avoid. Before this
change, `iconBelowLg` added only an icon there.

**Fix:** gate on the layout. Use `labelBelowLg={isPage ? t('…') : undefined}` for
the date and estimate pickers, and `labelBelowLg={isPage}` plus
`label={isPage ? t('…') : undefined}` for Project and Cycle. Add a test that renders
`layout="panel"` and checks each field name appears exactly once.

### H2. Due-date panel is now ~266 px wide, right-anchored, and has no phone treatment: it opens off the left edge
`src/components/properties/due-date-picker.tsx:89-91, 156`

`Calendar` is a fixed `w-64`. With the panel's `p-1` and border, the
shrink-to-fit panel is ~266 px wide; the native input it replaced was ~180 px.
The panel is still `align="right"` (`right-0`) with
`panelClassName="min-w-[180px] p-1"` and no `max-md:` sheet. Nothing clamps it
horizontally: `usePopoverFlip` is vertical-only.

Failure on a 390 px phone:
- **Detail page:** chips wrap, so the Start or Due chip often starts a line at
  x≈16. Its right edge is then at ≈120–140 px, so the panel spans about −140 px to
  130 px. The Sun–Wed columns sit off-screen, and you cannot scroll to negative x.
- **Full-screen panel:** the value column starts ≈117 px in, and the panel overflows
  the `overflow-y-auto` body (where overflow-x computes to `auto`) by ≈40 px.

The panel also grew from ~250 px to ~480 px tall (4 presets, input, 6-week grid,
clear). Inside the panel's scroll body, an upward flip (spaceBelow < 160) now
pushes the top of the panel above the scroll origin, where it cannot be reached.

**Fix:** on phones, reuse the bulk bar's sheet:
`panelClassName={cn('min-w-[180px] p-1', 'max-md:fixed max-md:inset-x-2 max-md:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-md:top-auto max-md:max-h-[calc(100dvh-2rem)] max-md:overflow-y-auto')}`,
or factor `MOBILE_SHEET` into `ui/`. Alternatively, teach `usePopoverFlip` to
choose left or right alignment from `getBoundingClientRect()`. Check it at 390 px
on the page layout, the panel layout and the create modal.

---

## Medium

### M1. Bulk Due-date sheet still does not fit a 667 px phone in Safari; the test title overstates it
`src/components/issues/bulk-action-bar.tsx:37-45`, test `bulk-action-bar.test.tsx:164`

Drill-in content adds up to ≈442 px:
- header row 28
- 4 presets × 32 = 128
- "or pick" 24
- Calendar ≈227 for 6 weeks
- Clear 32
- borders

The cap is `100dvh − 8rem − safe-bottom`. On an iPhone SE in Safari with the
toolbars showing, `100dvh` ≈ 548 px, so the cap is ≈420 px. The sheet therefore
still scrolls, and "Clear date" (the only way to remove a bulk due date) sits
partly below the fold. It is reachable only because the outer `MOBILE_SHEET`
keeps `max-md:overflow-y-auto`. That fallback is what saves it, yet the test is
titled "no inner scroll for the calendar".

The `6.5rem` bottom offset is also a guess at the bar's height. The bar wraps
(`flex-wrap`, `max-h-[40vh]`), and with Label/Project/Cycle present it can take
three rows (≈116 px), so the sheet overlaps the bar.

**Fix:**
- Make the presets compact in the tall drill-in (a 2×2 grid of `py-1 text-xs`
  saves ≈64 px), or put Clear in the header beside Close.
- Derive the bottom offset from the measured bar height (a CSS var set by a
  `ResizeObserver` on the bar), not a constant.
- Rename the test to what it actually checks: the body has no own scroll region
  and the cap is lifted.

### M2. Phone-only Close button has a 24 px hit area (TOUCH_TARGET rule)
`src/components/issues/bulk-action-bar.tsx:140-145`

It is `p-1` around an `h-4 w-4` icon, and `md:hidden`, so it only ever renders on
phones. `.claude/rules/frontend.md` requires icon-sized controls to take
`TOUCH_TARGET_SQUARE` (`max-md:h-11 max-md:w-11`). As written, it is easy to miss
and to hit the Back button next to it instead.

**Fix:** `className={cn(TOUCH_TARGET_SQUARE, 'mr-1 flex shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent md:hidden')}`.

### M3. Set date chips fail WCAG 2.5.3 Label-in-Name
`src/components/properties/due-date-picker.tsx:92, 96-98`

The visible text below `lg` is now "Due date Nov 16" or "Start date Dec 1". The
trigger's `aria-label` (`triggerAriaLabel={title}`) overrides it with "Due Nov 16"
or "Starts Dec 1" (es: visible "Fecha límite 16 nov" vs. name "Vence 16 nov").
The visible label is not contained in the accessible name, so a voice-control
user who says "click Due date" gets nothing. The empty state passes
("Due date" ⊂ "No due date").

**Fix:** when `labelBelowLg` is set and a value exists, build the name from the
visible words, e.g. `` `${labelBelowLg} ${formatDueDate(value)}` ``. Or drop
`triggerAriaLabel` in that case and let the visible text be the name.

### M4. The toast lift stops at 600 px, but the bulk bar docks up to 767 px
`src/lib/toast.ts:76-77`

`ABOVE_BULK_BAR` uses `max-[600px]` (sonner's mobile breakpoint). The bulk bar is
docked full-width at the bottom for everything below `md` (768 px). Between 601
and 767 px (landscape phones, iPad-mini portrait at 744 px), sonner uses its
desktop bottom-right offset (~24–32 px), so toasts land on the bar's Archive and
Delete buttons. The lift is also fixed at `7.5rem`, while the bar's height varies
(see M1).

**Fix:** use `max-md:` (the class already carries `!`, so it beats sonner's inline
offset at both breakpoints), and share one bar-height variable with M1. The test
only checks `toContain('bulk-action-bar')`. It should also check the breakpoint
token.

### M5. Toasts in dark mode: hovering the close button paints near-white
`src/lib/toast.ts:53-66` (`TOAST_THEME`)

`<Toaster closeButton richColors />` (`src/app/layout.tsx:127`) has no `theme`
prop, so sonner runs as `data-sonner-theme="light"`. Sonner's rule
`[data-sonner-toast][data-styled='true']:hover [data-close-button]:hover { background: var(--gray2); border-color: var(--gray5) }`
outranks the per-type rich-colour rules and uses sonner's light greys
(hsl 0 0% 97%), which `TOAST_THEME` never remaps. In `.dark`, the close button
turns into a white disc and its light ink disappears, on every toast type. The
new test filters to keys ending in `-bg` or `-border` and asserts exactly 10, so
it cannot notice surfaces outside that set.

**Fix:** add `'--gray2': 'color-mix(in oklab, var(--foreground) 8%, var(--popover))'`
and `'--gray5': edge-equivalent` to `TOAST_THEME`, or mirror `resolvedTheme` from
next-themes into sonner's `theme`. Extend the test to cover every sonner variable
used on a surface (`--normal-bg`, `--*-bg`, `--*-border`, `--gray2`, `--gray4`,
`--gray5`).

### M6. The toast opacity test does not prove opacity
`src/lib/toast.test.ts:22-36`

It checks string shapes in TS against a hand-written deny-list
(`-subtle`, `var(--border)`, `accent`, `muted`). `globals.css` has two more
translucent tokens, `--input` and `--brand-border`. A value such as
`color-mix(in oklab, var(--input) 50%, var(--popover))` passes both the allow
regex and the deny regex, yet in oklab the mix interpolates alpha, so the result
is translucent. The test also never checks that `--popover`, `--foreground` and
the status tokens are opaque in `:root` and `.dark`. Making `--popover`
translucent (a "glass" theme) would leave the test green.

**Fix:** parse `src/app/globals.css` (as `contrast.test.ts` already does) and
collect every token whose value has an alpha channel (`/ x)` or `transparent`) in
either theme. Then assert that every `var(--x)` referenced from a toast surface is
absent from that set. Prove the test can fail by temporarily setting
`--normal-border` back to `var(--border)`.

### M7. New `min`/`max` props on `DueDatePicker` have no caller
`src/components/properties/due-date-picker.tsx:35-38`

The props are added and tested, but no call site passes them:
- issue start/due (`issue-detail-content.tsx:397-415`)
- project start/target (`project-properties-panel.tsx:284-300`)
- initiative target

A start date after the due date (or a project target before its start) is still
accepted. That is surface area with no consumer, the same failure the
config-registry rule warns about.

**Fix:** wire `max={issue.dueDate}` / `min={issue.startDate}` (and the project
equivalents), or drop the props until there is a caller.

### M8. Vacuous assertion in the due-date "first Enter" test
`src/components/properties/due-date-picker.test.tsx:61-62`

`fireEvent.keyDown(day, { key: 'Enter' })` never activates a button in jsdom
(there is no synthetic click), so `expect(onChange).not.toHaveBeenCalledWith(null)`
passes even if focus were on "Clear date". The `activeElement` checks are what
actually guard the contract, and they do. The Enter line reads as coverage it
does not give. In a real browser, Enter on the selected day also re-commits the
same date, which fires a no-op mutation and a SyncAction.

**Fix:** delete the Enter line, or use `userEvent.keyboard('{Enter}')` (which
clicks) and assert `onChange` was called with `'2026-03-05'`. Separately, skip
`onChange` in `DueDatePicker` when the picked key equals `value?.slice(0, 10)`.

### M9. `sweep.test.ts`: fixed sleep and a fixed port
`src/server/yjs/sweep.test.ts:77, 131`

The tests themselves are real. If the sweep does nothing, the close assertions
fail. If it closes everything, the control and peer assertions fail. They were
stable 5/5 here.

The isolation rests on `await sleep(200)` "to let rooms unload", which is a
wall-clock guess. Under CI load, a previous test's connection for the same
`userId` can still be in the room, and `const [conn] = serverConnections(...)`
then spies on the stale one. Today that happens to pass, because the sweep closes
every connection of that user, but the assertion is then about the wrong socket.

Port 18236 is hard-coded, as are 18234 and 18235 in the sibling files. A second
concurrent `yarn test` on the same host (watch mode plus CI, or two worktrees)
fails with EADDRINUSE.

**Fix:**
- Replace the sleep with `await vi.waitFor(() => expect(server.hocuspocus.documents.size).toBe(0))`.
- Assert `serverConnections(id)` has length 1 before destructuring.
- Listen on port 0 and read the bound port back, for all three yjs suites.

---

Checked and found OK (no finding):
- en/es keys exist for every new string.
- `twMerge` replaces the sheet's `max-md:max-h-*` rather than stacking it.
- Desktop: every new label is `lg:hidden`, and the dueDate More entry is `mobileOnly`.
- `DateField` behaviour is unchanged: the input still comes first in DOM order
  with `data-autofocus`.
- Clear maps `'' → null` in `DueDatePicker` for every caller.
- Calendar date keys are local `YYYY-MM-DD` and truncate ISO values, so they are
  not shifted by timezone.
- Escape handling goes through the existing `useOutsideClick` capture.
- No new timing assumptions elsewhere in the suite.
