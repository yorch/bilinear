import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import {
  DEFAULT_WORKFLOW_STATES,
  TEST_ORG,
  TEST_TEAM,
  TEST_TEAM_MEMBERSHIP,
  TEST_USER,
} from '../../../test/fixtures';
import { teamResolvers } from './team';

describe('teamResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('Query.team', () => {
    it('returns a team by id', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);

      const result = await teamResolvers.Query.team(null, { id: TEST_TEAM.id }, ctx as never);

      expect(result).toEqual(TEST_TEAM);
    });

    it('throws NOT_FOUND when team does not exist', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(null);

      try {
        await teamResolvers.Query.team(null, { id: 'bad-id' }, ctx as never);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });

    it('throws NOT_FOUND when team belongs to a different org', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue({
        ...TEST_TEAM,
        organizationId: 'other-org-id',
      });

      try {
        await teamResolvers.Query.team(null, { id: TEST_TEAM.id }, ctx as never);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });

    it('throws UNAUTHENTICATED when not logged in', async () => {
      ctx = createMockContext({ userId: null });

      try {
        await teamResolvers.Query.team(null, { id: TEST_TEAM.id }, ctx as never);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  describe('Query.teams', () => {
    it('returns teams for the organization', async () => {
      ctx.prisma.team.findMany.mockResolvedValue([TEST_TEAM]);
      // Org admin sees all teams (no private filtering needed)
      ctx.orgRole = 'admin';

      const result = await teamResolvers.Query.teams(null, {}, ctx as never);
      expect(result).toEqual([TEST_TEAM]);
    });

    it('filters out private teams for non-members', async () => {
      const privateTeam = { ...TEST_TEAM, id: 'private-1', private: true };
      ctx.prisma.team.findMany.mockResolvedValue([TEST_TEAM, privateTeam]);
      // Non-admin user
      ctx.orgRole = 'member';
      // User is only a member of TEST_TEAM, not the private team
      ctx.prisma.teamMembership.findMany.mockResolvedValue([{ teamId: TEST_TEAM.id }]);

      const result = await teamResolvers.Query.teams(null, {}, ctx as never);
      expect(result).toEqual([TEST_TEAM]);
    });

    it('shows private teams to their members', async () => {
      const privateTeam = { ...TEST_TEAM, id: 'private-1', private: true };
      ctx.prisma.team.findMany.mockResolvedValue([TEST_TEAM, privateTeam]);
      ctx.orgRole = 'member';
      // User is member of both teams
      ctx.prisma.teamMembership.findMany.mockResolvedValue([
        { teamId: TEST_TEAM.id },
        { teamId: privateTeam.id },
      ]);

      const result = await teamResolvers.Query.teams(null, {}, ctx as never);
      expect(result).toEqual([TEST_TEAM, privateTeam]);
    });
  });

  describe('Mutation.teamCreate', () => {
    it('creates a team when user is admin', async () => {
      ctx.orgRole = 'admin';
      ctx.prisma.team.create.mockResolvedValue(TEST_TEAM);
      ctx.prisma.teamMembership.create.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
      for (const state of DEFAULT_WORKFLOW_STATES) {
        ctx.prisma.workflowState.create.mockResolvedValueOnce(state);
      }
      ctx.prisma.team.update.mockResolvedValue(TEST_TEAM);
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);

      const result = await teamResolvers.Mutation.teamCreate(
        null,
        { input: { key: 'ENG', name: 'Engineering' } },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.team).toEqual(TEST_TEAM);
      expect(result.lastSyncId).toBe('1');
    });

    it('throws FORBIDDEN when user is not admin', async () => {
      // requireOrgRole reads AuthContext.orgRole, which extractAuthContext
      // resolves once per request — there is no second membership lookup to
      // mock any more.
      ctx.orgRole = 'member';

      try {
        await teamResolvers.Mutation.teamCreate(
          null,
          { input: { key: 'ENG', name: 'Engineering' } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
      }
    });

    it('throws BAD_USER_INPUT for invalid key', async () => {
      ctx.orgRole = 'admin';

      try {
        await teamResolvers.Mutation.teamCreate(
          null,
          { input: { key: 'invalid', name: 'Test' } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('BAD_USER_INPUT');
      }
    });
  });

  describe('Mutation.teamDelete', () => {
    const deleteInput = { issueAction: 'DELETE' as const };

    it('soft-deletes a team when user is admin and team belongs to org', async () => {
      ctx.orgRole = 'admin';
      // findById to verify org ownership
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      // delete transaction: archive issues, then archive team
      ctx.prisma.issue.updateMany.mockResolvedValue({ count: 0 });
      ctx.prisma.team.update.mockResolvedValue({
        ...TEST_TEAM,
        archivedAt: new Date(),
      });

      const result = await teamResolvers.Mutation.teamDelete(
        null,
        { id: TEST_TEAM.id, input: deleteInput },
        ctx as never,
      );

      expect(result.success).toBe(true);
    });

    it('throws NOT_FOUND when team belongs to different org', async () => {
      ctx.orgRole = 'admin';
      ctx.prisma.team.findUnique.mockResolvedValue({
        ...TEST_TEAM,
        organizationId: 'different-org-id',
      });

      try {
        await teamResolvers.Mutation.teamDelete(
          null,
          { id: TEST_TEAM.id, input: deleteInput },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('Mutation.teamUpdate', () => {
    it('updates a team when user is a (non-guest) team owner', async () => {
      // org-scope check via findById
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      // not an org admin — falls through to the team-owner check
      ctx.orgRole = 'member';
      // requireTeamOwner / requireTeamMemberNotGuest checks
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
      const updated = { ...TEST_TEAM, name: 'New Name' };
      ctx.prisma.team.update.mockResolvedValue(updated);

      const result = await teamResolvers.Mutation.teamUpdate(
        null,
        { id: TEST_TEAM.id, input: { name: 'New Name' } },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.team.name).toBe('New Name');
    });

    it('updates a team when the user is an org admin but not a team member', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.orgRole = 'admin';
      const updated = { ...TEST_TEAM, name: 'New Name' };
      ctx.prisma.team.update.mockResolvedValue(updated);

      const result = await teamResolvers.Mutation.teamUpdate(
        null,
        { id: TEST_TEAM.id, input: { name: 'New Name' } },
        ctx as never,
      );

      expect(result.success).toBe(true);
      // requireTeamOwner/requireTeamMemberNotGuest must not even be
      // consulted — org-admin status alone is sufficient.
      expect(ctx.prisma.teamMembership.findUnique).not.toHaveBeenCalled();
    });

    it('pre-populates upcoming cycles when cyclesEnabled flips on', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue({ ...TEST_TEAM, cyclesEnabled: false });
      ctx.orgRole = 'admin';
      const updated = { ...TEST_TEAM, cyclesEnabled: true };
      ctx.prisma.team.update.mockResolvedValue(updated);
      const created = [{ id: 'cycle-new', number: 1, teamId: TEST_TEAM.id }];
      const autoCreate = vi.fn().mockResolvedValue(created);
      (ctx.services as unknown as Record<string, unknown>).cycle = {
        autoCreateUpcomingCycles: autoCreate,
      };
      const createSyncAction = vi.spyOn(ctx.services.sync, 'createSyncAction');

      const result = await teamResolvers.Mutation.teamUpdate(
        null,
        { id: TEST_TEAM.id, input: { cyclesEnabled: true } },
        ctx as never,
      );

      expect(autoCreate).toHaveBeenCalledWith(TEST_ORG.id, TEST_TEAM.id);
      // Every created cycle is broadcast — a row without a SyncAction is
      // invisible to other clients.
      expect(createSyncAction).toHaveBeenCalledWith(
        TEST_ORG.id,
        'I',
        'Cycle',
        'cycle-new',
        created[0],
      );
      expect(result.success).toBe(true);
    });

    it('re-fills upcoming cycles when cycleDuration changes on a cycles-enabled team', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue({ ...TEST_TEAM, cyclesEnabled: true });
      ctx.orgRole = 'admin';
      ctx.prisma.team.update.mockResolvedValue({
        ...TEST_TEAM,
        cycleDuration: 3,
        cyclesEnabled: true,
      });
      const autoCreate = vi.fn().mockResolvedValue([]);
      (ctx.services as unknown as Record<string, unknown>).cycle = {
        autoCreateUpcomingCycles: autoCreate,
      };

      await teamResolvers.Mutation.teamUpdate(
        null,
        { id: TEST_TEAM.id, input: { cycleDuration: 3 } },
        ctx as never,
      );

      expect(autoCreate).toHaveBeenCalledWith(TEST_ORG.id, TEST_TEAM.id);
    });

    it('does not touch cycles for an update that leaves cycle settings alone', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.orgRole = 'admin';
      ctx.prisma.team.update.mockResolvedValue({ ...TEST_TEAM, name: 'Renamed' });
      const autoCreate = vi.fn().mockResolvedValue([]);
      (ctx.services as unknown as Record<string, unknown>).cycle = {
        autoCreateUpcomingCycles: autoCreate,
      };

      await teamResolvers.Mutation.teamUpdate(
        null,
        { id: TEST_TEAM.id, input: { cycleDuration: 3, cyclesEnabled: false, name: 'Renamed' } },
        ctx as never,
      );

      expect(autoCreate).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN when a non-owner, non-admin team member tries to update', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.orgRole = 'member';
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: false,
      });

      await expect(
        teamResolvers.Mutation.teamUpdate(
          null,
          { id: TEST_TEAM.id, input: { name: 'X' } },
          ctx as never,
        ),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    });

    it('throws FORBIDDEN when a guest team owner tries to update', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.orgRole = 'member';
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
      ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

      await expect(
        teamResolvers.Mutation.teamUpdate(
          null,
          { id: TEST_TEAM.id, input: { name: 'X' } },
          ctx as never,
        ),
      ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    });

    it('throws NOT_FOUND when team belongs to different org', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
      ctx.prisma.team.findUnique.mockResolvedValue({
        ...TEST_TEAM,
        organizationId: 'different-org-id',
      });

      try {
        await teamResolvers.Mutation.teamUpdate(
          null,
          { id: TEST_TEAM.id, input: { name: 'X' } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('Team field resolvers', () => {
    it('resolves states for a team', async () => {
      ctx.prisma.workflowState.findMany.mockResolvedValue(DEFAULT_WORKFLOW_STATES);

      const result = await teamResolvers.Team.states(TEST_TEAM as never, {}, ctx as never);

      expect(result).toEqual(DEFAULT_WORKFLOW_STATES);
    });

    it('resolves members for a team', async () => {
      ctx.prisma.teamMembership.findMany.mockResolvedValue([TEST_TEAM_MEMBERSHIP]);

      const result = await teamResolvers.Team.members(TEST_TEAM as never, {}, ctx as never);

      expect(result).toEqual([TEST_TEAM_MEMBERSHIP]);
    });

    it('resolves parent as null when no parentId', async () => {
      const result = await teamResolvers.Team.parent(TEST_TEAM as never, {}, ctx as never);

      expect(result).toBeNull();
    });

    it('resolves children teams', async () => {
      ctx.prisma.team.findMany.mockResolvedValue([]);

      const result = await teamResolvers.Team.children(TEST_TEAM as never, {}, ctx as never);

      expect(result).toEqual([]);
    });

    describe('Team.issues', () => {
      it('passes no guestUserId (sees all issues) for a non-guest member', async () => {
        ctx.prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
        ctx.prisma.issue.findMany.mockResolvedValue([]);

        await teamResolvers.Team.issues(TEST_TEAM as never, {}, ctx as never);

        expect(ctx.prisma.issue.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ teamId: TEST_TEAM.id }),
          }),
        );
        // No creator/assignee restriction applied for a non-guest.
        const call = ctx.prisma.issue.findMany.mock.calls[0][0];
        expect(JSON.stringify(call.where.AND)).not.toContain('creatorId');
      });

      it('scopes to creator/assignee for a guest team member', async () => {
        ctx.prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
        ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });
        ctx.prisma.issue.findMany.mockResolvedValue([]);

        await teamResolvers.Team.issues(TEST_TEAM as never, {}, ctx as never);

        const call = ctx.prisma.issue.findMany.mock.calls[0][0];
        expect(call.where.AND).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              // findByTeamId now routes through the shared buildGuestVisibilityWhere
              // helper, which emits a `teamId notIn [teamId]` escape branch. That
              // branch is always false here (the query already filters teamId = this
              // team), so the effective predicate is still creator-or-assignee.
              OR: [
                { teamId: { notIn: [TEST_TEAM.id] } },
                { creatorId: TEST_USER.id },
                { assigneeId: TEST_USER.id },
              ],
            }),
          ]),
        );
      });
    });
  });

  describe('TeamMembership field resolvers', () => {
    it('maps isOwner to owner field', () => {
      const result = teamResolvers.TeamMembership.owner(TEST_TEAM_MEMBERSHIP as never);
      expect(result).toBe(true);
    });
  });
});
