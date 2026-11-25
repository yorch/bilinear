/**
 * Real-Postgres tests for duplicate suggestions. The mocked-`$queryRaw` tests in
 * `duplicate-suggestion.service.test.ts` can only assert on SQL text; these run
 * the actual statement, so FTS configuration, accent handling, stop words and
 * the canceled/triage filters are verified semantically.
 *
 * Opt in with a migrated scratch database:
 *   DUPLICATE_SUGGESTION_TEST_DB=postgresql://user:pass@localhost/scratch \
 *     yarn vitest run src/server/services/duplicate-suggestion.db.test.ts
 * Skipped (not failed) when the variable is unset. Rows live under a throwaway
 * organization that is deleted afterwards.
 */

import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma';
import { DuplicateSuggestionService, FtsDuplicateScorer } from './duplicate-suggestion.service';

const DB_URL = process.env.DUPLICATE_SUGGESTION_TEST_DB;

describe.skipIf(!DB_URL)('duplicate suggestions against real Postgres', () => {
  let prisma: PrismaClient;
  let service: DuplicateSuggestionService;
  let orgId: string;
  let teamId: string;
  let triageId: string;
  let backlogId: string;
  let canceledId: string;
  let n = 0;

  const scope = () => ({ guestTeamIds: [], memberTeamIds: [teamId], userId: randomUUID() });

  async function issue(title: string, stateId = backlogId, description: string | null = null) {
    n += 1;
    return prisma.issue.create({
      data: {
        description,
        identifier: `DUP-${n}`,
        number: n,
        organizationId: orgId,
        stateId,
        teamId,
        title,
      },
    });
  }

  async function suggestFor(title: string) {
    const source = await issue(title, triageId);
    const out = await service.suggest(orgId, source.id, scope(), 5);
    return { out, source };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL as string }) });
    service = new DuplicateSuggestionService(prisma);
    const suffix = randomUUID().slice(0, 8);
    const org = await prisma.organization.create({
      data: { name: `dup-${suffix}`, urlKey: `dup-${suffix}` },
    });
    orgId = org.id;
    const team = await prisma.team.create({
      data: { displayName: 'Dup', key: 'DUP', name: 'Dup', organizationId: orgId },
    });
    teamId = team.id;
    const mk = (name: string, type: 'backlog' | 'canceled' | 'triage') =>
      prisma.workflowState.create({ data: { color: '#000', name, teamId, type } });
    triageId = (await mk('Triage', 'triage')).id;
    backlogId = (await mk('Backlog', 'backlog')).id;
    canceledId = (await mk('Canceled', 'canceled')).id;
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.issue.deleteMany({ where: { organizationId: orgId } });
      await prisma.workflowState.deleteMany({ where: { teamId } });
      await prisma.team.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma?.$disconnect();
  });

  it('matches Spanish titles with accents and reports whole words', async () => {
    const target = await issue('No se puede iniciar sesión en Safari');
    const { out } = await suggestFor('Error al iniciar sesión');
    const hit = out.find(r => r.issue.id === target.id);
    expect(hit?.matchedTerms).toEqual(expect.arrayContaining(['iniciar', 'sesión']));
    for (const term of hit?.matchedTerms ?? []) {
      expect(term).not.toBe('sesi');
    }
  });

  it('matches German (ß, umlauts) and French (accents) titles', async () => {
    const de = await issue('Schaltfläche Größe ändern funktioniert nicht');
    const fr = await issue("Échec de l'exportation des données");
    const deHit = (await suggestFor('Größe der Schaltfläche ist falsch')).out;
    expect(deHit.map(r => r.issue.id)).toContain(de.id);
    const frHit = (await suggestFor('Problème exportation données échec')).out;
    expect(frHit.map(r => r.issue.id)).toContain(fr.id);
  });

  it('matches a non-space-separated title only on an identical run (documented limit)', async () => {
    const cn = await issue('导出失败');
    const same = (await suggestFor('导出失败')).out;
    expect(same.map(r => r.issue.id)).toContain(cn.id);
  });

  it('ignores stop words when setting the match threshold', async () => {
    const target = await issue('Broken checkout totals');
    const { out } = await suggestFor('Broken for you');
    expect(out.map(r => r.issue.id)).toContain(target.id);
  });

  it('keeps two-letter acronyms such as CI', async () => {
    // Without "ci" the source has 3 terms and the target shares only "runner".
    const target = await issue('CI runner crashes nightly');
    const { out } = await suggestFor('CI runner flaky tests');
    expect(out.map(r => r.issue.id)).toContain(target.id);
  });

  it('needs two shared terms once a title has three usable terms', async () => {
    const lone = await issue('Rendering regression somewhere');
    const { out } = await suggestFor('Rendering banana turnip');
    expect(out.map(r => r.issue.id)).not.toContain(lone.id);
  });

  it('never offers a declined issue; follows a duplicate to its canonical issue', async () => {
    const declined = await issue('Gizmo widget explosion', canceledId);
    const canonical = await issue('Gizmo widget explosion canonical', backlogId);
    const dup = await issue('Gizmo widget explosion again', canceledId);
    await prisma.issueRelation.create({
      data: { issueId: dup.id, relatedIssueId: canonical.id, type: 'duplicate' },
    });
    const { out, source } = await suggestFor('Gizmo widget explosion');
    // The SQL itself must already exclude the declined row (the service's
    // hydration filter is only the second line of defence).
    const raw = await new FtsDuplicateScorer(prisma).score({
      limit: 5,
      orgId,
      scope: scope(),
      source,
    });
    expect(raw.map(r => r.issueId)).not.toContain(declined.id);
    expect(raw.map(r => r.issueId)).toContain(dup.id);
    const ids = out.map(r => r.issue.id);
    expect(ids).not.toContain(declined.id);
    expect(ids).not.toContain(dup.id);
    expect(ids.filter(id => id === canonical.id)).toHaveLength(1);
  });

  it('offers triage peers (not the source itself) flagged as in triage', async () => {
    const peer = await issue('Customer reports broken login on Safari', triageId);
    const source = await issue('Customer reports broken login on Safari 17 private mode', triageId);
    const out = await service.suggest(orgId, source.id, scope(), 5);
    const hit = out.find(r => r.issue.id === peer.id);
    expect(hit?.inTriage).toBe(true);
    expect(out.map(r => r.issue.id)).not.toContain(source.id);
  });

  it('is invariant to tsquery syntax in the title', async () => {
    const { out } = await suggestFor("x' & | ! ( ) :* <-> crash");
    expect(Array.isArray(out)).toBe(true);
  });
});
