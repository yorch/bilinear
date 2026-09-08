/**
 * Dev-only UX review helper: logs in as the seeded demo user and screenshots
 * every route into /tmp/ux-shots. Not part of any gate.
 *
 *   node scripts/ux-shots.mjs [--mobile] [--dark] [--only=substring]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = process.env.OUT ?? '/tmp/ux-shots';
const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const dark = args.includes('--dark');
const only = args.find(a => a.startsWith('--only='))?.slice(7);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  colorScheme: dark ? 'dark' : 'light',
  viewport: mobile ? { height: 844, width: 390 } : { height: 1000, width: 1600 },
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', m => {
  if (m.type() === 'error') {
    consoleErrors.push(`${page.url()} :: ${m.text()}`);
  }
});
page.on('pageerror', e => consoleErrors.push(`${page.url()} :: PAGEERROR ${e.message}`));

// Log in through the seeded magic-link code.
await page.goto(`${BASE}/verify?email=demo%40example.com&code=123456`);
await page.waitForURL('**/team/**', { timeout: 60_000 });
await page.waitForSelector('[data-testid="issue-list-view"], [data-testid="empty-state"]', {
  timeout: 60_000,
});

const url = new URL(page.url());
const [, workspace] = url.pathname.split('/');
const teamKey = url.pathname.match(/\/team\/([^/]+)/)?.[1];
console.log(`workspace=${workspace} team=${teamKey}`);

const w = `/${workspace}`;
const t = `${w}/team/${teamKey}`;

/** Grab the first id/slug the store knows about, for the detail routes. */
const ids = await page.evaluate(async () => {
  const q = async query => {
    const r = await fetch('/api/graphql', {
      body: JSON.stringify({ query }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const j = await r.json();
    if (j.errors) {
      console.error(JSON.stringify(j.errors));
    }
    return j.data;
  };
  const teams = await q('{ teams { id key } }');
  const teamId = teams?.teams?.[0]?.id;
  return await q(`{
    issues(first: 1, filter: { teamId: "${teamId}" }) { nodes { id } }
    projects(first: 1) { nodes { id slugId } }
    documents { id }
    cycles(teamId: "${teamId}") { id }
  }`);
});
console.log('ids', JSON.stringify(ids));

const issueId = ids?.issues?.nodes?.[0]?.id;
const projectSlug = ids?.projects?.nodes?.[0]?.slugId;
const docId = ids?.documents?.[0]?.id;
const cycleId = ids?.cycles?.[0]?.id;

const routes = [
  ['workspace-root', w],
  ['team-issues', t],
  ['team-backlog', `${t}/backlog`],
  ['team-cycles', `${t}/cycles`],
  cycleId && ['cycle-detail', `${t}/cycles/${cycleId}`],
  ['team-triage', `${t}/triage`],
  ['team-docs', `${t}/docs`],
  ['team-analytics', `${t}/analytics`],
  ['team-settings', `${t}/settings`],
  ['my-issues', `${w}/my-issues`],
  ['inbox', `${w}/inbox`],
  ['projects', `${w}/projects`],
  projectSlug && ['project-detail', `${w}/project/${projectSlug}`],
  ['initiatives', `${w}/initiatives`],
  ['analytics', `${w}/analytics`],
  issueId && ['issue-detail', `${w}/issue/${issueId}`],
  docId && ['doc-detail', `${w}/docs/${docId}`],
  ['settings', `${w}/settings`],
  ['settings-security', `${w}/settings/security`],
  ['settings-integrations', `${w}/settings/integrations`],
  ['settings-webhooks', `${w}/settings/webhooks`],
  ['settings-automations', `${w}/settings/automations`],
  ['settings-import', `${w}/settings/import`],
  ['settings-roadmap', `${w}/settings/roadmap`],
  ['settings-audit-log', `${w}/settings/audit-log`],
  ['admin', '/admin'],
  ['admin-tenants', '/admin/tenants'],
  ['admin-users', '/admin/users'],
  ['admin-config', '/admin/config'],
  ['admin-audit', '/admin/audit'],
  ['design', '/design'],
].filter(Boolean);

const suffix = `${mobile ? '-mobile' : ''}${dark ? '-dark' : ''}`;

for (const [name, path] of routes) {
  if (only && !name.includes(only)) {
    continue;
  }
  try {
    // First visit in dev pays a Turbopack compile; domcontentloaded + a long
    // budget beats networkidle, which never settles on the WS-connected pages.
    await page.goto(`${BASE}${path}`, { timeout: 150_000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 30_000 });
  } catch {
    /* keep the shot anyway — a stuck route is itself a finding */
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ fullPage: false, path: `${OUT}/${name}${suffix}.png` });
  console.log(`${name} -> ${path}`);
}

writeFileSync(`${OUT}/console-errors${suffix}.txt`, consoleErrors.join('\n'));
console.log(`\n${consoleErrors.length} console errors`);
await browser.close();
