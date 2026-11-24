# Platform review — 2026-11-24 (final)

Two rounds: the first review (PR #166) fixed 22 findings; this round closed the rest of
`FINDINGS-issues.md` / `FINDINGS-platform.md`, the half-finished work, and the P1/P2 backlog. Each
stream was written by a Sonnet engineer and attacked by an adversarial Opus reviewer, followed by two
cross-cutting sweeps (security; sync/authz), an integration gate, and a visual-QA pass over a
production build.

- [`FINDINGS-issues.md`](FINDINGS-issues.md), [`FINDINGS-platform.md`](FINDINGS-platform.md), [`RESEARCH.md`](RESEARCH.md) — original findings and research
- [`DEFECTS-verified.md`](DEFECTS-verified.md) — defects found by the visual-QA reviewer on the final build (all in-scope items fixed)
- [`screenshots/final/`](screenshots/final/) — 156 production-build captures (52 screens × desktop light/dark + mobile light); [`INDEX.md`](screenshots/final/INDEX.md) lists route, console errors and mobile overflow per capture (0 console errors, no mobile horizontal overflow)
- `screenshots/before|after|features/` — round-one evidence
- The full rationale, traps and known limits are in the top entry of [`docs/CHANGELOG.md`](../CHANGELOG.md)

## What shipped this round

Features/UX: project/cycle/estimate filter pickers and date operators; shortcuts on the issue page;
set-parent on existing issues; bulk cycle/project/due date/move/delete; triage single-key actions with
duplicate suggestions (FTS); inbox Priority/Other lanes with snooze/unread; synced issue reminders;
profile editing; SSO entry point; Slack/GitHub "not configured" states; admin pagination; archived
views with unarchive; initiative detail editing; burn-up chart; insights explorer; custom fields;
GitHub issue import; deep-link `?next=` via a minimal `src/proxy.ts`.

Hardening: per-user sync filtering and fail-closed visibility on every sync path; advisory-lock
protected parent/cycle writes; SSRF, SAML, avatar, markdown-sanitiser, CSV-injection and webhook
body-cap fixes; guests read-only in collaborative editing.

Visual-QA fixes (this pass): inbox emptied by a full bootstrap, favourite star wrong for existing
favourites, duplicate Insights column, mobile bulk bar/triage/admin tables/cycle header, Set-parent
popover clipping, burn-up edge labels, avg-cycle formatting, shortcut-modal focus ring, status-dot
contrast, webhook error copy, audit-log resource labels.

## Verification

`yarn lint`, `yarn lint:tokens`, `yarn typecheck`, `yarn build` pass; `yarn test` 3489 passed
(19 DB-gated skipped; those pass locally with their env vars). Playwright chromium: 136 passed,
3 skipped, 0 failed (before the final visual-QA fixes). Run on Node 22 locally; CI pins Node 24.

## Known limits

- Duplicate suggestions match poorly for languages without spaces.
- Inbox lane counts show "N+" beyond the page size.
- DB-gated tests skip in CI unless their env vars are set.
- Audit-log names resolve only for teams (others show a short id); webhook error text is English only.
- Bulk bar has no list bottom padding while selecting; native date inputs are unthemed.
- Not browser-verified after the last fix round (unit/typecheck/build only).
- Cycle 2 burndown oddity in the screenshots is a seed artifact (all issues created today).
- Audit `ipAddress` is null unless `TRUST_PROXY_HEADERS` is set.
- Several WIP checkpoint commits carry a mistyped session trailer; squash-merge recommended.
