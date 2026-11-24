# Platform UX / functionality review — 2026-11-24

Scope: everything outside the core issue list/board/detail/cycles/command palette — auth,
onboarding, invites, landing redirect, projects, initiatives, roadmap (internal + public), docs,
inbox, analytics, settings, `/admin`, 404/error pages, PWA/offline, i18n.

**Limit on live verification.** The reviewer could not sign in (the seeded code was already
consumed / rate-limited), so only signed-out screens (`/login`, `/onboarding`, `/invite/*`,
`/roadmap/*`, 404) were checked in the browser (PLT-01 and PLT-04 reproduced there). Every
signed-in finding comes from reading the code, with file:line cited. Layout coverage of
signed-in screens at 390px/1280px is therefore incomplete — see the crawl screenshots in
`screenshots/` for that.

Severity: P0 broken · P1 hurts a real workflow · P2 polish/gap. Effort: S < ½ day · M 1–3 days · L > 3 days.

| ID | Sev | Screen | Finding & evidence | Fix | Eff |
|----|-----|--------|--------------------|-----|-----|
| PLT-01 | P1 | /onboarding | Cannot type a hyphen in Workspace URL (`acme-corp` → `acmecorp`): `slugify()` strips trailing `-` on every keystroke. `onboarding-form.tsx:29,53-56` | Sanitise keystrokes keeping edge hyphens; trim on blur/submit | S |
| PLT-02 | P1 | onboarding/settings | Workspace keys colliding with routes (`admin`, `login`, `roadmap`…) accepted → workspace unreachable. `organization.service.ts:9` | `RESERVED_URL_KEYS`, reject as `URL_KEY_TAKEN` | S |
| PLT-03 | P1 | Deep links | Link target lost at sign-in: `[workspace]/layout.tsx:41-43` redirects to `/login` without `next` | Pass `next=<safe path>`; same in `(admin)/layout.tsx:23` | S |
| PLT-04 | P1 | /login | Google/GitHub buttons shown when unconfigured; click shows raw untranslated server error. `login-form.tsx:125,136` | Pass provider availability from server page; hide | S |
| PLT-05 | P1 | /login | No "Continue with SSO" for configured SAML (only admin test link, `settings/security/page.tsx:685`) | SSO entry asking for workspace key | M |
| PLT-06 | P1 | Account | No way to change name/avatar; email sign-ups stuck with local part. `auth.service.ts:89,128` | `userUpdateProfile` + Profile card | M |
| PLT-07 | P1 | `/[ws]` landing | Redirects to oldest team even if private/not a member → "Team not found". `[workspace]/page.tsx:20-32` | Pick first accessible team | S |
| PLT-08 | P1 | /onboarding (2nd workspace) | No way back (only "Use another account" = logout); signed-out visitors can open it; empty "No teams" after | Back link, redirect signed-out, guided steps | M |
| PLT-09 | P1 | Projects/initiatives/docs | Archive cannot be undone; no Archived view. `schema.ts:1986,1991,1999,2070` | `*Unarchive` + undo toast + Archived filter | M |
| PLT-10 | P1 | /initiatives | Only creatable by name; no edit of name/desc/owner/target/parent; status failures silent. `initiatives/page.tsx:159,385-406` | Detail editing; `gqlMutate` optimistic + rollback | M |
| PLT-11 | P1 | Settings → Integrations | Connect Slack/GitHub open raw 503 JSON when unconfigured; GitHub webhook secret in query string. `integrations/page.tsx:159`, `api/integrations/*/route.ts` | Show "not configured"; server-generated secret in signed state | M |
| PLT-12 | P1 | /roadmap/[slug] | Public roadmap stays live for suspended/archived orgs. `roadmap/[slug]/page.tsx:37-41,66-74` | `notFound()` when `suspendedAt`/`archivedAt` | S |
| PLT-13 | P1 | /admin lists | Users/tenants silently capped at 50. `admin-api.ts:121,194`, `limits.ts:10` | Pagination / "showing 50" note | M |
| PLT-14 | P1 | PWA / login copy | "100% offline capable" overstated; SW caches no shell, offline.html English-only. `sw.js:13-29` | Honest copy; localise offline.html | S |
| PLT-15 | P2 | /inbox | Snoozed unreachable; no load-more; non-issue rows unlinked; no mark-unread. `notification-inbox.tsx:176-198,235,360,366` | Snoozed tab, load more, entity links, mark unread | M |
| PLT-16 | P2 | Docs | Docs can't attach to projects or nest though schema supports it. `document-list.tsx:94,229` | Project docs section; "New sub-page" | M |
| PLT-17 | P2 | Webhooks | Not editable after creation; no test delivery. `webhooks/page.tsx:323-326` | Edit dialog; `webhookTest` | M |
| PLT-18 | P2 | /analytics | Empty-chart guard never fires (`maxCompleted` floored at 1); rows not links; no range. `analytics/page.tsx:89,166,204,229` | Fix guard, link rows, range control | S |
| PLT-19 | P2 | Settings nav | Members see all admin-only sections. `settings-nav.tsx:20-27` | Filter by role | S |
| PLT-20 | P2 | Settings → General | URL key read-only though server supports update. `settings/page.tsx:536-541` | Editable with warning | S |
| PLT-21 | P2 | /invite/[token] | Role shown as raw enum ("Te unirás como member"). `invite-accept-panel.tsx:97` | Use role-label keys | S |
| PLT-22 | P2 | Audit log | English-only action names; no date filter/export. `audit-log/page.tsx:101-104` | i18n keys; range + CSV | M |
| PLT-23 | P2 | /verify | Magic link auto-submits on every load, burning rate-limit. `verify-code-form.tsx:61-66` | Submit once; strip code from URL | S |
| PLT-24 | P2 | /login signed in | Signed-in users still see the form | Redirect to `next` or `/` | S |
| PLT-25 | P2 | Import | CSV only | GitHub Issues importer | L |
| PLT-26 | P2 | Admin → tenants | Delete confirm says "can be undone from the database"; restore exists. `en.json:72` | Reword | S |

## Top 10 to fix first (impact ÷ effort)

1. **PLT-01** — split `slugify` into `sanitizeKeyInput` (keeps edge hyphens) and `finalizeKey` (trims, 63-char cap); use finalize on blur/submit; extend `onboarding-form.test.ts`.
2. **PLT-03** — set `x-pathname` via middleware/proxy (or `headers()`), redirect to `/login?next=<encoded path>`; login/verify forms already honour `next` via `safeRelativePath`.
3. **PLT-07** — pick first team where `!private` or viewer has a membership; keep `WorkspaceNoTeams` fallback.
4. **PLT-04** — compute provider availability server-side in `login/page.tsx`; render only enabled buttons and the "or" divider.
5. **PLT-12** — include organization in `getRoadmapBySlug`; `notFound()` when suspended/archived; also in `unlock/route.ts`; add test.
6. **PLT-02** — shared `RESERVED_URL_KEYS` (`admin, api, auth, design, health, invite, login, onboarding, roadmap, verify`), checked client and server, reuse `URL_KEY_TAKEN`; tests.
7. **PLT-11** — `slackConfigured`/`githubConfigured` flags; "Not configured on this server" row; server-generated webhook secret carried in signed state.
8. **PLT-06** — `userUpdateProfile` with SyncAction + Profile card in settings.
9. **PLT-10** — optimistic status change with rollback/toast; inline editing of initiative fields.
10. **PLT-09** — `*Unarchive` mutations (with SyncAction), undo toast, Archived filter.
