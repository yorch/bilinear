import { beforeEach, describe, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ORG, TEST_TEAM, TEST_USER, TEST_USER_2 } from '../../../test/fixtures';
import { ProjectService, ProjectValidationError } from '../../services/project.service';
import { TeamCrossOrgError, TeamNotFoundError } from '../../services/team.service';
import { projectResolvers } from './project';

const TEST_PROJECT = {
  archivedAt: null,
  color: null,
  createdAt: new Date('2026-02-01T00:00:00Z'),
  creatorId: TEST_USER.id,
  description: '',
  health: null,
  icon: null,
  id: '00000000-0000-0000-0000-000000000900',
  leadId: null,
  name: 'Test Project',
  organizationId: TEST_ORG.id,
  statusType: 'planned',
  targetDate: null,
  trashed: false,
  updatedAt: new Date('2026-02-01T00:00:00Z'),
};

const TEST_MILESTONE = {
  createdAt: new Date('2026-02-01T00:00:00Z'),
  id: '00000000-0000-0000-0000-000000000901',
  name: 'Milestone 1',
  projectId: TEST_PROJECT.id,
  sortOrder: 0,
  targetDate: null,
  updatedAt: new Date('2026-02-01T00:00:00Z'),
};

const TEST_PROJECT_UPDATE = {
  body: 'update body',
  bodyData: {},
  createdAt: new Date('2026-02-01T00:00:00Z'),
  health: 'onTrack',
  id: '00000000-0000-0000-0000-000000000902',
  projectId: TEST_PROJECT.id,
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  userId: TEST_USER.id,
};

// `MockGraphQLContext` (src/test/context-mock.ts) doesn't wire up
// `ProjectService` — only resolvers that were already under test when that
// mock was built are registered there. Rather than touching shared test
// infra (out of scope for this sweep), build a superset context here that
// adds a real `ProjectService` instance over the same mock Prisma client.
type CtxWithProject = MockGraphQLContext & {
  services: MockGraphQLContext['services'] & { project: ProjectService };
};

function createCtx(
  overrides?: Partial<{ orgId: string | null; userId: string | null }>,
): CtxWithProject {
  const base = createMockContext(overrides);
  return {
    ...base,
    services: { ...base.services, project: new ProjectService(base.prisma as never) },
  };
}

describe('projectResolvers', () => {
  let ctx: CtxWithProject;

  beforeEach(() => {
    ctx = createCtx();
  });

  describe('Mutation.projectCreate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectCreate,
        { input: { name: 'New Project' } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when a teamId does not exist', async () => {
      vi.spyOn(ctx.services.team, 'assertAllInOrg').mockRejectedValue(new TeamNotFoundError());

      await testAuthGuard(
        projectResolvers.Mutation.projectCreate,
        { input: { name: 'New Project', teamIds: ['missing-team'] } },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when a teamId belongs to a different org', async () => {
      vi.spyOn(ctx.services.team, 'assertAllInOrg').mockRejectedValue(new TeamCrossOrgError());

      await testAuthGuard(
        projectResolvers.Mutation.projectCreate,
        { input: { name: 'New Project', teamIds: [TEST_TEAM.id] } },
        ctx,
        'FORBIDDEN',
      );
    });

    it('remaps ProjectValidationError to BAD_USER_INPUT', async () => {
      vi.spyOn(ctx.services.project, 'create').mockRejectedValue(
        new ProjectValidationError('description too long'),
      );

      await testAuthGuard(
        projectResolvers.Mutation.projectCreate,
        { input: { name: 'New Project' } },
        ctx,
        'BAD_USER_INPUT',
      );
    });
  });

  describe('Mutation.projectUpdate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectUpdate,
        { id: TEST_PROJECT.id, input: { name: 'Renamed' } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectUpdate,
        { id: 'missing', input: { name: 'Renamed' } },
        ctx,
        'NOT_FOUND',
      );
    });

    it('remaps ProjectValidationError to BAD_USER_INPUT', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      vi.spyOn(ctx.services.project, 'update').mockRejectedValue(
        new ProjectValidationError('description too long'),
      );

      await testAuthGuard(
        projectResolvers.Mutation.projectUpdate,
        { id: TEST_PROJECT.id, input: { description: 'x'.repeat(100000) } },
        ctx,
        'BAD_USER_INPUT',
      );
    });
  });

  describe('Mutation.projectArchive', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectArchive,
        { id: TEST_PROJECT.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectArchive,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectDelete', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectDelete,
        { id: TEST_PROJECT.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectDelete,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectAddMember', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectAddMember,
        { projectId: TEST_PROJECT.id, userId: TEST_USER_2.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectAddMember,
        { projectId: 'missing', userId: TEST_USER_2.id },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller lacks an org membership role', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = null;

      await testAuthGuard(
        projectResolvers.Mutation.projectAddMember,
        { projectId: TEST_PROJECT.id, userId: TEST_USER_2.id },
        ctx,
        'FORBIDDEN',
      );
    });

    it('throws NOT_FOUND when the target user is not an org member', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      ctx.prisma.organizationMember.findUnique.mockResolvedValueOnce({ role: 'admin' });
      vi.spyOn(ctx.services.organization, 'isMember').mockResolvedValue(false);

      await testAuthGuard(
        projectResolvers.Mutation.projectAddMember,
        { projectId: TEST_PROJECT.id, userId: 'not-a-member' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectAddTeam', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectAddTeam,
        { projectId: TEST_PROJECT.id, teamId: TEST_TEAM.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectAddTeam,
        { projectId: 'missing', teamId: TEST_TEAM.id },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller lacks an org membership role', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = null;

      await testAuthGuard(
        projectResolvers.Mutation.projectAddTeam,
        { projectId: TEST_PROJECT.id, teamId: TEST_TEAM.id },
        ctx,
        'FORBIDDEN',
      );
    });

    it('throws NOT_FOUND when the team does not exist in this org', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({ role: 'admin' });
      ctx.prisma.team.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectAddTeam,
        { projectId: TEST_PROJECT.id, teamId: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectRemoveMember', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectRemoveMember,
        { projectId: TEST_PROJECT.id, userId: TEST_USER_2.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectRemoveMember,
        { projectId: 'missing', userId: TEST_USER_2.id },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller lacks an org membership role', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = null;

      await testAuthGuard(
        projectResolvers.Mutation.projectRemoveMember,
        { projectId: TEST_PROJECT.id, userId: TEST_USER_2.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Mutation.projectRemoveTeam', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectRemoveTeam,
        { projectId: TEST_PROJECT.id, teamId: TEST_TEAM.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectRemoveTeam,
        { projectId: 'missing', teamId: TEST_TEAM.id },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller lacks an org membership role', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = null;

      await testAuthGuard(
        projectResolvers.Mutation.projectRemoveTeam,
        { projectId: TEST_PROJECT.id, teamId: TEST_TEAM.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Mutation.projectMilestoneCreate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectMilestoneCreate,
        { input: { name: 'M1', projectId: TEST_PROJECT.id } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectMilestoneCreate,
        { input: { name: 'M1', projectId: 'missing' } },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectMilestoneDelete', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectMilestoneDelete,
        { id: TEST_MILESTONE.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the milestone does not exist', async () => {
      ctx.prisma.projectMilestone.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectMilestoneDelete,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND when the parent project belongs to a different org', async () => {
      ctx.prisma.projectMilestone.findUnique.mockResolvedValue(TEST_MILESTONE);
      ctx.prisma.project.findUnique.mockResolvedValue({
        ...TEST_PROJECT,
        organizationId: 'other-org',
      });

      await testAuthGuard(
        projectResolvers.Mutation.projectMilestoneDelete,
        { id: TEST_MILESTONE.id },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectMilestoneUpdate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectMilestoneUpdate,
        { id: TEST_MILESTONE.id, input: { name: 'Renamed' } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the milestone does not exist', async () => {
      ctx.prisma.projectMilestone.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectMilestoneUpdate,
        { id: 'missing', input: { name: 'Renamed' } },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectUpdateCreate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectUpdateCreate,
        { input: { body: 'x', bodyData: {}, health: 'onTrack', projectId: TEST_PROJECT.id } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectUpdateCreate,
        { input: { body: 'x', bodyData: {}, health: 'onTrack', projectId: 'missing' } },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectUpdateDelete', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectUpdateDelete,
        { id: TEST_PROJECT_UPDATE.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project update does not exist', async () => {
      ctx.prisma.projectUpdate.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectUpdateDelete,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND when the parent project belongs to a different org', async () => {
      ctx.prisma.projectUpdate.findUnique.mockResolvedValue(TEST_PROJECT_UPDATE);
      ctx.prisma.project.findUnique.mockResolvedValue({
        ...TEST_PROJECT,
        organizationId: 'other-org',
      });

      await testAuthGuard(
        projectResolvers.Mutation.projectUpdateDelete,
        { id: TEST_PROJECT_UPDATE.id },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.projectUpdateUpdate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Mutation.projectUpdateUpdate,
        { id: TEST_PROJECT_UPDATE.id, input: { body: 'edited' } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project update does not exist', async () => {
      ctx.prisma.projectUpdate.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        projectResolvers.Mutation.projectUpdateUpdate,
        { id: 'missing', input: { body: 'edited' } },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Query.project', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Query.project,
        { id: TEST_PROJECT.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the project does not exist', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue(null);

      await testAuthGuard(projectResolvers.Query.project, { id: 'missing' }, ctx, 'NOT_FOUND');
    });

    it('throws NOT_FOUND for cross-org access', async () => {
      ctx.prisma.project.findUnique.mockResolvedValue({
        ...TEST_PROJECT,
        organizationId: 'other-org',
      });

      await testAuthGuard(
        projectResolvers.Query.project,
        { id: TEST_PROJECT.id },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Query.projects', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        projectResolvers.Query.projects,
        {},
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });
  });
});
