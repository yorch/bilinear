import type { IssueActivity, PrismaClient } from '../../generated/prisma';

export interface IssueActivityCreateInput {
  actorId?: string;
  field: string;
  issueId: string;
  newValue?: string;
  oldValue?: string;
}

export class IssueActivityService {
  constructor(private prisma: PrismaClient) {}

  async create(input: IssueActivityCreateInput): Promise<IssueActivity> {
    return this.prisma.issueActivity.create({
      data: {
        actorId: input.actorId ?? null,
        field: input.field,
        issueId: input.issueId,
        newValue: input.newValue ?? null,
        oldValue: input.oldValue ?? null,
      },
    });
  }

  async findByIssueId(issueId: string, limit = 100): Promise<IssueActivity[]> {
    return this.prisma.issueActivity.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      where: { issueId },
    });
  }

  async createMany(activities: IssueActivityCreateInput[]): Promise<IssueActivity[]> {
    if (activities.length === 0) {
      return [];
    }

    return this.prisma.$transaction(async tx =>
      Promise.all(
        activities.map(input =>
          tx.issueActivity.create({
            data: {
              actorId: input.actorId ?? null,
              field: input.field,
              issueId: input.issueId,
              newValue: input.newValue ?? null,
              oldValue: input.oldValue ?? null,
            },
          }),
        ),
      ),
    );
  }
}
