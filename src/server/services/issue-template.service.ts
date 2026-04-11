import type { IssueTemplate, PrismaClient } from '../../generated/prisma';

export interface IssueTemplateCreateInput {
  teamId: string;
  name: string;
  description?: string;
  templateData?: object;
  isDefault?: boolean;
}

export interface IssueTemplateUpdateInput {
  name?: string;
  description?: string | null;
  templateData?: object;
  isDefault?: boolean;
}

export class IssueTemplateNotFoundError extends Error {
  constructor() {
    super('Issue template not found');
    this.name = 'IssueTemplateNotFoundError';
  }
}

export class IssueTemplateService {
  constructor(private prisma: PrismaClient) {}

  async create(
    input: IssueTemplateCreateInput,
    creatorId: string,
  ): Promise<IssueTemplate> {
    const { teamId, name, description, templateData, isDefault } = input;

    return this.prisma.$transaction(async tx => {
      if (isDefault) {
        // Unset isDefault on all other templates for this team
        await tx.issueTemplate.updateMany({
          data: { isDefault: false },
          where: { archivedAt: null, isDefault: true, teamId },
        });
      }

      return tx.issueTemplate.create({
        data: {
          creatorId,
          description: description ?? null,
          isDefault: isDefault ?? false,
          name,
          teamId,
          templateData: templateData ?? {},
        },
      });
    });
  }

  async update(
    id: string,
    input: IssueTemplateUpdateInput,
  ): Promise<IssueTemplate> {
    const existing = await this.prisma.issueTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new IssueTemplateNotFoundError();
    }

    const data: Record<string, unknown> = {};

    if ('name' in input && input.name !== undefined) {
      data.name = input.name;
    }
    if ('description' in input) {
      data.description = input.description;
    }
    if ('templateData' in input && input.templateData !== undefined) {
      data.templateData = input.templateData;
    }
    if ('isDefault' in input && input.isDefault !== undefined) {
      data.isDefault = input.isDefault;
    }

    if (data.isDefault === true) {
      return this.prisma.$transaction(async tx => {
        // Unset isDefault on all other templates for this team
        await tx.issueTemplate.updateMany({
          data: { isDefault: false },
          where: {
            archivedAt: null,
            id: { not: id },
            isDefault: true,
            teamId: existing.teamId,
          },
        });

        return tx.issueTemplate.update({ data, where: { id } });
      });
    }

    return this.prisma.issueTemplate.update({ data, where: { id } });
  }

  async archive(id: string): Promise<IssueTemplate> {
    const existing = await this.prisma.issueTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new IssueTemplateNotFoundError();
    }
    return this.prisma.issueTemplate.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async delete(id: string): Promise<IssueTemplate> {
    const existing = await this.prisma.issueTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new IssueTemplateNotFoundError();
    }
    return this.prisma.issueTemplate.delete({ where: { id } });
  }

  async findById(id: string): Promise<IssueTemplate | null> {
    return this.prisma.issueTemplate.findUnique({ where: { id } });
  }

  async findByTeamId(
    teamId: string,
    includeArchived = false,
  ): Promise<IssueTemplate[]> {
    return this.prisma.issueTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        teamId,
      },
    });
  }
}
