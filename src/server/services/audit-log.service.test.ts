import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { type AuditLogFilter, AuditLogService } from './audit-log.service';

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    action: 'auth.login',
    createdAt: new Date('2026-03-01T00:00:00Z'),
    id: '00000000-0000-0000-0000-000000000700',
    ipAddress: null,
    metadata: null,
    organizationId: TEST_ORG.id,
    resourceId: null,
    resourceType: null,
    userAgent: null,
    userId: TEST_USER.id,
    ...overrides,
  };
}

describe('AuditLogService', () => {
  let prisma: MockPrismaClient;
  let service: AuditLogService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AuditLogService(prisma as never);
  });

  describe('log', () => {
    it('writes an entry mapping orgId → organizationId and defaulting optionals to null', async () => {
      prisma.auditLogEntry.create.mockResolvedValue(makeEntry());

      await service.log({ action: 'auth.login', orgId: TEST_ORG.id, userId: TEST_USER.id });

      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: {
          action: 'auth.login',
          ipAddress: null,
          metadata: Prisma.JsonNull,
          organizationId: TEST_ORG.id,
          resourceId: null,
          resourceType: null,
          userAgent: null,
          userId: TEST_USER.id,
        },
      });
    });

    it('passes metadata through as an InputJsonValue when provided', async () => {
      prisma.auditLogEntry.create.mockResolvedValue(makeEntry());

      await service.log({
        action: 'member.role_changed',
        ipAddress: '10.0.0.1',
        metadata: { from: 'member', to: 'admin' },
        orgId: TEST_ORG.id,
        resourceId: 'res-1',
        resourceType: 'OrganizationMember',
        userAgent: 'jest',
        userId: TEST_USER.id,
      });

      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: {
          action: 'member.role_changed',
          ipAddress: '10.0.0.1',
          metadata: { from: 'member', to: 'admin' },
          organizationId: TEST_ORG.id,
          resourceId: 'res-1',
          resourceType: 'OrganizationMember',
          userAgent: 'jest',
          userId: TEST_USER.id,
        },
      });
    });

    it('swallows db errors so audit logging never breaks the caller', async () => {
      prisma.auditLogEntry.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.log({ action: 'auth.login', orgId: TEST_ORG.id }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findByOrg', () => {
    it('scopes by org, orders by createdAt desc, and fetches limit + 1 rows', async () => {
      const rows = [makeEntry()];
      prisma.auditLogEntry.findMany.mockResolvedValue(rows);

      const result = await service.findByOrg({ orgId: TEST_ORG.id });

      expect(result).toEqual({ entries: rows, hasMore: false, nextCursor: null });
      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
        where: { organizationId: TEST_ORG.id },
      });
    });

    it('applies actor / action / resourceType filters to the where clause', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.findByOrg({
        action: 'issue.created',
        orgId: TEST_ORG.id,
        resourceType: 'Issue',
        userId: TEST_USER.id,
      });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            action: 'issue.created',
            organizationId: TEST_ORG.id,
            resourceType: 'Issue',
            userId: TEST_USER.id,
          },
        }),
      );
    });

    it('builds a createdAt range from `from` and `to`', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.findByOrg({
        from: '2026-01-01T00:00:00Z',
        orgId: TEST_ORG.id,
        to: '2026-02-01T00:00:00Z',
      });

      const where = prisma.auditLogEntry.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00Z'),
        lte: new Date('2026-02-01T00:00:00Z'),
      });
    });

    it('applies the (createdAt, id) keyset after the cursor and keeps the range bounds', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);
      const id = '00000000-0000-0000-0000-000000000abc';

      await service.findByOrg({
        cursor: `2026-02-15T00:00:00.000Z|${id}`,
        from: '2026-01-01T00:00:00Z',
        orgId: TEST_ORG.id,
      });

      const where = prisma.auditLogEntry.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({ gte: new Date('2026-01-01T00:00:00Z') });
      const at = new Date('2026-02-15T00:00:00Z');
      expect(where.AND).toEqual([
        { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] },
      ]);
    });

    it('rejects malformed cursors instead of passing them to Postgres', async () => {
      for (const cursor of [
        '2026-01-01T00:00:00Z|notauuid',
        'garbage',
        '2026-02-15T00:00:00.000Z',
        'not-a-date|00000000-0000-0000-0000-000000000abc',
        '2026-02-15T00:00:00.000Z|',
      ]) {
        await expect(
          service.findByOrg({ cursor, orgId: TEST_ORG.id }),
          cursor,
        ).rejects.toMatchObject({ name: 'InvalidCursorError' });
      }
      expect(prisma.auditLogEntry.findMany).not.toHaveBeenCalled();
    });

    it('caps the limit at MAX_LIMIT (200 → take 201)', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.findByOrg({ limit: 5000, orgId: TEST_ORG.id });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 201 }),
      );
    });

    it('honors a custom limit below the cap', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.findByOrg({ limit: 10, orgId: TEST_ORG.id });

      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 11 }),
      );
    });

    it('trims the extra row and exposes a nextCursor when more rows exist', async () => {
      const first = makeEntry({
        createdAt: new Date('2026-03-03T00:00:00Z'),
        id: '00000000-0000-0000-0000-000000000701',
      });
      const second = makeEntry({
        createdAt: new Date('2026-03-02T00:00:00Z'),
        id: '00000000-0000-0000-0000-000000000702',
      });
      const extra = makeEntry({
        createdAt: new Date('2026-03-01T00:00:00Z'),
        id: '00000000-0000-0000-0000-000000000703',
      });
      prisma.auditLogEntry.findMany.mockResolvedValue([first, second, extra]);

      const result = await service.findByOrg({ limit: 2, orgId: TEST_ORG.id });

      expect(result.entries).toEqual([first, second]);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(
        '2026-03-02T00:00:00.000Z|00000000-0000-0000-0000-000000000702',
      );
    });

    it('returns hasMore false and a null cursor on the last page', async () => {
      const rows = [makeEntry(), makeEntry({ id: '00000000-0000-0000-0000-000000000704' })];
      prisma.auditLogEntry.findMany.mockResolvedValue(rows);

      const result = await service.findByOrg({ limit: 2, orgId: TEST_ORG.id });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.entries).toEqual(rows);
    });

    it('omits the createdAt clause entirely when no temporal filter is given', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      const filter: AuditLogFilter = { orgId: TEST_ORG.id };
      await service.findByOrg(filter);

      const where = prisma.auditLogEntry.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toBeUndefined();
    });
  });

  describe('findByOrg with pinned clock', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('derives the cursor from the actual last entry, independent of wall-clock time', async () => {
      const only = makeEntry({ createdAt: new Date('2026-05-01T08:30:00Z') });
      const extra = makeEntry({
        createdAt: new Date('2026-04-30T08:30:00Z'),
        id: '00000000-0000-0000-0000-000000000705',
      });
      prisma.auditLogEntry.findMany.mockResolvedValue([only, extra]);

      const result = await service.findByOrg({ limit: 1, orgId: TEST_ORG.id });

      expect(result.nextCursor).toBe(`2026-05-01T08:30:00.000Z|${only.id}`);
    });
  });
  describe('exportCsv', () => {
    it('exports the filtered set with a header, user emails and ISO timestamps', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([
        makeEntry({ action: 'team.created', metadata: { name: 'Eng' }, resourceType: 'Team' }),
      ]);
      prisma.user.findMany.mockResolvedValue([{ email: 'a@x.test', id: TEST_USER.id }]);

      const out = await service.exportCsv({
        action: 'team.created',
        from: '2026-01-01T00:00:00Z',
        orgId: TEST_ORG.id,
      });

      const lines = out.csv.replace('\uFEFF', '').split('\r\n');
      expect(lines[0]).toBe(
        'timestamp,action,user_id,user_email,resource_type,resource_id,ip_address,metadata',
      );
      expect(lines[1]).toContain('2026-03-01T00:00:00.000Z,team.created');
      expect(lines[1]).toContain('a@x.test');
      expect(out).toMatchObject({ rows: 1, truncated: false });
      // The filter is applied in the query, not after the fact.
      const where = prisma.auditLogEntry.findMany.mock.calls[0][0].where;
      expect(where.action).toBe('team.created');
      expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
    });

    it('neutralises spreadsheet formulas in free-text cells', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([
        makeEntry({ resourceId: '=HYPERLINK("http://evil")', userId: null }),
      ]);

      const out = await service.exportCsv({ orgId: TEST_ORG.id });

      expect(out.csv).toContain("'=HYPERLINK");
      expect(out.csv).not.toMatch(/,=HYPERLINK/);
    });

    describe('against an in-memory table with duplicate timestamps', () => {
      // Emulates findMany over (createdAt desc, id desc) with the keyset `where`
      // the service sends, so a page boundary that splits a run of identical
      // timestamps is exercised for real.
      const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
      function seed(count: number, perTimestamp: number) {
        return Array.from({ length: count }, (_, i) =>
          makeEntry({
            createdAt: new Date(
              Date.UTC(2026, 0, 1, 0, 0, 0) - Math.floor(i / perTimestamp) * 1000,
            ),
            id: uuid(i + 1),
            resourceId: uuid(i + 1),
          }),
        );
      }
      function install(table: ReturnType<typeof seed>) {
        prisma.auditLogEntry.findMany.mockImplementation(
          async ({ take, where }: { take: number; where: { AND?: Array<{ OR: unknown[] }> } }) => {
            const sorted = [...table].sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime() ||
                (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
            );
            const or = where.AND?.[0]?.OR as
              | [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }]
              | undefined;
            const rows = or
              ? sorted.filter(
                  r =>
                    r.createdAt < or[0].createdAt.lt ||
                    (r.createdAt.getTime() === or[1].createdAt.getTime() && r.id < or[1].id.lt),
                )
              : sorted;
            return rows.slice(0, take);
          },
        );
        prisma.user.findMany.mockResolvedValue([]);
      }

      it('exports every row when 200-row batch boundaries fall inside a timestamp run', async () => {
        // 5 rows share each timestamp; 200 % 5 == 0 so also test an offset size below
        const table = seed(437, 7); // 7 does not divide 200: boundaries split runs
        install(table);
        const out = await service.exportCsv({ orgId: TEST_ORG.id });
        const ids = out.csv
          .split('\r\n')
          .slice(1)
          .map(l => l.split(',')[5] ?? '');
        expect(out.rows).toBe(437);
        expect(ids).toHaveLength(437);
        expect(new Set(ids).size).toBe(437);
        expect(out.truncated).toBe(false);
      });

      it('pages findByOrg without skipping or repeating tied rows', async () => {
        const table = seed(23, 6);
        install(table);
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page: Awaited<ReturnType<typeof service.findByOrg>> = await service.findByOrg({
            cursor,
            limit: 5,
            orgId: TEST_ORG.id,
          });
          seen.push(...page.entries.map(e => e.id));
          cursor = page.nextCursor;
        } while (cursor);
        expect(seen).toHaveLength(23);
        expect(new Set(seen).size).toBe(23);
      });

      it('caps the export at exportMaxRows and flags truncated', async () => {
        install(seed(500, 3));
        const capped = new AuditLogService(prisma as never, 250);
        const out = await capped.exportCsv({ orgId: TEST_ORG.id });
        expect(out.rows).toBe(250);
        expect(out.truncated).toBe(true);
        expect(out.csv.split('\r\n')).toHaveLength(251);
      });

      it('does not flag truncated when the table fits exactly within the cap', async () => {
        install(seed(250, 3));
        const capped = new AuditLogService(prisma as never, 250);
        const out = await capped.exportCsv({ orgId: TEST_ORG.id });
        expect(out).toMatchObject({ rows: 250, truncated: false });
      });
    });
  });
});
