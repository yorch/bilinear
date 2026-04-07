import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMockContext,
  type MockGraphQLContext,
} from '../../../test/context-mock';
import {
  TEST_ORG,
  TEST_TEAM,
  TEST_TEAM_MEMBERSHIP,
  TEST_USER_2,
} from '../../../test/fixtures';
import { teamMembershipResolvers } from './team-membership';

// Simulate a membership record that includes the related team (for org-scope checks)
const MEMBERSHIP_WITH_TEAM = {
  ...TEST_TEAM_MEMBERSHIP,
  team: { ...TEST_TEAM, organizationId: TEST_ORG.id },
};

describe('teamMembershipResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
    // Default: caller is a team owner
    ctx.prisma.teamMembership.findUnique.mockResolvedValue(
      TEST_TEAM_MEMBERSHIP,
    );
  });

  describe('Mutation.teamMembershipCreate', () => {
    it('adds a member when caller is team owner and team is in same org', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: true,
      });
      ctx.prisma.teamMembership.create.mockResolvedValue({
        ...TEST_TEAM_MEMBERSHIP,
        userId: TEST_USER_2.id,
      });

      const result =
        await teamMembershipResolvers.Mutation.teamMembershipCreate(
          null,
          { input: { teamId: TEST_TEAM.id, userId: TEST_USER_2.id } },
          ctx as never,
        );

      expect(result.success).toBe(true);
    });

    it('throws NOT_FOUND when team belongs to different org', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue({
        ...TEST_TEAM,
        organizationId: 'other-org-id',
      });

      try {
        await teamMembershipResolvers.Mutation.teamMembershipCreate(
          null,
          { input: { teamId: TEST_TEAM.id, userId: TEST_USER_2.id } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });

    it('throws FORBIDDEN when caller is not a team owner', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: false,
      });

      try {
        await teamMembershipResolvers.Mutation.teamMembershipCreate(
          null,
          { input: { teamId: TEST_TEAM.id, userId: TEST_USER_2.id } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
      }
    });

    it('throws UNAUTHENTICATED when not logged in', async () => {
      ctx = createMockContext({ userId: null });

      await expect(
        teamMembershipResolvers.Mutation.teamMembershipCreate(
          null,
          { input: { teamId: TEST_TEAM.id, userId: TEST_USER_2.id } },
          ctx as never,
        ),
      ).rejects.toThrow(GraphQLError);
    });

    it('throws BAD_USER_INPUT on duplicate membership (P2002)', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: true,
      });
      ctx.prisma.teamMembership.create.mockRejectedValue(
        Object.assign(new Error('Unique'), { code: 'P2002' }),
      );

      try {
        await teamMembershipResolvers.Mutation.teamMembershipCreate(
          null,
          { input: { teamId: TEST_TEAM.id, userId: TEST_USER_2.id } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('BAD_USER_INPUT');
      }
    });
  });

  describe('Mutation.teamMembershipDelete', () => {
    it('allows a team owner to remove any member', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce(
        MEMBERSHIP_WITH_TEAM,
      );
      // requireTeamOwner check
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: true,
      });
      ctx.prisma.teamMembership.delete.mockResolvedValue(TEST_TEAM_MEMBERSHIP);

      const result =
        await teamMembershipResolvers.Mutation.teamMembershipDelete(
          null,
          { id: TEST_TEAM_MEMBERSHIP.id },
          ctx as never,
        );

      expect(result.success).toBe(true);
    });

    it('allows a user to remove their own membership', async () => {
      // Membership belongs to TEST_USER (same as ctx.userId)
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce(
        MEMBERSHIP_WITH_TEAM,
      );
      ctx.prisma.teamMembership.delete.mockResolvedValue(TEST_TEAM_MEMBERSHIP);

      const result =
        await teamMembershipResolvers.Mutation.teamMembershipDelete(
          null,
          { id: TEST_TEAM_MEMBERSHIP.id },
          ctx as never,
        );

      expect(result.success).toBe(true);
    });

    it('throws NOT_FOUND when membership belongs to different org', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        ...MEMBERSHIP_WITH_TEAM,
        team: { ...TEST_TEAM, organizationId: 'other-org-id' },
      });

      try {
        await teamMembershipResolvers.Mutation.teamMembershipDelete(
          null,
          { id: TEST_TEAM_MEMBERSHIP.id },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });

    it('throws NOT_FOUND when membership does not exist', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      try {
        await teamMembershipResolvers.Mutation.teamMembershipDelete(
          null,
          { id: 'nonexistent' },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('Mutation.teamMembershipUpdate', () => {
    it('allows a team owner to change isOwner', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce(
        MEMBERSHIP_WITH_TEAM,
      );
      // requireTeamOwner check
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: true,
      });
      ctx.prisma.teamMembership.update.mockResolvedValue({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: false,
      });

      const result =
        await teamMembershipResolvers.Mutation.teamMembershipUpdate(
          null,
          { id: TEST_TEAM_MEMBERSHIP.id, input: { isOwner: false } },
          ctx as never,
        );

      expect(result.success).toBe(true);
    });

    it('throws FORBIDDEN when non-owner tries to change isOwner', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce(
        MEMBERSHIP_WITH_TEAM,
      );
      // requireTeamOwner returns non-owner
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce({
        ...TEST_TEAM_MEMBERSHIP,
        isOwner: false,
      });

      try {
        await teamMembershipResolvers.Mutation.teamMembershipUpdate(
          null,
          { id: TEST_TEAM_MEMBERSHIP.id, input: { isOwner: true } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
      }
    });

    it('allows any member to update their own sortOrder', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce(
        MEMBERSHIP_WITH_TEAM,
      );
      // requireTeamMember check
      ctx.prisma.teamMembership.findUnique.mockResolvedValueOnce(
        TEST_TEAM_MEMBERSHIP,
      );
      ctx.prisma.teamMembership.update.mockResolvedValue({
        ...TEST_TEAM_MEMBERSHIP,
        sortOrder: 5,
      });

      const result =
        await teamMembershipResolvers.Mutation.teamMembershipUpdate(
          null,
          { id: TEST_TEAM_MEMBERSHIP.id, input: { sortOrder: 5 } },
          ctx as never,
        );

      expect(result.success).toBe(true);
    });

    it('throws NOT_FOUND when membership belongs to different org', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        ...MEMBERSHIP_WITH_TEAM,
        team: { ...TEST_TEAM, organizationId: 'other-org-id' },
      });

      try {
        await teamMembershipResolvers.Mutation.teamMembershipUpdate(
          null,
          { id: TEST_TEAM_MEMBERSHIP.id, input: { sortOrder: 1 } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });
  });
});
