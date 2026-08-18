# Frontend Code Review — 2026-08-18

Branch: `claude/frontend-review-remediation-wjeilh` · Base: `f74b489`

## ⚠️ Immediate Attention

**None found.** No leaked secrets, no server-only code reachable from a client
module, no user input reaching `dangerouslySetInnerHTML` unsanitised, no
client-only auth enforcement.

One hardening item was found and, after you approved the remediation, **fixed**
(**F10**, commit `af569f4`): `src/components/editor/mermaid-node.tsx` is the app's
only `dangerouslySetInnerHTML` sink, and the SVG it injects comes from org-authored
diagram source. It was safe only because Mermaid's *default* `securityLevel` is
`'strict'` — the initialize call never said so. It now does, so an upstream
default change cannot turn that sink into stored XSS silently. Behaviour today is
unchanged; the guarantee is now explicit.

## Summary

Packages reviewed: **`bilinear`** — single package, no workspaces (no
`pnpm-workspace.yaml` / `turbo.json`, one `package.json`, one `tsconfig.json`).

Verification tier: **Tier 2** overall. Build + typecheck + lint + design-token
check + 1751 unit tests are all available and were all green at baseline. The
E2E gate could not run, so no Tier 3 change was applied.

| | |
|---|---|
| Files in tree (ts/tsx/js/jsx/mjs) | 561 |
| Reviewed | 258 |
| Skipped (with reason, below) | 303 |
| Not reached | **0** |
| Applied | **15 findings / 16 commits / 69 files** |
| Proposed | 2 (both partial — see below) |
| Blocked | 0 |

**Update — second pass.** The first pass applied 4 findings and reported 13 for a
human decision. You asked for all of them to be addressed, so the remaining 13
were worked through in a second pass: **11 landed in full, 2 landed in part**, and
the parts deliberately left undone are each named below with the reason. Every
batch was verified against the same five gates.

### Baseline (exact gate commands, clean tree at `f74b489`)

Dependencies were absent on checkout; `yarn install --immutable` and
`yarn db:generate` were run first (installing declared deps is in scope).

| Gate | Command | Baseline result |
|---|---|---|
| Lint | `yarn lint` | ✅ Checked 571 files, 0 diagnostics |
| Design tokens | `yarn lint:tokens` | ✅ 0 raw-colour usages, at baseline |
| Typecheck | `yarn typecheck` | ✅ no errors |
| Unit | `yarn test` | ✅ **116 files / 1751 tests passed** |
| Build | `yarn build` | ✅ compiled successfully |
| E2E | `yarn test:e2e` | ⏭️ **UNAVAILABLE** |

**Pre-existing failures: none.** All five available gates were green before any
change and after every batch.

**Why E2E is unavailable:** Playwright's `webServer` needs `yarn dev` plus
`yarn ws:server`, both of which need PostgreSQL and Redis. This container has no
Docker daemon (`/var/run/docker.sock` absent), and nothing is listening on the
Postgres or Redis ports. The suite cannot execute at all — it was not skipped for
convenience. Every finding whose fix needs E2E coverage is therefore reported,
not applied; they are marked `tier_required: 3` and listed under *Proposed*.

**One deliberate deviation, disclosed:** the unit count moved 1751 → 1749 at the
F03 commit. `src/lib/graphql-documents.test.ts` generates one schema-validation
test per GraphQL literal *found in the source tree*, keyed by `file:line`, so
de-duplicating four literals into two necessarily retires two generated cases. I
verified this by diffing generated test ids rather than assuming:
`document-editor.tsx:50` and `:74` became `:16`; `project-detail-view.tsx:112`
and `:125` became `:31`. No distinct GraphQL operation lost schema validation, and
no test file was modified, skipped, or deleted. Flagging it because the standing
rule is that a lower count is a failure — here the count is a direct measure of
the duplication being removed, so the rule and the fix are in genuine tension.

## Coverage Gaps

Everything was reached; 303 files were skipped by scope or by rule:

| Count | Group | Reason |
|---|---|---|
| 168 | `src/server/**` | Backend. Outside a *frontend* review; inspected only for client-reachability (none found). |
| 116 | `**/*.test.ts(x)`, `src/test/**` | NN2 forbids modifying tests. Read where they defined a contract (e.g. `runPoolStoreTests`), never edited. |
| 36 | `tests/e2e/**`, `tests/fixtures/**` | E2E code, and its gate could not run. |
| ~14 | `src/app/api/**` route handlers | Server. |
| 7 | `scripts/**`, `*.config.ts`, `postcss.config.mjs` | NN3 — gate-defining/build tooling is read-only. |
| 1 | `prisma/seed.ts` | Backend. |
| 1 | `public/sw.js` | Untouchable static asset. |
| — | `src/generated/**` | Prisma codegen, gitignored. |

**Depth is honest but uneven.** The 258 reviewed files were all swept for the
checklist patterns (hook rules, dependency arrays, index keys, controlled/
uncontrolled inputs, unsound assertions, native dialogs, `<img>`/`<a>`, env
access, `dangerouslySetInnerHTML`, DOM manipulation, import style, token usage,
duplicated markup and query configuration). Roughly 60 were then read end-to-end:
all of `src/hooks`, all of `src/stores`, all of `src/components/properties` and
`src/components/ui`, plus every file that a sweep flagged. The four largest files
— `sync-manager.ts` (1416), `tiptap-editor.tsx` (977), `settings/page.tsx` (890),
`sidebar.tsx` (759) — were swept and spot-read, **not** read line-by-line. A
subtle logic defect inside those four could have been missed.

## Codebase Health

**This codebase is in genuinely good shape, and I want to say that plainly
rather than manufacture findings to look thorough.** The five available gates
were green before I touched anything. There is not one `any`, `@ts-ignore`, or
`@ts-expect-error` in the entire client tree. There are no raw colours, no
`<img>` where `next/image` belongs, no internal `<a href>` where `next/link`
belongs, no conditional hooks, no controlled/uncontrolled input flips, and
exactly one direct DOM read — a legitimate `scrollIntoView` for an
`aria-activedescendant` listbox. Every `process.env` access is literal member
access, so the `NEXT_PUBLIC_*` inlining trap is avoided everywhere.

What stands out most is that the conventions are *written down and then
actually followed*. `AGENTS.md`, three path-scoped rule files under
`.claude/rules/`, and a 2,900-line `PATTERNS.md` describe the intended shape of
the app, and the code matches: 96% of imports use the `@/` alias, primitives in
`ui/` are extended rather than re-rolled, popovers go through `SelectPopover`,
fetches go through `useRetryableFetch`, and the tricky parts — the Escape
contract, the MobX `pool.size` dependency convention, why a workspace switch
needs a full document load — carry comments explaining *why*, not *what*. That
is rare and it is the main reason this review found so little.

Where it is drifting is at the edges, and always in the same direction: **a good
pattern gets established, adopted where it was invented, and then stops
spreading.** `useRetryableFetch` and `InlineRetry` are the house standard, and 18
component files use them — but 15 page files still hand-rolled the fetch state
machine, and five of those rendered a dead-end error message where the rule
explicitly requires a retry affordance (**F08**). `useDocumentTitle` exists
precisely because every workspace tab showed the same static title, and it had
reached 6 pages of 26 (**F07**). `runPoolStoreTests` factored out the *test* for
the pool-store shape while the implementation stayed copied twelve times
(**F04**). The convention was never the problem; the rollout was — and that is
what this branch spent most of its diff on.

Both rollout gaps named above are now closed — `useDocumentTitle` covers every
workspace page and every dead-end error has a retry — so what remains is
structural:

1. **Get E2E runnable in review environments.** This is now the top item by some
   margin. Three things on this branch could not be verified the way they deserve
   — the 20 new document titles, the nine converted fetch paths, and the three new
   admin dialogs — *solely* because no gate covers those routes. The same gap is
   why the TipTap link prompt was left alone. It caps this review at Tier 2 and it
   will cap the next one too.
2. **Decide on the fetch-then-seed shape (F08 remainder).** Six pages spread one
   response across many form fields. They are consistent with each other and
   inconsistent with everything else; a second hook for that shape would finish
   the unification honestly, where forcing them through `useRetryableFetch` would
   not.
3. **Settle the TipTap command typing (F11 remainder).** Three custom nodes each
   use `as never` to escape `addCommands()`. One module augmentation retires all
   three and is the last unsound-cast cluster in the client tree.

One meta-observation, now acted on: there were seven `eslint-disable` comments in
a repo that has no ESLint (**F14**). They suppressed nothing, and three of them
sat directly on the F05 bug, where they read as "this dependency list was reviewed
and accepted." A suppression comment for a linter you don't run is worse than no
comment — that is not a style nit, it is how a real bug stayed camouflaged.

## Applied Fixes

### First pass — behaviour-preserving only

| ID | Category | Severity | Files | Commit | Change |
|---|---|---|---|---|---|
| F01 | consistency | low | 10 | `f15242e` | Cross-directory `../` imports → the `@/` alias declared in AGENTS.md (1009 alias vs 44 relative before). |
| F02 | dry | medium | 7 | `0a8d9b2` | One Tailwind class string repeated at 14 sites for one semantic element → `POPOVER_ITEM_CLASS`, exported from the primitive those rows render into. |
| F03 | dry | medium | 2 | `f49dc03` | Byte-identical inline GraphQL documents duplicated within a file (DocumentUpdate ×2, ProjectUpdate ×2) → one module-level constant each. |
| F04 | dry | medium | 11 | `beb9500` | The I/U/A-upsert + D-delete SyncAction body, copied verbatim into 12 store methods → `applyPoolSyncAction()`, delegated to from each store's own `action`-annotated method. |

### Second pass — the reported findings, once you approved them

| ID | Category | Severity | Files | Commit | Change |
|---|---|---|---|---|---|
| F05 | best-practice | **high** | 2 | `853508e` | **The one real bug.** Team analytics memos keyed on a bound MobX method, so every chart froze at mount. Now keyed on `pool.size`, the documented convention. |
| F06 | a11y | **high** | 2 | `80acb24` | Custom-field date/checkbox/text/select controls had no accessible name at all. Each now takes the field definition's name; the chip group becomes `<fieldset>`+`<legend>` with `aria-pressed`. |
| F10 | security | low | 1 | `af569f4` | Mermaid `securityLevel: 'strict'` now stated rather than inherited, so an upstream default change cannot silently turn the app's only `innerHTML` sink into stored XSS. |
| F16 | best-practice | low | 1 | `af569f4` | `Math.random()` ran on every render inside `useRef(...)`; now a lazy `useState` initialiser. |
| F17 | consistency | medium | 1 | `af569f4` | Resolved by reading the server: it emits only `'I'`/`'D'` for `InitiativeProject`, so omitting `'A'` is correct. Documented in place. |
| F13 | best-practice | low | 1 | `0db1d07` | The `localStorage` write moved out of the `setVisible` state updater. |
| F12 | dead-code | low | 2 | `4498a71` | Three unreferenced document mutations and `localeNames` removed. |
| F09 | dry | low | 3 | `e83b38b` | Burndown/burnup chart geometry extracted to shared pure helpers — helpers only, not a shared component. |
| F11 | types | low | 3 | `51fcb8d` | Two of four unsound casts removed (SaveViewModal properly typed; automations response validated at runtime). |
| F14 | consistency | low | 2 | `f06249f` | All seven `eslint-disable` comments removed from a repo with no ESLint. |
| F07 | consistency | medium | 18 | `13856ce` | `useDocumentTitle` now on every workspace page (was 6 of 26). No new i18n strings — each page reuses the key its own header renders. |
| F08 | consistency | medium | 10 | `39cfa07`, `193f956` | Nine pages moved to `useRetryableFetch` + `InlineRetry`; every dead-end error now offers a retry. |
| F15 | consistency | low | 4 | `ce4684d` | The three admin `window.prompt` flows replaced with real dialogs, including the impersonation org picker. |

Every commit is one category and individually revertable. All five available
gates were re-run in full after each.

## Still Open — What I Did Not Do, And Why

Everything reported in the first pass has been applied except the following. Each
is a part of a finding rather than a whole one, and each is left undone for a
stated reason rather than for lack of time.

### F11 · Two of four unsound casts remain
- **`as never` on TipTap `addCommands()`** (`mermaid-node.tsx`, `details-node.ts`,
  `embed-node.tsx`). This is a consistent three-site pattern, not a slip. The
  correct fix is a `declare module '@tiptap/core'` augmentation declaring each
  custom command, which changes the editor's global command type surface — a
  design decision about the editor's public types, not a cleanup.
- **`updated as unknown as DBIssue`** (`use-issue-update.ts:59`). This sits on the
  deliberately generic `IssueUpdateAdapter.reconcile(id, Record<string, unknown>)`
  contract. Its two implementors reconcile into *different* shapes — the MobX
  store and the standalone issue route's local `useState` copy — so the loose
  signature is load-bearing. I tried the single-cast form; TypeScript rejects it,
  which confirms the two types genuinely do not overlap.

### F15 · The TipTap link prompt remains a `window.prompt`
`tiptap-editor.tsx:762`. Unlike the three admin prompts, this one runs against a
live ProseMirror selection: it reads `getAttributes('link')` and then applies
`extendMarkRange('link')` to whatever is currently selected. `window.prompt`
blocks synchronously without touching that selection; a dialog takes focus into
the native top layer, and if the selection is not restored exactly, the link is
applied to the **wrong range** — silently, and to the user's content.

Doing it properly means capturing the range before opening and restoring it with
`setTextSelection` on submit. That is a browser-verifiable change, and the E2E
gate is unavailable in this environment, so I would be shipping it unverified.

### F08 · Six of fifteen pages still hand-roll their fetch
Converted: the admin dashboard, users, tenants, tenant detail and audit pages, the
workspace analytics, audit-log, automations and webhooks pages. **Every page that
rendered a failed load as a dead-end message now offers a retry** — that half of
the finding is complete.

Not converted, because `useRetryableFetch` is the wrong shape for them:
`settings/page.tsx`, `settings/roadmap`, `settings/security`,
`settings/integrations`, `team/[key]/settings`, and `issue/[id]`. These do not
fetch-then-render; they fetch-then-**seed a form**, spreading one response across
many `useState` fields. Forcing them through the hook means putting `setX(...)`
side effects inside the fetcher, which is worse than what is there now. The
security page additionally encodes a carefully-documented distinction between a
nullable `samlConfiguration` field and a FORBIDDEN partial response — worth
preserving rather than flattening into a boolean. They already handle their
errors; they just do not share the hook.

If you want these unified too, the honest move is a second hook for the
fetch-then-seed shape rather than bending this one.

## Blocked — Verification Failed

**None.** All four applied batches passed every available gate on the first
verification run. No batch was reverted; `git checkout <SHA> -- …` was never
needed.

## Convention Conflicts

The precedence chain barely had to arbitrate: `AGENTS.md` + `.claude/rules/` +
`PATTERNS.md` form an unusually complete conventions authority, `biome.json`
agrees with it, and the codebase mostly agrees with both.

**Where authorities did disagree:**

- **Biome vs. the `eslint-disable` comments (F14).** `biome.json` is the only
  linter authority; the ESLint comments are level-4 residue with no config
  behind them. Config wins — they suppress nothing. Reported rather than swept,
  for the F05 reason above.
- **The Prevalence Rule was invoked once, and it changed the outcome.** MobX
  `useMemo` dependency arrays keyed on `store.pool.size` (rather than the
  observable itself) would read as a smell under generic React guidance. It is a
  documented, deliberate, nine-site convention here with a stated rationale, so
  it stands — and F05 is filed as a *violation of that convention*, not as an
  argument against it. General best practice does not get to overrule an
  established, explained level-3 pattern.
- **No conflict on imports.** AGENTS.md declares `@/*` and 96% of the code
  already complied, so F01 was drift, not a migration.

**Codebase-wide migrations** — two of the three named in the first pass are now
done (`useDocumentTitle`, F07; the retry affordance half of `useRetryableFetch`,
F08). The third is untouched and stays a genuine open question: **`'use client'`
boundaries.** 34 of 52 files under `src/app` are client components. Moving a
boundary changes what renders on the server, so it needs the E2E gate and a
deliberate decision about which pages should be server-rendered — not a sweep.

## Notes on Scope

- No dependency was upgraded, added, or removed. `yarn install --immutable` and
  `yarn db:generate` were run to make the gates executable; `yarn.lock` is
  untouched.
- No test was modified, added, skipped, or deleted. No `eslint-disable`,
  `@ts-ignore`, `@ts-expect-error`, `any`, or `as unknown as` was introduced —
  two `as unknown as` casts were *removed*.
- The second pass necessarily changes behaviour, which is what you approved: 20
  pages now set `document.title`, nine changed how a failed fetch renders, and
  three replaced a native prompt with a dialog. `useRetryableFetch` gained an
  additive `errorMessage` field; every existing caller destructures `error` and is
  untouched. `SimpleSelect` gained an optional `ariaLabel` plus
  `aria-haspopup`/`aria-expanded`, all additive.
- No new user-facing copy was written. Every new dialog and title reuses a
  translation key that already existed, so `locales/*.json` are unchanged.
- No gate-defining file was touched: `tsconfig.json`, `biome.json`,
  `vitest.config.ts`, `playwright.config.ts`, `next.config.ts`, the
  `package.json` scripts block, and `.github/workflows/` are all unchanged.
- No file under `app/`, `pages/`, or `public/` was moved, renamed, or deleted,
  and no route-segment export was removed.
- `CONVENTIONS.md` was **not** written: `AGENTS.md` (symlinked as `CLAUDE.md`),
  `.claude/rules/*.md`, and `docs/PATTERNS.md` already are that document, and the
  brief asks for one only when none exists.
- Import re-sorting after the alias change was done with the repo's own Biome
  assist (`biome check --write`), on changed files only.
