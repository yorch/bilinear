import { vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma';

type MockModel = {
  aggregate: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

function createMockModel(): MockModel {
  return {
    aggregate: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  };
}

export type MockPrismaClient = {
  [K in keyof PrismaClient]: K extends
    | 'authToken'
    | 'comment'
    | 'commentReaction'
    | 'customFieldDefinition'
    | 'customFieldValue'
    | 'customView'
    | 'cycle'
    | 'document'
    | 'issue'
    | 'issueActivity'
    | 'issueLabel'
    | 'issueLabelAssignment'
    | 'issueRelation'
    | 'issueTemplate'
    | 'notification'
    | 'notificationSubscription'
    | 'organization'
    | 'organizationMember'
    | 'project'
    | 'publicRoadmap'
    | 'team'
    | 'teamMemberRole'
    | 'teamMembership'
    | 'user'
    | 'workflowState'
    ? MockModel
    : PrismaClient[K];
} & {
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

export function createMockPrisma(): MockPrismaClient {
  const mock = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(
      async (fn: (tx: MockPrismaClient) => Promise<unknown>) => {
        // By default, $transaction passes itself so the callback uses the same mock
        return fn(mock as MockPrismaClient);
      },
    ),
    authToken: createMockModel(),
    comment: createMockModel(),
    commentReaction: createMockModel(),
    customFieldDefinition: createMockModel(),
    customFieldValue: createMockModel(),
    customView: createMockModel(),
    cycle: createMockModel(),
    document: createMockModel(),
    issue: createMockModel(),
    issueActivity: createMockModel(),
    issueLabel: createMockModel(),
    issueLabelAssignment: createMockModel(),
    issueRelation: createMockModel(),
    issueTemplate: createMockModel(),
    notification: createMockModel(),
    notificationSubscription: createMockModel(),
    organization: createMockModel(),
    organizationMember: createMockModel(),
    project: createMockModel(),
    publicRoadmap: createMockModel(),
    team: createMockModel(),
    teamMemberRole: createMockModel(),
    teamMembership: createMockModel(),
    user: createMockModel(),
    workflowState: createMockModel(),
  } as unknown as MockPrismaClient;

  return mock;
}
