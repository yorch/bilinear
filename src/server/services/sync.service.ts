import type { Redis } from 'ioredis';
import type { PrismaClient, SyncAction } from '../../generated/prisma';

export type SyncActionType = 'I' | 'U' | 'D' | 'A';

export class SyncService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async createSyncAction(
    orgId: string,
    action: SyncActionType,
    modelName: string,
    modelId: string,
    data: object | null,
  ): Promise<SyncAction> {
    const syncAction = await this.prisma.syncAction.create({
      data: {
        action,
        data: data ?? undefined,
        modelId,
        modelName,
        organizationId: orgId,
      },
    });

    // Publish to Redis so WebSocket server can broadcast to connected clients
    await this.redis
      .publish(`sync:${orgId}`, JSON.stringify(serializeSyncAction(syncAction)))
      .catch(err => {
        // Non-fatal: Redis publish failure should not break the mutation
        console.error('[SyncService] Redis publish error:', err);
      });

    return syncAction;
  }

  async getBootstrapData(orgId: string) {
    const [
      organizations,
      teams,
      users,
      issues,
      workflowStates,
      issueLabels,
      labelAssignments,
      projects,
      projectMilestones,
      projectUpdates,
      lastSyncAction,
    ] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId } }),
      this.prisma.team.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.user.findMany({
        where: { orgMemberships: { some: { organizationId: orgId } } },
      }),
      this.prisma.issue.findMany({
        where: { archivedAt: null, organizationId: orgId, trashed: false },
      }),
      this.prisma.workflowState.findMany({
        where: { archivedAt: null, team: { organizationId: orgId } },
      }),
      this.prisma.issueLabel.findMany({
        where: { archivedAt: null, organizationId: orgId },
      }),
      this.prisma.issueLabelAssignment.findMany({
        where: {
          issue: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.project.findMany({
        where: { archivedAt: null, organizationId: orgId, trashed: false },
      }),
      this.prisma.projectMilestone.findMany({
        where: {
          archivedAt: null,
          project: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.projectUpdate.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        where: {
          project: { archivedAt: null, organizationId: orgId, trashed: false },
        },
      }),
      this.prisma.syncAction.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true },
        where: { organizationId: orgId },
      }),
    ]);

    // Denormalize label IDs onto each issue
    const labelIdsByIssue = new Map<string, string[]>();
    for (const a of labelAssignments) {
      const ids = labelIdsByIssue.get(a.issueId) ?? [];
      ids.push(a.labelId);
      labelIdsByIssue.set(a.issueId, ids);
    }

    return {
      issueLabels,
      issues: issues.map(i => ({
        ...i,
        labelIds: labelIdsByIssue.get(i.id) ?? [],
      })),
      lastSyncId: (lastSyncAction?.id ?? BigInt(0)).toString(),
      organizations: organizations ? [organizations] : [],
      projectMilestones,
      projects,
      projectUpdates,
      teams,
      users,
      workflowStates,
    };
  }

  async getDeltaSyncActions(
    orgId: string,
    lastSyncId: bigint,
    toSyncId?: bigint,
  ): Promise<SyncAction[]> {
    return this.prisma.syncAction.findMany({
      orderBy: { id: 'asc' },
      where: {
        id: {
          gt: lastSyncId,
          ...(toSyncId ? { lte: toSyncId } : {}),
        },
        organizationId: orgId,
      },
    });
  }

  async getLastSyncId(orgId: string): Promise<bigint> {
    const last = await this.prisma.syncAction.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
      where: { organizationId: orgId },
    });
    return last?.id ?? BigInt(0);
  }
}

/**
 * Serialize a SyncAction for JSON transport — BigInt id becomes a string.
 */
export function serializeSyncAction(action: SyncAction) {
  return {
    ...action,
    createdAt: action.createdAt.toISOString(),
    id: action.id.toString(),
  };
}
