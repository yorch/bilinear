import { beforeEach, describe, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ISSUE, TEST_ORG, TEST_TEAM, TEST_USER } from '../../../test/fixtures';
import {
  CustomFieldDefinitionNotFoundError,
  CustomFieldInvalidOptionsError,
  CustomFieldInvalidValueError,
  CustomFieldLimitExceededError,
  CustomFieldService,
} from '../../services/custom-field.service';
import { customFieldResolvers } from './custom-field';

const TEST_DEFINITION = {
  archivedAt: null,
  createdAt: new Date('2026-02-01T00:00:00Z'),
  description: null,
  id: '00000000-0000-0000-0000-000000000800',
  name: 'Severity',
  options: null,
  organizationId: TEST_ORG.id,
  required: false,
  sortOrder: 0,
  teamId: TEST_TEAM.id,
  type: 'select',
  updatedAt: new Date('2026-02-01T00:00:00Z'),
};

// `MockGraphQLContext` (src/test/context-mock.ts) doesn't wire up
// `CustomFieldService` — only resolvers that were already under test when
// that mock was built are registered there. Rather than touching shared
// test infra (out of scope for this sweep), build a superset context here
// that adds a real `CustomFieldService` instance over the same mock Prisma
// client.
type CtxWithCustomField = MockGraphQLContext & {
  services: MockGraphQLContext['services'] & { customField: CustomFieldService };
};

function createCtx(
  overrides?: Partial<{ orgId: string | null; userId: string | null }>,
): CtxWithCustomField {
  const base = createMockContext(overrides);
  return {
    ...base,
    services: { ...base.services, customField: new CustomFieldService(base.prisma as never) },
  };
}

describe('customFieldResolvers', () => {
  let ctx: CtxWithCustomField;

  beforeEach(() => {
    ctx = createCtx();
  });

  describe('Mutation.customFieldDefinitionArchive', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionArchive,
        { id: TEST_DEFINITION.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the definition does not exist', async () => {
      ctx.prisma.customFieldDefinition.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionArchive,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the team-scoped definition team', async () => {
      ctx.prisma.customFieldDefinition.findUnique.mockResolvedValue(TEST_DEFINITION);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionArchive,
        { id: TEST_DEFINITION.id },
        ctx,
        'FORBIDDEN',
      );
    });

    it('throws FORBIDDEN when the caller is not owner/admin for a workspace-scoped definition', async () => {
      ctx.prisma.customFieldDefinition.findUnique.mockResolvedValue({
        ...TEST_DEFINITION,
        teamId: null,
      });
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = 'member';

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionArchive,
        { id: TEST_DEFINITION.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Mutation.customFieldDefinitionCreate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionCreate,
        { input: { name: 'Severity', teamId: TEST_TEAM.id, type: 'select' } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws BAD_USER_INPUT when teamId is omitted', async () => {
      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionCreate,
        // biome-ignore lint/suspicious/noExplicitAny: exercising a missing required field
        { input: { name: 'Severity', type: 'select' } as any },
        ctx,
        'BAD_USER_INPUT',
      );
    });

    it('throws FORBIDDEN when creating a workspace-scoped definition without owner/admin role', async () => {
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = 'member';

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionCreate,
        { input: { name: 'Severity', teamId: null, type: 'select' } },
        ctx,
        'FORBIDDEN',
      );
    });

    it('throws NOT_FOUND when the team-scoped teamId does not resolve to a team in this org', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.team.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionCreate,
        { input: { name: 'Severity', teamId: TEST_TEAM.id, type: 'select' } },
        ctx,
        'NOT_FOUND',
      );
    });

    it('remaps CustomFieldLimitExceededError to BAD_USER_INPUT', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      vi.spyOn(ctx.services.customField, 'createDefinition').mockRejectedValue(
        new CustomFieldLimitExceededError(),
      );

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionCreate,
        { input: { name: 'Severity', teamId: TEST_TEAM.id, type: 'select' } },
        ctx,
        'BAD_USER_INPUT',
      );
    });

    it('remaps CustomFieldInvalidOptionsError to BAD_USER_INPUT', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      vi.spyOn(ctx.services.customField, 'createDefinition').mockRejectedValue(
        new CustomFieldInvalidOptionsError('duplicate values'),
      );

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionCreate,
        { input: { name: 'Severity', teamId: TEST_TEAM.id, type: 'select' } },
        ctx,
        'BAD_USER_INPUT',
      );
    });
  });

  describe('Mutation.customFieldDefinitionDelete', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionDelete,
        { id: TEST_DEFINITION.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the definition does not exist', async () => {
      ctx.prisma.customFieldDefinition.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionDelete,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('remaps CustomFieldDefinitionNotFoundError to NOT_FOUND on a service-level race', async () => {
      ctx.prisma.customFieldDefinition.findUnique.mockResolvedValue(TEST_DEFINITION);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.customField, 'deleteDefinition').mockRejectedValue(
        new CustomFieldDefinitionNotFoundError(),
      );

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionDelete,
        { id: TEST_DEFINITION.id },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.customFieldDefinitionUpdate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionUpdate,
        { id: TEST_DEFINITION.id, input: { name: 'Renamed' } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('remaps CustomFieldInvalidOptionsError to BAD_USER_INPUT', async () => {
      ctx.prisma.customFieldDefinition.findUnique.mockResolvedValue(TEST_DEFINITION);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.customField, 'updateDefinition').mockRejectedValue(
        new CustomFieldInvalidOptionsError('duplicate values'),
      );

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldDefinitionUpdate,
        { id: TEST_DEFINITION.id, input: { options: [] } },
        ctx,
        'BAD_USER_INPUT',
      );
    });
  });

  describe('Mutation.customFieldValuesSet', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldValuesSet,
        { issueId: TEST_ISSUE.id, values: [] },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldValuesSet,
        { issueId: 'missing', values: [] },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the issue team', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldValuesSet,
        { issueId: TEST_ISSUE.id, values: [] },
        ctx,
        'FORBIDDEN',
      );
    });

    it('remaps CustomFieldInvalidValueError to BAD_USER_INPUT', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.customField, 'setValuesForIssue').mockRejectedValue(
        new CustomFieldInvalidValueError('expected string'),
      );

      await testAuthGuard(
        customFieldResolvers.Mutation.customFieldValuesSet,
        { issueId: TEST_ISSUE.id, values: [{ definitionId: TEST_DEFINITION.id, value: 1 }] },
        ctx,
        'BAD_USER_INPUT',
      );
    });
  });

  describe('Query.customFieldDefinition', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Query.customFieldDefinition,
        { id: TEST_DEFINITION.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the definition does not exist', async () => {
      ctx.prisma.customFieldDefinition.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Query.customFieldDefinition,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Query.customFieldDefinitions', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Query.customFieldDefinitions,
        { teamId: TEST_TEAM.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the team', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Query.customFieldDefinitions,
        { teamId: TEST_TEAM.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Query.customFieldValuesForIssue', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Query.customFieldValuesForIssue,
        { issueId: TEST_ISSUE.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        customFieldResolvers.Query.customFieldValuesForIssue,
        { issueId: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Query.workspaceCustomFieldDefinitions', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        customFieldResolvers.Query.workspaceCustomFieldDefinitions,
        {},
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });
  });
});
