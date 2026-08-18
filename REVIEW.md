# Frontend Code Review — 2026-08-18

Branch: `claude/frontend-review-remediation-wjeilh` · Base: `f74b489`

## ⚠️ Immediate Attention

**None found.** No leaked secrets, no server-only code reachable from a client
module, no user input reaching `dangerouslySetInnerHTML` unsanitised, no
client-only auth enforcement.

One hardening item is worth a look but is *not* an active vulnerability
(**F10**): `src/components/editor/mermaid-node.tsx` is the app's only
`dangerouslySetInnerHTML` sink, and the SVG it injects comes from
org-authored diagram source. It is safe today only because Mermaid's *default*
`securityLevel` is `'strict'` — the call at line 17 never says so. One
line (`securityLevel: 'strict'`) removes the dependency on an upstream default.
Left unapplied deliberately: NN7 forbids quietly patching a security surface.

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
| Applied | 4 findings / 4 commits / 30 files |
| Proposed | 13 |
| Blocked | 0 |

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
component files use them — but 15 page files still hand-roll the fetch state
machine, and four of those render a dead-end error message where the rule
explicitly requires a retry affordance (**F08**). `useDocumentTitle` exists
precisely because every workspace tab showed the same static title, and it
reached 6 pages of 26 (**F07**). `runPoolStoreTests` factored out the *test* for
the pool-store shape while the implementation stayed copied twelve times
(**F04**, now fixed). The convention is not the problem; the rollout is.

The three highest-leverage things to do next:

1. **Fix the stale team-analytics memos (F05).** This is the only *behavioural
   bug* found, and it hides behind two dependency arrays that look plausible.
   Small fix, real user-visible effect.
2. **Finish the `useRetryableFetch` rollout (F08).** It converts 15 bespoke state
   machines into one tested one and removes four no-retry dead ends at the same
   time. Highest ratio of correctness gained to risk taken — but it wants the E2E
   gate running first.
3. **Get E2E runnable in review environments.** Three of the most valuable
   findings here (F07, F08, and the `'use client'` boundary work) are report-only
   *solely* because no gate covers those routes. That gap is what caps this
   review at Tier 2.

One meta-observation worth acting on: there are seven `eslint-disable` comments
in a repo that has no ESLint (**F14**). They suppress nothing, and two of them
sit directly above the F05 bug, where they read as "this dependency list was
reviewed and accepted." A suppression comment for a linter you don't run is
worse than no comment.

## Applied Fixes

| ID | Category | Severity | Files | Commit | Change |
|---|---|---|---|---|---|
| F01 | consistency | low | 10 | `f15242e` | Cross-directory `../` imports → the `@/` alias declared in AGENTS.md (1009 alias vs 44 relative before). |
| F02 | dry | medium | 7 | `0a8d9b2` | One Tailwind class string repeated at 14 sites for one semantic element → `POPOVER_ITEM_CLASS`, exported from the primitive those rows render into. |
| F03 | dry | medium | 2 | `f49dc03` | Byte-identical inline GraphQL documents duplicated within a file (DocumentUpdate ×2, ProjectUpdate ×2) → one module-level constant each. |
| F04 | dry | medium | 11 | `beb9500` | The I/U/A-upsert + D-delete SyncAction body, copied verbatim into 12 store methods → `applyPoolSyncAction()`, delegated to from each store's own `action`-annotated method. |

Every batch is one category and individually revertable. All five available
gates were re-run in full after each.

Why these four and nothing else: each is either a constant/alias substitution
that cannot change emitted output (F01, F02, F03), or a delegation that leaves
every MobX annotation and observable in place (F04). Everything with a behavioural
edge is below.

## Proposed — Needs Your Decision

### F05 · Team analytics charts freeze at mount *(best-practice, **high**, the only real bug found)*
`src/app/(workspace)/[workspace]/team/[key]/analytics/page.tsx:238,257`

```ts
const issues = useMemo(() => (teamId ? issueStore.findByTeamId(teamId) : []),
  [teamId, issueStore.findByTeamId]);   // ← prototype method: identity never changes
```

`findByTeamId` is a plain prototype method, so its identity is stable forever.
The memo never recomputes while `teamId` holds, and because the component is an
`observer`, the re-render that MobX triggers just returns the cached array. Every
chart on the page shows data as of page mount; issues created, completed or moved
while it is open never appear. `workflowStateStore.findByTeamId` at :257 has the
identical defect.

The repo already knows the right answer — `AGENTS.md` and
`.claude/rules/frontend.md` both say *"use `store.pool.size` as a `useMemo`
dependency"* — and nine other call sites follow it (`project-list-view.tsx:49,54,82`,
`sidebar.tsx:321`, `sub-issue-list.tsx:78`, `global-create-issue-modal.tsx:39`,
`cycle-list-view.tsx:97`, `project-detail-view.tsx:60`, `my-issues/page.tsx:48`).

**Fix:** `[teamId, issueStore.pool.size]` and `[teamId, workflowStateStore.pool.size]`.
**Why not applied:** it is a genuine bug, not a quality issue, and the checklist
routes bugs to the report. It also changes hook execution timing, which no unit
test covers for this page. **Effort:** minutes. **Risk of leaving it:** users
trust a stale dashboard.

### F06 · Custom-field inputs have no accessible name *(a11y, **high**)*
`src/components/custom-fields/custom-field-value-input.tsx:60, 69, 114`

The date input, the checkbox, and the text/number input render with no `<label>`,
no `aria-label`, and not even a `placeholder`. A screen-reader user hears "edit
text" with no indication of which custom field they are editing; the checkbox is
entirely unlabelled. WCAG 2.2 §4.1.2. **Fix:** thread the field definition's name
into `aria-label`, or a visually-hidden `<label htmlFor>`. **Why not applied:**
all accessibility fixes are report-only — adding an accessible name is an a11y
semantics change. **Effort:** small.

### F08 · 15 pages hand-roll the fetch state machine; 4 have no retry *(consistency, medium)*
`.claude/rules/frontend.md`: *"Fetch-on-mount goes through `useRetryableFetch`"*
— 18 component files do. These 15 do not:
`admin/{audit,page,users}`, `admin/tenants{,/[id]}`, `workspace/analytics`,
`workspace/issue/[id]`, `settings/{audit-log,automations,integrations,page,roadmap,security,webhooks}`,
`team/[key]/settings`.

Each re-derives the cancelled-flag / stale-response logic, with varying success.
Four — `admin/audit:69-71`, `admin/users`, `admin/tenants`, `workspace/analytics`
— render a bare `<p>{error}</p>` with no retry, which the same rule forbids
(*"a failed fetch must offer a retry, never render as an authoritative empty
state"*); `InlineRetry` exists for exactly this. **Why not applied:** changes what
renders on a failed load and the timing of the loading flag, on routes with no E2E
coverage. **Effort:** medium (≈1 day). **Risk of leaving it:** a transient API
failure looks like real emptiness on five admin/settings screens.

### F07 · `useDocumentTitle` reached 6 of 26 workspace pages *(consistency, medium)*
20 pages leave the browser tab on the static root title — the exact defect the
hook's own doc comment says it was written to fix. Adopted on `inbox`,
`initiatives`, `issue/[id]`, `my-issues`, `projects`, `team/[key]` (plus
`project-detail-view.tsx`); missing on `analytics`, `docs/[id]`, `[workspace]`,
`project/[slug]`, all eight `settings/*` pages, and all six `team/[key]/*`
subpages (`analytics`, `backlog`, `cycles`, `cycles/[cycleId]`, `docs`,
`settings`, `triage`, `view/[viewId]`). **Why not applied:** `document.title` is observable
browser state and no E2E covers it. **Effort:** small but broad.

### F17 · One store dispatcher silently ignores archive *(consistency, medium)*
`src/stores/initiative-store.ts:111` — `applyInitiativeProjectSyncAction` handles
only `'I' | 'U'`. Every other pool dispatcher treats `'A'` as an upsert. If the
server emits `'A'` for an `InitiativeProject` link, this store drops it and the
link stays stale until a re-bootstrap. **This is why it was excluded from the F04
refactor** — delegating it would have changed behavior. **Fix:** confirm against
the server whether that entity emits `'A'`; either add it, or add a comment
saying it never happens. **Effort:** minutes once the server answer is known.

### F09 · Burndown and burnup charts share ~100 lines of SVG scaffolding *(dry, low)*
`src/components/cycles/burn{down,up}-chart.tsx` — identical dimension constants,
`xScale`/`yScale`, `toPath`, grid, axis ticks, x-labels, legend frame; the
y-domain, series, and ideal-line formula differ. **Recommendation: extract the
pure geometry helpers only — not a shared chart component.** A shared component
would need series/ideal-line/legend switches, which is precisely the
config-object component the DRY bar forbids. Two occurrences, not three, and not
byte-identical, so this stays a judgement call. **Effort:** small.

### F12 · Three dead GraphQL helpers, and they caused the F03 duplication *(dead-code, low)*
`src/lib/graphql.ts:110-155` — `updateDocument`, `archiveDocument`,
`deleteDocument` have no callers. `document-editor.tsx` hand-wrote the same
`DocumentUpdate` mutation inline instead (that is what F03 just de-duplicated).
Also `localeNames` (`i18n/index.ts:9`) is unused everywhere, and `dictionaries` /
`DEFAULT_WS_PORT` are exported but consumed only inside their own module.
**Why not applied:** the choice is *delete the API* vs *adopt it*, and adopting it
would change the request path — `gql()` is a direct call, `TransactionQueue.enqueue`
is offline-queued and replayable. That is a product decision, not a cleanup.

### F14 · Seven `eslint-disable` comments in a repo with no ESLint *(consistency, low)*
`tiptap-editor.tsx:550,618,675`, `use-hotkeys.ts:254`,
`team/[key]/settings/page.tsx:175`, `team/[key]/analytics/page.tsx:237,256`.
Lint is Biome (`biome.json`); no ESLint config or dependency exists, so these
suppress nothing while reading as "reviewed and waived". **Deliberately not
auto-deleted:** the two on `analytics/page.tsx` sit directly on the F05 bug, and
removing the comment without fixing the bug would erase its only marker. Fix F05
first, then clean all seven together.

### F15 · `window.prompt` for real input, including impersonation targeting *(consistency, low)*
`admin/users:30` asks an operator to type a list index to choose **which tenant to
impersonate into** — a mistyped digit impersonates into the wrong organization.
Also `admin/tenants:80`, `admin/tenants/[id]:108` (suspension reason) and
`tiptap-editor:762` (link URL). The frontend rule mandates `ConfirmDialog` over
`window.confirm`; `window.prompt` is the same problem with a worse failure mode.
**Why not applied:** replacing them is a UX change, explicitly out of scope.

### F11 · Four unsound assertions *(types, low)*
`mermaid-node.tsx:113` (`as never` on the TipTap command return),
`use-issue-update.ts:59`, `team/[key]/page.tsx:541`, and
`settings/automations/page.tsx:82` (`as unknown as RulesData` on a fetch
response — a server shape change compiles clean and fails at runtime). **Why not
applied:** NN2 forbids type-widening, and tightening these is a design change
(declaration merging for TipTap; runtime validation for the automations
response), not a mechanical edit.

### F13 · Side effect inside a state updater *(best-practice, low)*
`src/hooks/use-visible-columns.ts` — `persist()` writes to `localStorage` from
inside the `setVisible` updater. React may invoke an updater more than once, so
this is an anti-pattern; it is harmless today only because the write is
idempotent. **Fix:** compute the next `Set` outside the updater, persist there,
pass the plain value in.

### F16 · `Math.random()` on every render *(best-practice, low)*
`mermaid-node.tsx:36` — `useRef(\`mermaid-${Math.random()…}\`)` evaluates on every
render and discards all but the first. `useId()` is the right primitive. **Why not
applied:** the id is handed to `mermaid.render()`, which uses it to key an
injected `<style>` element; changing its format is a behavior change I cannot
verify without E2E.

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

**Codebase-wide migrations worth considering** — all three are rollout gaps
rather than disagreements, and all three want the E2E gate running first:
finishing `useRetryableFetch`/`InlineRetry` (F08), finishing `useDocumentTitle`
(F07), and auditing `'use client'` boundaries (surveyed, nothing applied: 34 of
52 files under `src/app` are client components, and moving a boundary changes
what renders on the server, which is report-only by rule).

## Notes on Scope

- No dependency was upgraded, added, or removed. `yarn install --immutable` and
  `yarn db:generate` were run to make the gates executable; `yarn.lock` is
  untouched.
- No test was modified, added, skipped, or deleted. No `eslint-disable`,
  `@ts-ignore`, `@ts-expect-error`, `any`, or `as unknown as` was introduced.
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
