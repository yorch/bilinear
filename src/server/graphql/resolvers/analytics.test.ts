import { describe, expect, it } from 'vitest';
import { createMockContext } from '@/test/context-mock';
import { analyticsResolvers } from './analytics';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const q = analyticsResolvers.Query;

function setup() {
  const ctx = createMockContext();
  ctx.prisma.team.findMany.mockResolvedValue([]);
  ctx.prisma.teamMemberRole.findMany.mockResolvedValue([]);
  ctx.prisma.issue.findMany.mockResolvedValue([]);
  ctx.prisma.workflowState.findMany.mockResolvedValue([]);
  ctx.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, targetDate: null });
  return ctx;
}

const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { extensions?: { code?: string } }) => e.extensions?.code,
  );

describe('analytics resolvers', () => {
  it('rejects a non-UUID projectId / viewId as BAD_USER_INPUT, not a database 500', async () => {
    const ctx = setup();
    expect(await code(q.projectBurnup({}, { projectId: 'nope' }, ctx as never))).toBe(
      'BAD_USER_INPUT',
    );
    expect(
      await code(
        q.insights({}, { measure: 'count', slice: 'status', viewId: 'nope' }, ctx as never),
      ),
    ).toBe('BAD_USER_INPUT');
    expect(ctx.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(ctx.prisma.customView.findFirst).not.toHaveBeenCalled();
  });

  it('uses the sync visibility rule: only PRIVATE teams the viewer is not in are hidden', async () => {
    const ctx = setup();
    // A public team the viewer never joined is simply not in this list.
    ctx.prisma.team.findMany.mockResolvedValue([
      { id: 'priv-hr', memberships: [], organizationId: ctx.orgId },
      { id: 'priv-mine', memberships: [{ userId: ctx.userId }], organizationId: ctx.orgId },
    ]);
    await q.insights({}, { measure: 'count', slice: 'status' }, ctx as never);
    const where = JSON.stringify(ctx.prisma.issue.findMany.mock.calls[0][0].where);
    expect(where).toContain('"teamId":{"notIn":["priv-hr"]}');
    expect(where).not.toContain('priv-mine');
    // and the membership table is never consulted for scope
    expect(ctx.prisma.teamMembership.findMany).not.toHaveBeenCalled();
  });

  it('burn-up uses the same scope', async () => {
    const ctx = setup();
    ctx.prisma.team.findMany.mockResolvedValue([
      { id: 'priv-hr', memberships: [], organizationId: ctx.orgId },
    ]);
    await q.projectBurnup({}, { projectId: PROJECT }, ctx as never);
    expect(JSON.stringify(ctx.prisma.issue.findMany.mock.calls[0][0].where)).toContain(
      '"teamId":{"notIn":["priv-hr"]}',
    );
  });
});
