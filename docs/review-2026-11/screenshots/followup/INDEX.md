# Follow-up screenshots (2026-11-25)

Captured against the production build on :3000, DB `bilinear_shots`, as demo@example.com (owner).
Variants per slug: `-desktop-light` (1280x800 @2x), `-desktop-dark`, `-mobile-light` (390x844 @2x) unless noted.
Seed data was created through the GraphQL API (second team "Operations", team-scoped labels, 25+ issues, webhooks, favourites, CJK/Latin triage issues).

## Files

| Slug | Variants | Demonstrates |
| --- | --- | --- |
| audit-log-list | d-l, d-d, m-l | Member and webhook names resolved in the Resource column ("Member E2E Member", "Webhook Deploy notifier"). IP column shows the placeholder dash. |
| audit-log-ip-tooltip | d-l only | Hover on the IP dash cell (cursor-help). **The tooltip is a native `title` attribute, which headless Chromium never paints, so the tooltip bubble is not visible.** Verified in DOM: `title="IP unavailable: configure TRUST_PROXY_HEADERS behind a trusted proxy"` plus an `sr-only` copy. |
| audit-log-date-calendar | d-l, d-d, m-l | From DateField open: typed-entry input (`YYYY-MM-DD` placeholder) above the Calendar. |
| audit-log-date-typed | d-l, d-d, m-l | Typed `2026-11-10` + Enter, field shows "Nov 10, 2026". |
| audit-log-to-date-typing | d-l, d-d, m-l | To date open with a partial typed entry (`2026-11-2`); days before the From date are dimmed/disabled. |
| bulk-bar | d-l, d-d, m-l | Bulk action bar with 3 issues selected. Desktop wraps to two rows (Archive/Delete on row 2); mobile wraps to three rows. |
| bulk-due-date-popover | d-l, d-d, m-l | Due date popover with presets and the Calendar. |
| reminder-panel-initial | d-l, d-d, m-l | "Remind me..." panel as opened (presets + Calendar) - see defect R1. |
| reminder-panel-scrolled | d-l, d-d, m-l | Same panel scrolled to the bottom: Time field and "Set reminder". |
| reminder-panel-date-picked | d-l, d-d, m-l | Future date (Nov 30) picked: time defaults to 09:00 AM. |
| reminder-panel-today-default-time | d-l, d-d, m-l | Browser clock faked to 14:07 (Playwright `setFixedTime`); picking today defaults the time to the next quarter hour, 02:15 PM. Relative times elsewhere on the page ("5h ago") are an artefact of the fake clock. With the real clock (08:4x) today correctly defaults to 09:00. |
| inbox-lane-counts / -other | d-l, d-d, m-l | Fresh browser context, single navigation, no reload. Lanes read "Priority 1 / Other 2" (non-zero on first load, verified after a 2.5s wait). Sidebar badge 3 = 1+2. |
| triage-duplicates-ja | d-l, d-d, m-l | Japanese title "パスワードリセットのメールが届かない" suggests ENG-19 (reworded). |
| triage-duplicates-zh | d-l only | Chinese title suggests the reworded ENG-24. |
| triage-duplicates-latin | d-l, d-d, m-l | "Checkout buttton unresponsive on Safari" (typo) suggests "Checkout button unresponsive in Safari". |
| webhooks-delivery-enotfound-en / -es | en: d-l, d-d, m-l; es: d-l, m-l | Delivery Error column: "Couldn't resolve host hooks.nonexistent-bilinear-host.invalid" / "No se pudo resolver el host ...". Locale switched with the `locale` cookie. |
| webhook-create-form-private-url-en / -es | en: d-l, d-d, m-l; es: d-l | Create form filled with `http://127.0.0.1/x`. |
| webhook-private-url-toast-en / -es | same | Error toast: "URL cannot point to a private or internal address. Use a publicly reachable URL." / "La URL no puede apuntar a una dirección privada o interna. Usa una URL accesible públicamente." |
| move-team-dropped-labels-toast | d-l, d-d, m-l | Single move ENG -> OPS; info toast "Moved. Label(s) removed because ... in the new team: ...". d-l moved an issue with two team labels (plural copy), others one label. |
| bulk-move-dropped-labels-toast | d-l, d-d, m-l | Bulk move of 2 issues: "Moved. Label removed from 2 issue(s) because it doesn't exist in the new team: frontend-regression". |
| favourite-project-star-after-reload | d-l, d-d, m-l | Filled star in the project header after a full reload (`aria-pressed=true`, fill is the warning colour). |
| favourite-initiative-star-after-reload | d-l, d-d, m-l | Filled star on the initiative card after reload. |
| favourite-issue-sidebar-favorites-after-reload / favourite-document-... | d-l, d-d, m-l | Issues and documents have **no star on their page** (FavoriteToggle is only used for projects, initiatives and custom views). Their favourite state after reload shows only as sidebar "Favorites" entries. |
| insights-table | d-l, d-d, m-l | Workspace Analytics > Insights: table has a single Issues column (STATUS / ISSUES). |

## Console errors

- No console errors on any desktop capture.
- `Minified React error #418` (hydration text mismatch) on **mobile only**, after navigation/reload: inbox (`inbox-lane-counts-mobile`), project and initiative favourite pages. Not seen on desktop. Likely a viewport- or time-dependent render (e.g. relative time) differing between server and client.
- Earlier API probe: `favoriteCreate` with `entityType: "ISSUE"` returned "Internal server error" instead of a GraphQL enum validation error (enum values are `Issue`, `Document`, ...). Minor, not UI.

## Defects / things that looked wrong

- **R1 Reminder panel clipped (all viewports).** The "Remind me..." menu is a fixed ~470px-high scroll area. On open it shows the presets and a cut-off Calendar; the Time field and "Set reminder" button are below the fold and need an inner scroll. On mobile the panel is narrow (right half of the screen), covers the issue title, and after scrolling the "Set reminder" button's bottom edge is clipped. See `reminder-panel-initial-*` vs `reminder-panel-scrolled-*`.
- **W1 Webhooks page broken on mobile.** Each webhook card's action buttons (Disable / Edit / Send test event / Rotate / Delete) overlay the card title and URL, run past the right edge ("Delete" is cut off) and the URL is not visible. See `webhooks-delivery-enotfound-en-mobile-light`, `webhook-private-url-toast-en-mobile-light`.
- **W2 Deliveries table clipped.** On desktop (es, and en with long host) the Time column is cut off ("25 nov, 08:"), and Error text is truncated with an ellipsis. On mobile the Error column is clipped at the table edge so the localised message is not readable without horizontal scrolling inside the table.
- **W3 Untranslated delivery status.** In `es`, status chips still read `pending` / `failed`, and event names are raw codes (the latter is probably intended).
- **N1 Settings nav truncation in es.** "Configuración del es..." (Workspace Settings) is truncated in the settings sub-nav on desktop.
- **A1 Audit log mobile.** The table scrolls horizontally inside its card with no scroll cue; Resource is already cut ("Member E2...") and IP/Timestamp are off-screen. The page subtitle is ellipsised ("Only admins can ...").
- **T1 Dark-mode info toast.** The "Moved. Label removed ..." info toast keeps a pale-blue background with blue text in dark mode (light panel on a dark page). Contrast is acceptable but it looks off-theme. In light mode on mobile the blue-on-pale-blue text is lower contrast than ideal and the toast sits over list rows.
- **T2 Copy.** Bulk toast says "2 issue(s)" (literal "(s)" even for a plural count).
- **B1 Bulk bar.** On desktop at 1280px the bar wraps to two rows with Archive/Delete orphaned on row 2. On mobile it takes three rows (~200px) and, when the Due date popover is open, the popover covers the selected rows and part of the bar.
- **I1 Inbox lane assignment (observation).** The "changed the status" notification sits in the Priority lane while the assignment/comment notifications fall in Other; may be intended, flagging for a product check.
- Not a defect: the first CJK titles I seeded showed no suggestions because their trigram similarity was 0.12 / 0.0 (below the 0.22 floor); closer rewordings (similarity 0.6) show suggestions. DB ctype is C.UTF-8, so pg_trgm works for CJK here.
- No raw i18n keys, no horizontal page overflow (`scrollWidth > innerWidth` was false for every capture).

## Could not capture

- The audit-log "IP unavailable" tooltip bubble (native `title`; headless Chromium does not render it). The cell and its DOM text are captured.
- A favourite star on issue and document pages: no such control exists on those pages (see above); project and initiative stars captured instead.
