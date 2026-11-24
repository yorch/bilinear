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
        orderBy: { createdAt: 'desc' },
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

    it('adds a strict `lt` bound for the cursor and combines it with range bounds', async () => {
      prisma.auditLogEntry.findMany.mockResolvedValue([]);

      await service.findByOrg({
        cursor: '2026-02-15T00:00:00Z',
        from: '2026-01-01T00:00:00Z',
        orgId: TEST_ORG.id,
      });

      const where = prisma.auditLogEntry.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00Z'),
        lt: new Date('2026-02-15T00:00:00Z'),
      });
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
      expect(result.nextCursor).toBe('2026-03-02T00:00:00.000Z');
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

      expect(result.nextCursor).toBe('2026-05-01T08:30:00.000Z');
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

    it('pages through batches and follows nextCursor', async () => {
      const full = Array.from({ length: 201 }, (_, i) =>
        makeEntry({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1000 - i)), id: `e${i}` }),
      );
      prisma.auditLogEntry.findMany
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([makeEntry({ id: 'last' })]);
      prisma.user.findMany.mockResolvedValue([]);

      const out = await service.exportCsv({ orgId: TEST_ORG.id });

      expect(out.rows).toBe(201);
      expect(prisma.auditLogEntry.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.auditLogEntry.findMany.mock.calls[1][0].where.createdAt.lt).toEqual(
        full[199].createdAt,
      );
    });
  });
});
