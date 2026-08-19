---
paths:
  - "src/**/*.test.{ts,tsx}"
  - "tests/**/*.{ts,tsx}"
  - "src/test/**/*.ts"
---

# Testing conventions

## Unit tests (Vitest)

- Mock Prisma via `createMockPrisma()`, mock context via `createMockContext()`.
  Fixtures live in `src/test/fixtures.ts`.
- If the subject emits a SyncAction, stub the write with
  `mockSyncActionInserts(prisma)` and assert with `readSyncActionInserts(prisma)`
  (`src/test/sync-action-mock.ts`). `recordSyncAction` goes through a raw
  `INSERT … RETURNING`, **not** `prisma.syncAction.create`, so a
  `prisma.syncAction.create` spy silently never fires.
- Role-gated resolvers read `ctx.orgRole` — express "caller lacks the role"
  there, not via a Prisma mock.
- `MockSyncService` returns `{ id: BigInt(1) }`, so assert
  `lastSyncId === '1'` (a string).

## A test that cannot fail is not a test

Verify every new assertion is non-vacuous before trusting it: regress the thing
it guards and watch it go red. This repo has caught several suites that asserted
nothing — a contract test that checked documents *against* the SDL passed
happily when both sides drifted together, and a timing trigger test proved
nothing because `psql -c` sends multiple statements as one batch, so
`statement_timestamp()` never advanced between them.

## Run the gates on the pinned Node

`.node-version` pins **Node 24** and that is what CI uses. A sandbox or laptop
on an older Node runs a different runtime, and the difference is not always
cosmetic — Node 24's undici keeps `Request`/`Response` internals in private
class fields, so a hand-built stand-in for one of them (`Object.create(request,
…)`, a partial object literal) throws `Cannot read private member #state` there
while passing happily on Node 22. Check `node --version` before trusting a green
local run.

## E2E tests (Playwright)

- Specs live in `tests/e2e/`. The dev server **and** the WS server must both
  be running. CI runs chromium only.
- **Don't log in per test.** The `setup` project (`tests/e2e/auth.setup.ts`)
  signs both seeded accounts in once and parks the cookies; a spec declares
  `test.use({ storageState: ADMIN_STATE })` (or `MEMBER_STATE`) and calls
  `openWorkspace(page)`. `loginAs(page, email)` still exists for the specs
  that are *about* signing in — replaying the magic-link flow in every
  `beforeEach` was roughly half the suite's wall time.

### Specs must not leave issues behind

`GroupSection` virtualizes a group past **20 rows**. Past that a newly created
row is not in the DOM at all, so `getByText(title)` on a just-created issue
fails with "element(s) not found" — on whichever test happens to run next,
which is nowhere near the cause.

Specs create issues and mostly do not remove them, so the list grows within a
run and across runs. The `cleanup` teardown project
(`tests/e2e/cleanup.teardown.ts`) archives everything but the seeded six after
each run, which is what keeps the suite re-runnable against one database.
Don't remove it, and don't let it fail quietly: an earlier version queried
`issues` without the required `filter.teamId`, and the unchecked `errors[]`
read as "nothing to clean up".

This is not a theoretical limit. Against a database two runs had dirtied,
exactly ten tests failed — all of `sync.spec.ts`, all of `offline.spec.ts`,
`issue-crud`'s create and `issue-detail`'s inline edit — and reseeding made
all ten pass. Those are close to the same tests that spent months disabled as
CI-load flakes.

Within a single run the list still grows, so the headroom is not unlimited: a
chromium run peaks around 9 rows in the largest group and a two-browser run
around 18, against a threshold of 20. If you add specs that create a lot of
issues, check the largest group mid-run rather than trusting that it fits.

## Don't press a shortcut the instant its target appears

`useHotkeys` registers from a `useEffect`, so there is a window between the
paint that reveals a control and the commit that binds its shortcut. A press
that lands in it is swallowed silently — no error, no change. `issue-detail`'s
Shift+S hit this once in nine full runs; it now presses inside `expect.poll`
so a swallowed press is simply retried.
