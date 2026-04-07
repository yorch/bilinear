import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMockContext,
  type MockGraphQLContext,
} from '../../../test/context-mock';
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

      const result = await teamResolvers.Query.team(
        null,
        { id: TEST_TEAM.id },
        ctx as never,
      );

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
        await teamResolvers.Query.team(
          null,
          { id: TEST_TEAM.id },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });

    it('throws UNAUTHENTICATED when not logged in', async () => {
      ctx = createMockContext({ userId: null });

      try {
        await teamResolvers.Query.team(
          null,
          { id: TEST_TEAM.id },
          ctx as never,
        );
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

      const result = await teamResolvers.Query.teams(null, {}, ctx as never);
      expect(result).toEqual([TEST_TEAM]);
    });
  });

  describe('Mutation.teamCreate', () => {
    it('creates a team when user is admin', async () => {
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        organizationId: TEST_ORG.id,
        role: 'admin',
        userId: TEST_USER.id,
      });
      ctx.prisma.team.create.mockResolvedValue(TEST_TEAM);
      ctx.prisma.teamMembership.create.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
      ctx.prisma.workflowState.create.mockResolvedValue({});

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
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        organizationId: TEST_ORG.id,
        role: 'member',
        userId: TEST_USER.id,
      });

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
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        organizationId: TEST_ORG.id,
        role: 'admin',
        userId: TEST_USER.id,
      });

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
    it('soft-deletes a team when user is admin and team belongs to org', async () => {
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        organizationId: TEST_ORG.id,
        role: 'admin',
        userId: TEST_USER.id,
      });
      // findById to verify org ownership
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.prisma.team.update.mockResolvedValue({
        ...TEST_TEAM,
        archivedAt: new Date(),
      });

      const result = await teamResolvers.Mutation.teamDelete(
        null,
        { id: TEST_TEAM.id },
        ctx as never,
      );

      expect(result.success).toBe(true);
    });

    it('throws NOT_FOUND when team belongs to different org', async () => {
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'mem-1',
        organizationId: TEST_ORG.id,
        role: 'admin',
        userId: TEST_USER.id,
      });
      ctx.prisma.team.findUnique.mockResolvedValue({
        ...TEST_TEAM,
        organizationId: 'different-org-id',
      });

      try {
        await teamResolvers.Mutation.teamDelete(
          null,
          { id: TEST_TEAM.id },
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
    it('updates a team when user is a team member', async () => {
      // requireTeamMember check
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(
        TEST_TEAM_MEMBERSHIP,
      );
      // org-scope check via findById
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
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

    it('throws NOT_FOUND when team belongs to different org', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(
        TEST_TEAM_MEMBERSHIP,
      );
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
      ctx.prisma.workflowState.findMany.mockResolvedValue(
        DEFAULT_WORKFLOW_STATES,
      );

      const result = await teamResolvers.Team.states(
        TEST_TEAM as never,
        {},
        ctx as never,
      );

      expect(result).toEqual(DEFAULT_WORKFLOW_STATES);
    });

    it('resolves members for a team', async () => {
      ctx.prisma.teamMembership.findMany.mockResolvedValue([
        TEST_TEAM_MEMBERSHIP,
      ]);

      const result = await teamResolvers.Team.members(
        TEST_TEAM as never,
        {},
        ctx as never,
      );

      expect(result).toEqual([TEST_TEAM_MEMBERSHIP]);
    });

    it('resolves parent as null when no parentId', async () => {
      const result = await teamResolvers.Team.parent(
        TEST_TEAM as never,
        {},
        ctx as never,
      );

      expect(result).toBeNull();
    });

    it('resolves children teams', async () => {
      ctx.prisma.team.findMany.mockResolvedValue([]);

      const result = await teamResolvers.Team.children(
        TEST_TEAM as never,
        {},
        ctx as never,
      );

      expect(result).toEqual([]);
    });
  });

  describe('TeamMembership field resolvers', () => {
    it('maps isOwner to owner field', () => {
      const result = teamResolvers.TeamMembership.owner(
        TEST_TEAM_MEMBERSHIP as never,
      );
      expect(result).toBe(true);
    });
  });
});
