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
import {
  DuplicateSuggestionService,
  FtsDuplicateScorer,
  TrigramDuplicateScorer,
} from './duplicate-suggestion.service';

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

  it('matches an identical non-space-separated title', async () => {
    const cn = await issue('导出失败');
    const same = (await suggestFor('导出失败')).out;
    expect(same.map(r => r.issue.id)).toContain(cn.id);
  });

  // FTS sees each of these as one opaque token, so only trigram similarity can
  // connect a reworded title to its neighbour.
  it.each([
    ['Japanese', 'ログイン画面でエラーが発生する', 'ログイン画面がエラーになる'],
    ['Chinese', '导出报表时系统崩溃', '导出报表的时候崩溃'],
    ['Thai', 'ไม่สามารถเข้าสู่ระบบได้', 'เข้าสู่ระบบไม่ได้'],
  ])('finds a reworded %s title via the trigram fallback', async (_name, existing, query) => {
    const target = await issue(existing);
    const unrelated = await issue('完全に無関係なタイトルです');
    const { out, source } = await suggestFor(query);
    const ids = out.map(r => r.issue.id);
    expect(ids).toContain(target.id);
    expect(ids).not.toContain(unrelated.id);
    expect(ids).not.toContain(source.id);
  });

  // The 0.22 floor exists for short rewordings like this (similarity 0.25),
  // which the old 0.3 floor dropped; unrelated short titles must stay out.
  it('finds a short CJK rewording but not unrelated short titles', async () => {
    const target = await issue('导出失败');
    const unrelated = await issue('用户头像上传');
    const { out } = await suggestFor('导出成功');
    const ids = out.map(r => r.issue.id);
    expect(ids).toContain(target.id);
    expect(ids).not.toContain(unrelated.id);
  });

  // Titles here are unique to this test so earlier rows cannot crowd a negative
  // out of the top-5; the negatives score 0.10-0.19, i.e. below the 0.22 floor
  // but above a careless 0.05, so loosening the floor turns this red.
  it.each([
    [
      'Japanese',
      'カレンダーが今日にスクロールできない',
      'カレンダーを今日にスクロールできません',
      ['カレンダーの表示が重い', '設定画面にスクロールバーがない'],
    ],
    [
      'Chinese',
      '日历视图无法滚动到今天',
      '日历视图不能滚动到今天',
      ['导出视图无法保存', '用户头像上传失败'],
    ],
    [
      'Thai',
      'ปฏิทินเลื่อนไปวันนี้ไม่ได้',
      'ปฏิทินไม่สามารถเลื่อนไปวันนี้ได้',
      ['ปฏิทินแสดงสีผิดพลาด', 'ทดสอบการแสดงผลหน้าจอมือถือ'],
    ],
  ])(
    'keeps precision for %s: finds the rewording, not weakly similar titles',
    async (_n, existing, query, negatives) => {
      const target = await issue(existing);
      const ids: string[] = [];
      for (const title of negatives) {
        ids.push((await issue(title)).id);
      }
      const { out } = await suggestFor(query);
      const got = out.map(r => r.issue.id);
      expect(got).toContain(target.id);
      for (const id of ids) {
        expect(got).not.toContain(id);
      }
    },
  );

  // One CJK character used to route the whole title to trigram-first, and any
  // trigram hit then hid every FTS word match.
  it('merges FTS and trigram results for a mixed-script title', async () => {
    const ftsOnly = await issue(
      'Safari users see a blank screen after every single export attempt in the dashboard',
    );
    const trigramOnly = await issue('Export 失败 on Safari today');
    const { out } = await suggestFor('Export 失败 on Safari');
    const ids = out.map(r => r.issue.id);
    expect(ids).toContain(ftsOnly.id);
    expect(ids).toContain(trigramOnly.id);
  });

  it('does not offer a same-prefix Latin title through the typo fallback', async () => {
    const other = await issue('Checkout page loads slowly');
    const { out } = await suggestFor('Checkout totals incorrect');
    expect(out.map(r => r.issue.id)).not.toContain(other.id);
  });

  it('skips the typo fallback for long Latin titles', async () => {
    const target = await issue(
      'Checkout totals incorrect when paying with saved card on the second try today',
    );
    const long = 'Chekout totalz incorect wehn payng wth savd cardd on teh secnd tryy todya';
    const { out, source } = await suggestFor(long);
    expect(out.map(r => r.issue.id)).not.toContain(target.id);
    // Keep these typos out of the later fallback test's FTS matches.
    await prisma.issue.deleteMany({ where: { id: { in: [source.id, target.id] } } });
  });

  it('applies scoping and exclusions to trigram matches', async () => {
    const archived = await issue('搜索结果为空时崩溃');
    await prisma.issue.update({ data: { archivedAt: new Date() }, where: { id: archived.id } });
    const declined = await issue('搜索结果为空时崩溃了', canceledId);
    const otherTeam = await prisma.team.create({
      data: { displayName: 'Hidden', key: 'HID', name: 'Hidden', organizationId: orgId },
    });
    const hiddenState = await prisma.workflowState.create({
      data: { color: '#000', name: 'Backlog', teamId: otherTeam.id, type: 'backlog' },
    });
    n += 1;
    const hidden = await prisma.issue.create({
      data: {
        identifier: `HID-${n}`,
        number: n,
        organizationId: orgId,
        stateId: hiddenState.id,
        teamId: otherTeam.id,
        title: '搜索结果为空时崩溃',
      },
    });
    const visible = await issue('搜索结果为空时崩溃');
    try {
      const { out, source } = await suggestFor('搜索结果为空时崩溃');
      // The scorer's own SQL must exclude them; hydration is only the second line.
      const raw = await new TrigramDuplicateScorer(prisma).score({
        limit: 5,
        orgId,
        scope: scope(),
        source,
      });
      const rawIds = raw.map(r => r.issueId);
      expect(rawIds).toContain(visible.id);
      expect(rawIds).not.toContain(archived.id);
      expect(rawIds).not.toContain(declined.id);
      expect(rawIds).not.toContain(hidden.id);
      const ids = out.map(r => r.issue.id);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(archived.id);
      expect(ids).not.toContain(declined.id);
      expect(ids).not.toContain(hidden.id);
    } finally {
      await prisma.issue.delete({ where: { id: hidden.id } });
      await prisma.workflowState.delete({ where: { id: hiddenState.id } });
      await prisma.team.delete({ where: { id: otherTeam.id } });
    }
  });

  it('falls back to trigram for a misspelt Latin title FTS cannot match', async () => {
    const target = await issue('Checkout totals incorrect');
    const { out } = await suggestFor('Chekout totalz incorect');
    expect(out.map(r => r.issue.id)).toContain(target.id);
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
