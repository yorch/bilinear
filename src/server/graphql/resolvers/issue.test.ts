import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import {
  DEFAULT_WORKFLOW_STATES,
  TEST_ISSUE,
  TEST_ORG,
  TEST_TEAM,
  TEST_USER,
  TEST_USER_2,
} from '../../../test/fixtures';
import { issueResolvers } from './issue';

describe('issueResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  // ── Mutation.issueCreate ──────────────────────────────────────────────────

  describe('Mutation.issueCreate', () => {
    // IssueService.create now validates that a caller-supplied stateId
    // belongs to the same team. Mock the lookup to return the team match
    // by default so existing tests stay focused on the assignment/
    // notification behavior they were written for.
    beforeEach(() => {
      ctx.prisma.workflowState.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
    });

    it('creates an issue and returns payload', async () => {
      ctx.prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      ctx.prisma.issue.create.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.issueLabelAssignment.deleteMany.mockResolvedValue({
        count: 0,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Mutation.issueCreate(
        null,
        {
          input: {
            stateId: DEFAULT_WORKFLOW_STATES[0].id,
            teamId: TEST_TEAM.id,
            title: 'Test issue',
          },
        },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.issue).toEqual(TEST_ISSUE);
      expect(result.lastSyncId).toBe('1');
    });

    it('auto-subscribes the creator', async () => {
      ctx.prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      ctx.prisma.issue.create.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.issueLabelAssignment.deleteMany.mockResolvedValue({
        count: 0,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.notificationSubscription.findUnique.mockResolvedValue(null);
      // autoSubscribe is idempotent via upsert (avoids a P2002 race).
      ctx.prisma.notificationSubscription.upsert.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      });

      await issueResolvers.Mutation.issueCreate(
        null,
        {
          input: {
            stateId: DEFAULT_WORKFLOW_STATES[0].id,
            teamId: TEST_TEAM.id,
            title: 'Test issue',
          },
        },
        ctx as never,
      );

      // Allow fire-and-forget promises to settle
      await vi.waitFor(() =>
        expect(ctx.prisma.notificationSubscription.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({ userId: TEST_USER.id }),
          }),
        ),
      );
    });

    it('notifies and subscribes the assignee when different from creator', async () => {
      ctx.prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      ctx.prisma.issue.create.mockResolvedValue({
        ...TEST_ISSUE,
        assigneeId: TEST_USER_2.id,
      });
      ctx.prisma.issueLabelAssignment.deleteMany.mockResolvedValue({
        count: 0,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      // assigneeId must resolve to an org member — see validateReferences.
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        role: 'member',
        userId: TEST_USER_2.id,
      });
      ctx.prisma.notificationSubscription.findUnique.mockResolvedValue(null);
      ctx.prisma.notificationSubscription.create.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER_2.id,
      });
      ctx.prisma.notification.create.mockResolvedValue({
        actorId: TEST_USER.id,
        createdAt: new Date(),
        data: {},
        id: 'notif-1',
        issueId: TEST_ISSUE.id,
        organizationId: TEST_ISSUE.organizationId,
        read: false,
        readAt: null,
        snoozedUntilAt: null,
        type: 'ISSUE_ASSIGNED',
        updatedAt: new Date(),
        userId: TEST_USER_2.id,
      });

      await issueResolvers.Mutation.issueCreate(
        null,
        {
          input: {
            assigneeId: TEST_USER_2.id,
            stateId: DEFAULT_WORKFLOW_STATES[0].id,
            teamId: TEST_TEAM.id,
            title: 'Test issue',
          },
        },
        ctx as never,
      );

      await vi.waitFor(() =>
        expect(ctx.prisma.notification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              type: 'ISSUE_ASSIGNED',
              userId: TEST_USER_2.id,
            }),
          }),
        ),
      );
    });

    it('does not notify the assignee when they are the creator', async () => {
      ctx.prisma.team.update.mockResolvedValue({ ...TEST_TEAM, issueCount: 1 });
      ctx.prisma.issue.create.mockResolvedValue({
        ...TEST_ISSUE,
        assigneeId: TEST_USER.id,
      });
      ctx.prisma.issueLabelAssignment.deleteMany.mockResolvedValue({
        count: 0,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      // assigneeId must resolve to an org member — see validateReferences.
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        role: 'member',
        userId: TEST_USER.id,
      });
      ctx.prisma.notificationSubscription.findUnique.mockResolvedValue(null);
      ctx.prisma.notificationSubscription.create.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      });

      await issueResolvers.Mutation.issueCreate(
        null,
        {
          input: {
            assigneeId: TEST_USER.id, // same as ctx.userId
            stateId: DEFAULT_WORKFLOW_STATES[0].id,
            teamId: TEST_TEAM.id,
            title: 'Test issue',
          },
        },
        ctx as never,
      );

      // Notification should NOT have been created (self-assignment)
      await vi.waitFor(() => expect(ctx.prisma.notification.create).not.toHaveBeenCalled());
    });

    it('throws UNAUTHENTICATED when not logged in', async () => {
      ctx = createMockContext({ orgId: null, userId: null });

      await expect(
        issueResolvers.Mutation.issueCreate(
          null,
          { input: { teamId: TEST_TEAM.id, title: 'Test' } },
          ctx as never,
        ),
      ).rejects.toThrow(GraphQLError);
    });
  });

  // ── Mutation.issueUpdate ──────────────────────────────────────────────────

  describe('Mutation.issueUpdate', () => {
    it('updates an issue', async () => {
      const updated = { ...TEST_ISSUE, title: 'Updated' };
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.issue.update.mockResolvedValue(updated);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Mutation.issueUpdate(
        null,
        { id: TEST_ISSUE.id, input: { title: 'Updated' } },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.issue?.title).toBe('Updated');
    });

    it('auto-subscribes the actor on any update', async () => {
      const updated = { ...TEST_ISSUE, title: 'Updated' };
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.issue.update.mockResolvedValue(updated);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.notificationSubscription.findUnique.mockResolvedValue(null);
      // autoSubscribe is idempotent via upsert (avoids a P2002 race).
      ctx.prisma.notificationSubscription.upsert.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      });

      await issueResolvers.Mutation.issueUpdate(
        null,
        { id: TEST_ISSUE.id, input: { title: 'Updated' } },
        ctx as never,
      );

      await vi.waitFor(() => expect(ctx.prisma.notificationSubscription.upsert).toHaveBeenCalled());
    });

    it('notifies and subscribes the new assignee when assigneeId changes', async () => {
      const issueWithoutAssignee = { ...TEST_ISSUE, assigneeId: null };
      const updated = { ...TEST_ISSUE, assigneeId: TEST_USER_2.id };
      ctx.prisma.issue.findUnique.mockResolvedValue(issueWithoutAssignee);
      ctx.prisma.issue.update.mockResolvedValue(updated);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      // assigneeId must resolve to an org member — see validateReferences.
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        organizationId: TEST_ORG.id,
        role: 'member',
        userId: TEST_USER_2.id,
      });
      ctx.prisma.notificationSubscription.findUnique.mockResolvedValue(null);
      ctx.prisma.notificationSubscription.create.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER_2.id,
      });
      ctx.prisma.notification.create.mockResolvedValue({
        actorId: TEST_USER.id,
        createdAt: new Date(),
        data: {},
        id: 'notif-2',
        issueId: TEST_ISSUE.id,
        organizationId: TEST_ISSUE.organizationId,
        read: false,
        readAt: null,
        snoozedUntilAt: null,
        type: 'ISSUE_ASSIGNED',
        updatedAt: new Date(),
        userId: TEST_USER_2.id,
      });

      await issueResolvers.Mutation.issueUpdate(
        null,
        { id: TEST_ISSUE.id, input: { assigneeId: TEST_USER_2.id } },
        ctx as never,
      );

      await vi.waitFor(() =>
        expect(ctx.prisma.notification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              type: 'ISSUE_ASSIGNED',
              userId: TEST_USER_2.id,
            }),
          }),
        ),
      );
    });

    it('notifies subscribers when stateId changes', async () => {
      const newStateId = DEFAULT_WORKFLOW_STATES[1].id;
      const updated = { ...TEST_ISSUE, stateId: newStateId };
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.issue.update.mockResolvedValue(updated);
      // update() now validates stateId belongs to the same team — the
      // workflowState lookup must return a same-team match for the
      // mutation to pass through to the cascade/notification path.
      ctx.prisma.workflowState.findFirst.mockResolvedValue({ teamId: TEST_TEAM.id });
      ctx.prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: false,
        autoCloseParentIssues: false,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.notificationSubscription.findUnique.mockResolvedValue(null);
      ctx.prisma.notificationSubscription.create.mockResolvedValue({
        active: true,
        issueId: TEST_ISSUE.id,
        userId: TEST_USER.id,
      });
      // Subscriber list (excluding the actor who made the change)
      ctx.prisma.notificationSubscription.findMany.mockResolvedValue([{ userId: TEST_USER_2.id }]);
      ctx.prisma.notification.create.mockResolvedValue({
        actorId: TEST_USER.id,
        createdAt: new Date(),
        data: {},
        id: 'notif-3',
        issueId: TEST_ISSUE.id,
        organizationId: TEST_ISSUE.organizationId,
        read: false,
        readAt: null,
        snoozedUntilAt: null,
        type: 'ISSUE_STATUS_CHANGED',
        updatedAt: new Date(),
        userId: TEST_USER_2.id,
      });

      await issueResolvers.Mutation.issueUpdate(
        null,
        { id: TEST_ISSUE.id, input: { stateId: newStateId } },
        ctx as never,
      );

      await vi.waitFor(() =>
        expect(ctx.prisma.notification.createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.arrayContaining([
              expect.objectContaining({ type: 'ISSUE_STATUS_CHANGED' }),
            ]),
          }),
        ),
      );
    });

    it('resolves a human identifier (ENG-1) through the org-scoped identifier lookup', async () => {
      ctx.prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        isOwner: false,
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_ISSUE.teamId,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Query.issue(null, { id: 'ENG-1' }, ctx as never);

      expect(result).toEqual(TEST_ISSUE);
      // Never reaches `findUnique`, whose uuid column cast rejects the identifier.
      expect(ctx.prisma.issue.findUnique).not.toHaveBeenCalled();
      expect(ctx.prisma.issue.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ identifier: 'ENG-1' }, { previousIdentifiers: { has: 'ENG-1' } }],
            organizationId: TEST_ORG.id,
          }),
        }),
      );
    });

    it('throws NOT_FOUND when issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);
      ctx.prisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        issueResolvers.Mutation.issueUpdate(
          null,
          { id: 'bad-id', input: { title: 'x' } },
          ctx as never,
        ),
      ).rejects.toThrow(GraphQLError);
    });

    it('throws NOT_FOUND when issue belongs to different org', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue({
        ...TEST_ISSUE,
        organizationId: 'other-org',
      });

      await expect(
        issueResolvers.Mutation.issueUpdate(null, { id: TEST_ISSUE.id, input: {} }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    });
  });

  // ── Mutation.issueArchive / issueUnarchive ────────────────────────────────

  describe('Mutation.issueArchive', () => {
    it('archives an issue', async () => {
      const archived = { ...TEST_ISSUE, archivedAt: new Date() };
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.issue.update.mockResolvedValue(archived);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Mutation.issueArchive(
        null,
        { id: TEST_ISSUE.id },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.issue?.archivedAt).not.toBeNull();
    });
  });

  describe('Mutation.issueUnarchive', () => {
    it('unarchives an issue', async () => {
      const archivedIssue = { ...TEST_ISSUE, archivedAt: new Date() };
      ctx.prisma.issue.findUnique.mockResolvedValue(archivedIssue);
      ctx.prisma.issue.update.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Mutation.issueUnarchive(
        null,
        { id: TEST_ISSUE.id },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.issue?.archivedAt).toBeNull();
    });
  });

  // ── Mutation.issueDelete ──────────────────────────────────────────────────

  describe('Mutation.issueDelete', () => {
    it('deletes an issue', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.issue.delete.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Mutation.issueDelete(
        null,
        { id: TEST_ISSUE.id },
        ctx as never,
      );

      expect(result.success).toBe(true);
    });
  });

  // ── Query.issue ───────────────────────────────────────────────────────────

  describe('Query.issue', () => {
    it('returns an issue by id', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        isOwner: false,
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_ISSUE.teamId,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Query.issue(null, { id: TEST_ISSUE.id }, ctx as never);

      expect(result).toEqual(TEST_ISSUE);
    });

    it('resolves a human identifier (ENG-1) through the org-scoped identifier lookup', async () => {
      ctx.prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        isOwner: false,
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_ISSUE.teamId,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Query.issue(null, { id: 'ENG-1' }, ctx as never);

      expect(result).toEqual(TEST_ISSUE);
      // Never reaches `findUnique`, whose uuid column cast rejects the identifier.
      expect(ctx.prisma.issue.findUnique).not.toHaveBeenCalled();
      expect(ctx.prisma.issue.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ identifier: 'ENG-1' }, { previousIdentifiers: { has: 'ENG-1' } }],
            organizationId: TEST_ORG.id,
          }),
        }),
      );
    });

    it('throws NOT_FOUND when issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);
      ctx.prisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        issueResolvers.Query.issue(null, { id: 'missing' }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    });

    it('throws NOT_FOUND for cross-org access', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue({
        ...TEST_ISSUE,
        organizationId: 'other-org',
      });

      await expect(
        issueResolvers.Query.issue(null, { id: TEST_ISSUE.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    });

    it('throws FORBIDDEN when a guest requests an issue they neither created nor are assigned to', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue({
        ...TEST_ISSUE,
        assigneeId: TEST_USER_2.id,
        creatorId: TEST_USER_2.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        isOwner: false,
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_ISSUE.teamId,
        userId: TEST_USER.id,
      });
      ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

      await expect(
        issueResolvers.Query.issue(null, { id: TEST_ISSUE.id }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    });

    it('allows a guest to read an issue they created', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue({
        ...TEST_ISSUE,
        assigneeId: null,
        creatorId: TEST_USER.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        isOwner: false,
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_ISSUE.teamId,
        userId: TEST_USER.id,
      });
      ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

      const result = await issueResolvers.Query.issue(null, { id: TEST_ISSUE.id }, ctx as never);

      expect(result.id).toBe(TEST_ISSUE.id);
    });
  });

  // ── Query.issues ──────────────────────────────────────────────────────────

  describe('Query.issues', () => {
    it('returns a connection with edges, nodes, and totalCount', async () => {
      ctx.prisma.issue.findMany.mockResolvedValue([TEST_ISSUE]);
      ctx.prisma.issue.count.mockResolvedValue(1);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        isOwner: false,
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });

      const result = await issueResolvers.Query.issues(
        null,
        { filter: { teamId: TEST_TEAM.id }, first: 50 },
        ctx as never,
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.edges[0].cursor).toBe(TEST_ISSUE.id);
    });

    it('throws BAD_USER_INPUT when teamId filter is missing', async () => {
      await expect(
        issueResolvers.Query.issues(null, { first: 50 }, ctx as never),
      ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    });

    it('filters by teamId when provided in filter', async () => {
      ctx.prisma.issue.findMany.mockResolvedValue([]);
      ctx.prisma.issue.count.mockResolvedValue(0);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        isOwner: false,
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });

      await issueResolvers.Query.issues(
        null,
        { filter: { teamId: TEST_TEAM.id }, first: 50 },
        ctx as never,
      );

      expect(ctx.prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: TEST_TEAM.id }),
        }),
      );
    });
  });

  // ── Issue field resolvers ────────────────────────────────────────────────

  describe('Issue.parent', () => {
    it('returns null when the parent belongs to a different org', async () => {
      // Issue.parent now resolves via the batched issueById DataLoader,
      // which fetches via findMany rather than a per-row findUnique.
      ctx.prisma.issue.findMany.mockResolvedValue([
        {
          ...TEST_ISSUE,
          id: 'parent-1',
          organizationId: 'other-org',
        },
      ]);

      const result = await issueResolvers.Issue.parent(
        { ...TEST_ISSUE, parentId: 'parent-1' } as never,
        {},
        ctx as never,
      );

      expect(result).toBeNull();
    });

    it('returns the parent when it belongs to the same org', async () => {
      const parent = { ...TEST_ISSUE, id: 'parent-1' };
      ctx.prisma.issue.findMany.mockResolvedValue([parent]);
      ctx.prisma.teamMembership.findMany.mockResolvedValue([
        { team: { organizationId: TEST_ORG.id }, teamId: parent.teamId, userId: TEST_USER.id },
      ]);
      ctx.prisma.teamMemberRole.findMany.mockResolvedValue([]);

      const result = await issueResolvers.Issue.parent(
        { ...TEST_ISSUE, parentId: 'parent-1' } as never,
        {},
        ctx as never,
      );

      expect(result).toEqual(parent);
    });
  });

  describe('Issue.children', () => {
    it('scopes the children lookup to the issue own organizationId', async () => {
      ctx.prisma.issue.findMany.mockResolvedValue([]);
      ctx.prisma.teamMembership.findMany.mockResolvedValue([]);
      ctx.prisma.teamMemberRole.findMany.mockResolvedValue([]);

      await issueResolvers.Issue.children(TEST_ISSUE as never, {}, ctx as never);

      expect(ctx.prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: TEST_ISSUE.organizationId }),
        }),
      );
    });

    it('narrows to own-work children for a guest, against the batched result', async () => {
      const own = {
        ...TEST_ISSUE,
        assigneeId: TEST_USER.id,
        creatorId: null,
        id: 'child-own',
        parentId: TEST_ISSUE.id,
      };
      const other = {
        ...TEST_ISSUE,
        assigneeId: TEST_USER_2.id,
        creatorId: null,
        id: 'child-other',
        parentId: TEST_ISSUE.id,
      };
      ctx.prisma.issue.findMany.mockResolvedValue([own, other]);
      // The guest check is batched too (guestByTeamUser) — it reads
      // membership + role via findMany, never the per-row findUnique.
      ctx.prisma.teamMembership.findMany.mockResolvedValue([
        { team: { organizationId: TEST_ORG.id }, teamId: TEST_ISSUE.teamId, userId: TEST_USER.id },
      ]);
      ctx.prisma.teamMemberRole.findMany.mockResolvedValue([
        { role: 'guest', teamId: TEST_ISSUE.teamId, userId: TEST_USER.id },
      ]);

      const result = await issueResolvers.Issue.children(TEST_ISSUE as never, {}, ctx as never);

      expect(result).toEqual([own]);
      // The base fetch is batched — one findMany call regardless of the
      // guest filter applied afterwards in memory.
      expect(ctx.prisma.issue.findMany).toHaveBeenCalledTimes(1);
      expect(ctx.prisma.teamMembership.findUnique).not.toHaveBeenCalled();
      expect(ctx.prisma.teamMemberRole.findUnique).not.toHaveBeenCalled();
    });

    it('resolves the guest check once for many children of the same team', async () => {
      ctx.prisma.issue.findMany.mockResolvedValue([]);
      ctx.prisma.teamMembership.findMany.mockResolvedValue([]);
      ctx.prisma.teamMemberRole.findMany.mockResolvedValue([]);

      await Promise.all(
        ['a', 'b', 'c'].map(id =>
          issueResolvers.Issue.children({ ...TEST_ISSUE, id } as never, {}, ctx as never),
        ),
      );

      expect(ctx.prisma.teamMembership.findMany).toHaveBeenCalledTimes(1);
      expect(ctx.prisma.teamMemberRole.findMany).toHaveBeenCalledTimes(1);
      expect(ctx.prisma.teamMembership.findUnique).not.toHaveBeenCalled();
    });
  });
});
