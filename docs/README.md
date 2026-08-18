# Documentation

## Bilinear — Linear Rebuild

Start with [`PATTERNS.md`](PATTERNS.md) — it is the primary conventions
reference. It is 3,000+ lines, so read the section you need from its table of
contents rather than the whole file.

## Living documents

Kept current as the code changes. If you change behaviour these describe, update
them in the same PR.

| Document                                        | Use it for                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| [`PATTERNS.md`](PATTERNS.md)                     | The mandated conventions. 80 numbered sections; start from the TOC             |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)             | How the pieces fit — request flow, sync engine, process boundaries             |
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)       | Schema, the migration-consolidation policy, real-Postgres verification recipe  |
| [`API_DESIGN.md`](API_DESIGN.md)                 | GraphQL contracts — types, queries, mutations, error codes                     |
| [`REVIEW_BACKLOG.md`](REVIEW_BACKLOG.md)         | **The active work queue** — open findings, what shipped, what is deferred      |
| [`CHANGELOG.md`](CHANGELOG.md)                   | What shipped when, and the reasoning behind each decision                      |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Canonical per-sprint status; Sprint 15+ lives here rather than in `sprints/` |
| [`PRD.md`](PRD.md)                               | Product requirements                                                          |
| [`LINEAR_FEATURE_GAPS.md`](LINEAR_FEATURE_GAPS.md) | Remaining feature-parity gaps against Linear                                 |

## Point-in-time documents

Written against the state of the code on a given date and **not** kept current.
Useful as rationale and as a record of what was considered; do not trust their
counts, file references, or status markers without checking against the code.

| Document                                            | Written                        |
| --------------------------------------------------- | ------------------------------ |
| [`UI_UX_ASSESSMENT.md`](UI_UX_ASSESSMENT.md)         | UI/UX audit + design-system rationale (through 2026-08-01) |
| [`CONFIG_ASSESSMENT.md`](CONFIG_ASSESSMENT.md)       | Configuration-surface audit + centralized-config proposal (2026-08-18) |
| [`E2E_TEST_GAP_ANALYSIS.md`](E2E_TEST_GAP_ANALYSIS.md) | E2E coverage analysis (2026-05-10) |
| [`LINEAR_RESEARCH.md`](LINEAR_RESEARCH.md)           | Competitive research (April 2026) |
| [`LINEAR_RESEARCH_2.md`](LINEAR_RESEARCH_2.md)       | Competitive research, round 2   |
| [`sprints/`](sprints/)                               | Build-time specs for Sprints 1–14 — frozen, see [`sprints/README.md`](sprints/README.md) |

## Where the conventions actually live

Agent-facing guidance is split by how often it is needed:

- [`../AGENTS.md`](../AGENTS.md) (symlinked as `CLAUDE.md`) — loaded into every
  session. Commands, architecture, and the invariants that apply everywhere.
- [`../.claude/rules/`](../.claude/rules/) — path-scoped rules that load only
  when the matching files are touched: frontend/design-system, server/database,
  and testing.
- [`../.claude/skills/`](../.claude/skills/) — procedures that load only when
  invoked or judged relevant. Currently `verify-schema`, the real-Postgres check
  for a migration change.
- [`../.claude/hooks/`](../.claude/hooks/) — shell commands run at fixed
  lifecycle events, independent of what the agent decides. `session-start.sh`
  installs dependencies so the CI gates are runnable in a fresh remote container.
- `PATTERNS.md` — the long-form reference behind all of it.

Keep `AGENTS.md` short. It is loaded in full every session, and length there is
paid on every turn.

The reason conventions are *not* enforced by hooks here is that this repo already
enforces them better, with tests that fail: `lint:tokens` at a literal-zero
baseline plus `contrast.test.ts`, `accent.test.ts`, `state-type-spelling.test.ts`,
`graphql-documents.test.ts`, `db-collections.test.ts` and `schema.test.ts`. A
guard test protects humans and CI too, not just the agent. Prefer adding one of
those over adding a hook.
