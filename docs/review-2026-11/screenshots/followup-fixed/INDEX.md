# Follow-up re-capture after fixes (2026-11-25)

Production build on :3000, DB `bilinear_shots`, demo@example.com. Variants: `-desktop-light`, `-desktop-dark` (1280x800 @2x), `-mobile-light` (390x844 @2x). Same slugs as `../followup/`, plus `bulk-bar-more-menu` and `settings-nav-es`.
Console errors: none on any capture (all errs=0, no horizontal page overflow).

## Files and verdicts

| Original defect | Files | What it shows | Verdict |
| --- | --- | --- | --- |
| W1 Webhooks mobile | webhooks-delivery-enotfound-en-mobile-light, -es-mobile-light | Card header stacks: name + badge, full URL wrapped, event chips, secret row, action buttons wrap in their own row inside the card (nothing clipped); deliveries render as cards (status chip, time, event, attempts, wrapped error) | Fixed |
| W2 Deliveries table | webhooks-delivery-enotfound-es-desktop-light, -en-desktop-light/dark | Desktop table with Estado/Evento/Intentos/Error/Hora; Time column fully visible ("25 nov, 09:01"), error wraps on two lines | Fixed. Minor: the card-header URL is ellipsised on desktop next to the action buttons (full URL shows on mobile) |
| W3 Untranslated status | webhooks-delivery-enotfound-es-* | Status chip reads "Pendiente" (es); header "Entregas recientes" | Fixed for the status seen (pending). Seeded data only has pending deliveries, so a localised "failed" chip was not captured |
| N1 es settings nav | settings-nav-es-desktop-light | Nav item reads "Espacio de trabajo", not truncated (DOM check: no scrollWidth overflow) | Fixed |
| R1 Reminder panel | reminder-panel-initial/scrolled/date-picked-* | Desktop: full Calendar (all 6 weeks) visible, Time field and "Set reminder" in a footer below it, no inner scroll needed. Mobile: bottom sheet spanning full width with presets, full Calendar, and Time + "Set reminder" pinned at the bottom | Fixed |
| B1 Bulk bar desktop | bulk-bar-desktop-light/dark, bulk-bar-more-menu-desktop-* | Single row: Status Priority Assignee Label Due date More / Archive Delete / close. More menu: Project, Move to team | Fixed |
| B1 Bulk bar mobile | bulk-bar-mobile-light, bulk-bar-more-menu-mobile-light | Two rows: count + Select all + close; Status Priority Assignee More, icon-only Archive/Delete. More menu lists Label, Due date, Project, Move to team | Fixed (2 rows instead of 3) |
| B1 Due date popover (mobile) | bulk-due-date-popover-mobile-light, -desktop-* | Popover opens above the bar and the bar stays fully visible and usable. It still overlays the lower selected rows, and its Calendar is cut to about 1.5 rows (scrolls inside). | Partly fixed. The bar is no longer covered, but the popover still covers rows and shows only the first calendar row without scrolling |
| T2 Copy | bulk-move-dropped-labels-toast-* | "Moved. Label removed from 2 issues because it doesn't exist in the new team: frontend-regression" (no "(s)"). Single: "Label removed because it doesn't exist..." | Fixed |
| T1 Toast theme/contrast | move-team-dropped-labels-toast-*, bulk-move-... -desktop-dark/-mobile-light | Dark: dark navy panel with light blue text and icon, matches the theme. Light/mobile: dark-blue text on pale blue, readable | Fixed. Small nit: on mobile light the toast background looks slightly translucent, so list rows ghost through behind the text (see bulk-move-dropped-labels-toast-mobile-light) |
| A1 Audit log mobile | audit-log-list-mobile-light, audit-log-list-scrolled-mobile-light, -desktop-* | Subtitle wraps fully ("...Only admins can view this log."). Table has a right-edge fade cue; Resource column is still cut at the fade and needs horizontal scroll | Fixed (cue present; horizontal scroll itself remains by design) |

## Hydration (React #418) on mobile
Context 390x844 mobile, `localStorage['sidebar-collapsed']='true'` set before load, production build (minified React errors would show as #418). Visited in one session with 4s waits:
- /demo/inbox, /demo/projects, /demo/initiatives: no console errors, no page errors
- /demo/inbox, /demo/project/public-api-v2, /demo/initiatives: no console errors, no page errors
- Same run without the collapsed key (desktop and mobile contexts): no errors
Verdict: no #418 seen, fixed. (The earlier defect appeared after reload/navigation; a full hard reload variant was not separately re-run for each page.)

## Still present / caveats
- Bulk Due date popover on mobile still overlays selected rows and clips its calendar (above).
- Desktop webhook card URL truncated with ellipsis (minor).
- Not re-run: IP tooltip (native title), inbox, triage, favourites, insights (not in scope).
