import type { IssueRelation, PrismaClient } from '../../generated/prisma';

export type IssueRelationType =
  | 'related'
  | 'blocks'
  | 'blocked_by'
  | 'duplicate';

export interface IssueRelationCreateInput {
  issueId: string;
  relatedIssueId: string;
  type: IssueRelationType;
}

export class IssueRelationNotFoundError extends Error {
  constructor() {
    super('Issue relation not found');
    this.name = 'IssueRelationNotFoundError';
  }
}

export class IssueRelationAlreadyExistsError extends Error {
  constructor() {
    super('Issue relation already exists');
    this.name = 'IssueRelationAlreadyExistsError';
  }
}

export class IssueRelationCircularError extends Error {
  constructor() {
    super('Circular block relation detected');
    this.name = 'IssueRelationCircularError';
  }
}

export class IssueRelationService {
  constructor(private prisma: PrismaClient) {}

  async create(input: IssueRelationCreateInput): Promise<IssueRelation> {
    const { issueId, relatedIssueId, type } = input;

    // Prevent self-relations
    if (issueId === relatedIssueId) {
      throw new IssueRelationCircularError();
    }

    // Check for circular blocks: if A blocks B, B cannot block A
    if (type === 'blocks') {
      const circular = await this.prisma.issueRelation.findUnique({
        where: {
          issueId_relatedIssueId_type: {
            issueId: relatedIssueId,
            relatedIssueId: issueId,
            type: 'blocks',
          },
        },
      });
      if (circular) {
        throw new IssueRelationCircularError();
      }
    }

    if (type === 'blocked_by') {
      const circular = await this.prisma.issueRelation.findUnique({
        where: {
          issueId_relatedIssueId_type: {
            issueId: relatedIssueId,
            relatedIssueId: issueId,
            type: 'blocked_by',
          },
        },
      });
      if (circular) {
        throw new IssueRelationCircularError();
      }
    }

    // Check for duplicate relation
    const existing = await this.prisma.issueRelation.findUnique({
      where: { issueId_relatedIssueId_type: { issueId, relatedIssueId, type } },
    });
    if (existing) {
      throw new IssueRelationAlreadyExistsError();
    }

    return this.prisma.$transaction(async tx => {
      const relation = await tx.issueRelation.create({
        data: { issueId, relatedIssueId, type },
      });

      // Auto-create inverse relation
      if (type === 'blocks') {
        const inverseExists = await tx.issueRelation.findUnique({
          where: {
            issueId_relatedIssueId_type: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: 'blocked_by',
            },
          },
        });
        if (!inverseExists) {
          await tx.issueRelation.create({
            data: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: 'blocked_by',
            },
          });
        }
      } else if (type === 'blocked_by') {
        const inverseExists = await tx.issueRelation.findUnique({
          where: {
            issueId_relatedIssueId_type: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: 'blocks',
            },
          },
        });
        if (!inverseExists) {
          await tx.issueRelation.create({
            data: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: 'blocks',
            },
          });
        }
      } else if (type === 'duplicate') {
        const inverseExists = await tx.issueRelation.findUnique({
          where: {
            issueId_relatedIssueId_type: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: 'duplicate',
            },
          },
        });
        if (!inverseExists) {
          await tx.issueRelation.create({
            data: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: 'duplicate',
            },
          });
        }
      }

      return relation;
    });
  }

  async delete(id: string): Promise<IssueRelation> {
    const relation = await this.prisma.issueRelation.findUnique({
      where: { id },
    });
    if (!relation) {
      throw new IssueRelationNotFoundError();
    }
    return this.prisma.issueRelation.delete({ where: { id } });
  }

  async findById(id: string): Promise<IssueRelation | null> {
    return this.prisma.issueRelation.findUnique({ where: { id } });
  }

  async findByIssueId(issueId: string): Promise<IssueRelation[]> {
    return this.prisma.issueRelation.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        OR: [{ issueId }, { relatedIssueId: issueId }],
      },
    });
  }

  async findRelationsForIssues(issueIds: string[]): Promise<IssueRelation[]> {
    return this.prisma.issueRelation.findMany({
      orderBy: { createdAt: 'asc' },
      where: {
        OR: [
          { issueId: { in: issueIds } },
          { relatedIssueId: { in: issueIds } },
        ],
      },
    });
  }
}
