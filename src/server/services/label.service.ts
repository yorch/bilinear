import type { IssueLabel, PrismaClient } from '../../generated/prisma';

export interface LabelCreateInput {
  color: string;
  description?: string;
  id?: string;
  isGroup?: boolean;
  name: string;
  parentId?: string;
  teamId?: string;
}

export interface LabelUpdateInput {
  color?: string;
  description?: string;
  name?: string;
  parentId?: string | null;
}

export class LabelService {
  constructor(private prisma: PrismaClient) {}

  async create(orgId: string, creatorId: string, input: LabelCreateInput): Promise<IssueLabel> {
    return this.prisma.issueLabel.create({
      data: {
        color: input.color,
        creatorId,
        description: input.description,
        id: input.id ?? undefined,
        isGroup: input.isGroup ?? false,
        name: input.name,
        organizationId: orgId,
        parentId: input.parentId,
        teamId: input.teamId,
      },
    });
  }

  async findById(id: string): Promise<IssueLabel | null> {
    return this.prisma.issueLabel.findUnique({ where: { id } });
  }

  async findByOrgId(orgId: string, teamId?: string): Promise<IssueLabel[]> {
    return this.prisma.issueLabel.findMany({
      orderBy: { name: 'asc' },
      where: {
        archivedAt: null,
        organizationId: orgId,
        // Return workspace-global labels + optionally team-scoped ones
        ...(teamId ? { OR: [{ teamId: null }, { teamId }] } : { teamId: null }),
      },
    });
  }

  async update(id: string, input: LabelUpdateInput): Promise<IssueLabel> {
    return this.prisma.issueLabel.update({
      data: {
        color: input.color,
        description: input.description,
        name: input.name,
        parentId: input.parentId,
      },
      where: { id },
    });
  }

  async archive(id: string): Promise<IssueLabel> {
    return this.prisma.issueLabel.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }
}
