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

- Specs live in `tests/e2e/`. Use the `loginAs(page, email)` helper.
- The dev server **and** the WS server must both be running.
- CI runs these against a seeded database (`yarn db:seed`), chromium only.
