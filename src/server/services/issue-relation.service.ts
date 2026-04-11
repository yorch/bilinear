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

function inverseType(type: IssueRelationType): IssueRelationType | null {
  if (type === 'blocks') {
    return 'blocked_by';
  }
  if (type === 'blocked_by') {
    return 'blocks';
  }
  if (type === 'duplicate') {
    return 'duplicate';
  }
  return null; // 'related' has no directed inverse
}

export class IssueRelationService {
  constructor(private prisma: PrismaClient) {}

  async create(input: IssueRelationCreateInput): Promise<IssueRelation> {
    const { issueId, relatedIssueId, type } = input;

    // Self-relation check can stay outside — no race risk here
    if (issueId === relatedIssueId) {
      throw new IssueRelationCircularError();
    }

    return this.prisma.$transaction(async tx => {
      // Circular block check: A blocks B cannot coexist with B blocks A (and same for blocked_by).
      // Runs inside the transaction to close the TOCTOU window.
      if (type === 'blocks' || type === 'blocked_by') {
        const circular = await tx.issueRelation.findUnique({
          where: {
            issueId_relatedIssueId_type: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type,
            },
          },
        });
        if (circular) {
          throw new IssueRelationCircularError();
        }
      }

      // Duplicate relation check
      const existing = await tx.issueRelation.findUnique({
        where: {
          issueId_relatedIssueId_type: { issueId, relatedIssueId, type },
        },
      });
      if (existing) {
        throw new IssueRelationAlreadyExistsError();
      }

      const relation = await tx.issueRelation.create({
        data: { issueId, relatedIssueId, type },
      });

      // Auto-create inverse relation
      const inv = inverseType(type);
      if (inv) {
        const inverseExists = await tx.issueRelation.findUnique({
          where: {
            issueId_relatedIssueId_type: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: inv,
            },
          },
        });
        if (!inverseExists) {
          await tx.issueRelation.create({
            data: {
              issueId: relatedIssueId,
              relatedIssueId: issueId,
              type: inv,
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

    return this.prisma.$transaction(async tx => {
      // Delete the auto-created inverse relation if one exists
      const inv = inverseType(relation.type as IssueRelationType);
      if (inv) {
        await tx.issueRelation.deleteMany({
          where: {
            issueId: relation.relatedIssueId,
            relatedIssueId: relation.issueId,
            type: inv,
          },
        });
      }
      return tx.issueRelation.delete({ where: { id } });
    });
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
