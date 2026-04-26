import type { CustomView, PrismaClient } from '../../generated/prisma';

export interface CustomViewCreateInput {
  color?: string;
  description?: string;
  filters?: object;
  groupBy?: string;
  icon?: string;
  id?: string;
  layout?: string;
  name: string;
  shared?: boolean;
  sort?: object;
  sortOrder?: number;
  teamId?: string;
}

export interface CustomViewUpdateInput {
  color?: string | null;
  description?: string | null;
  filters?: object;
  groupBy?: string | null;
  icon?: string | null;
  layout?: string;
  name?: string;
  shared?: boolean;
  sort?: object;
  sortOrder?: number;
}

export class CustomViewService {
  constructor(private prisma: PrismaClient) {}

  async create(
    orgId: string,
    creatorId: string,
    input: CustomViewCreateInput,
  ): Promise<CustomView> {
    return this.prisma.customView.create({
      data: {
        color: input.color,
        creatorId,
        description: input.description,
        filters: (input.filters as object) ?? {},
        groupBy: input.groupBy,
        icon: input.icon,
        id: input.id ?? undefined,
        layout: input.layout ?? 'list',
        name: input.name,
        organizationId: orgId,
        shared: input.shared ?? false,
        sort: (input.sort as object) ?? [],
        sortOrder: input.sortOrder ?? 0,
        teamId: input.teamId,
      },
    });
  }

  async findById(id: string): Promise<CustomView | null> {
    return this.prisma.customView.findUnique({ where: { id } });
  }

  async findByOrgId(orgId: string, userId: string, teamId?: string): Promise<CustomView[]> {
    return this.prisma.customView.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      where: {
        archivedAt: null,
        organizationId: orgId,
        ...(teamId ? { teamId } : {}),
        OR: [{ creatorId: userId }, { shared: true }],
      },
    });
  }

  async update(id: string, input: CustomViewUpdateInput): Promise<CustomView> {
    const data: Record<string, unknown> = {};

    if (input.name !== undefined) {
      data.name = input.name;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if (input.icon !== undefined) {
      data.icon = input.icon;
    }
    if (input.color !== undefined) {
      data.color = input.color;
    }
    if (input.filters !== undefined) {
      data.filters = input.filters;
    }
    if (input.sort !== undefined) {
      data.sort = input.sort;
    }
    if (input.groupBy !== undefined) {
      data.groupBy = input.groupBy;
    }
    if (input.layout !== undefined) {
      data.layout = input.layout;
    }
    if (input.shared !== undefined) {
      data.shared = input.shared;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }

    return this.prisma.customView.update({
      data,
      where: { id },
    });
  }

  async archive(id: string): Promise<CustomView> {
    return this.prisma.customView.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async delete(id: string): Promise<CustomView> {
    return this.prisma.customView.delete({ where: { id } });
  }
}
