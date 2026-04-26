import type { Cycle, PrismaClient } from '../../generated/prisma';

export interface CycleCreateInput {
  description?: string;
  endsAt: string;
  id?: string;
  name?: string;
  startsAt: string;
  teamId: string;
}

export interface CycleUpdateInput {
  description?: string | null;
  endsAt?: string;
  name?: string | null;
  startsAt?: string;
}

export class CycleNotFoundError extends Error {
  constructor() {
    super('Cycle not found');
    this.name = 'CycleNotFoundError';
  }
}

export class CycleOverlapError extends Error {
  constructor() {
    super('Cycle dates overlap with an existing cycle');
    this.name = 'CycleOverlapError';
  }
}

export class CycleInvalidDatesError extends Error {
  constructor() {
    super('Cycle end date must be after start date');
    this.name = 'CycleInvalidDatesError';
  }
}

export class CycleService {
  constructor(private prisma: PrismaClient) {}

  async create(orgId: string, input: CycleCreateInput): Promise<Cycle> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (endsAt <= startsAt) {
      throw new CycleInvalidDatesError();
    }

    return this.prisma.$transaction(async tx => {
      // Check for overlapping cycles on this team
      const overlap = await tx.cycle.findFirst({
        where: {
          archivedAt: null,
          endsAt: { gt: startsAt },
          startsAt: { lt: endsAt },
          teamId: input.teamId,
        },
      });
      if (overlap) {
        throw new CycleOverlapError();
      }

      // Get next cycle number for this team
      const lastCycle = await tx.cycle.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
        where: { teamId: input.teamId },
      });
      const number = (lastCycle?.number ?? 0) + 1;

      return tx.cycle.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          description: input.description ?? null,
          endsAt,
          name: input.name ?? null,
          number,
          organizationId: orgId,
          startsAt,
          teamId: input.teamId,
        },
      });
    });
  }

  async update(id: string, input: CycleUpdateInput): Promise<Cycle> {
    const data: Record<string, unknown> = {};

    if ('name' in input) {
      data.name = input.name;
    }
    if ('description' in input) {
      data.description = input.description;
    }
    if (input.startsAt !== undefined) {
      data.startsAt = new Date(input.startsAt);
    }
    if (input.endsAt !== undefined) {
      data.endsAt = new Date(input.endsAt);
    }

    if (data.startsAt || data.endsAt) {
      const existing = await this.prisma.cycle.findUnique({ where: { id } });
      if (!existing) {
        throw new CycleNotFoundError();
      }

      const newStart = (data.startsAt as Date) ?? existing.startsAt;
      const newEnd = (data.endsAt as Date) ?? existing.endsAt;

      if (newEnd <= newStart) {
        throw new CycleInvalidDatesError();
      }

      // Check for overlapping cycles (excluding self)
      const overlap = await this.prisma.cycle.findFirst({
        where: {
          archivedAt: null,
          endsAt: { gt: newStart },
          id: { not: id },
          startsAt: { lt: newEnd },
          teamId: existing.teamId,
        },
      });
      if (overlap) {
        throw new CycleOverlapError();
      }
    }

    return this.prisma.cycle.update({
      data,
      where: { id },
    });
  }

  async archive(id: string): Promise<Cycle> {
    return this.prisma.cycle.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async delete(id: string): Promise<Cycle> {
    // Unassign all issues from this cycle before deleting
    await this.prisma.issue.updateMany({
      data: { addedToCycleAt: null, cycleId: null },
      where: { cycleId: id },
    });
    return this.prisma.cycle.delete({ where: { id } });
  }

  async findById(id: string): Promise<Cycle | null> {
    return this.prisma.cycle.findUnique({ where: { id } });
  }

  async findByTeamId(teamId: string, includeArchived = false): Promise<Cycle[]> {
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        teamId,
      },
    });
  }

  async findByOrgId(orgId: string, includeArchived = false): Promise<Cycle[]> {
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        organizationId: orgId,
      },
    });
  }

  async getActiveCycle(teamId: string): Promise<Cycle | null> {
    const now = new Date();
    return this.prisma.cycle.findFirst({
      where: {
        archivedAt: null,
        completedAt: null,
        endsAt: { gt: now },
        startsAt: { lte: now },
        teamId,
      },
    });
  }

  async getUpcomingCycles(teamId: string): Promise<Cycle[]> {
    const now = new Date();
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'asc' },
      where: {
        archivedAt: null,
        startsAt: { gt: now },
        teamId,
      },
    });
  }

  async getCompletedCycles(teamId: string): Promise<Cycle[]> {
    const now = new Date();
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      where: {
        archivedAt: null,
        OR: [{ completedAt: { not: null } }, { endsAt: { lte: now } }],
        teamId,
      },
    });
  }

  /**
   * Roll over a cycle: mark it completed and move all incomplete issues
   * to the target cycle (or the next upcoming cycle for the team).
   * All mutations run in a single transaction to prevent partial rollover.
   */
  async rollover(
    orgId: string,
    cycleId: string,
  ): Promise<{
    movedCount: number;
    nextCycleId: string | null;
    movedIssueIds: string[];
  }> {
    const cycle = await this.prisma.cycle.findFirst({
      where: { id: cycleId, organizationId: orgId },
    });
    if (!cycle) {
      throw new CycleNotFoundError();
    }

    return this.prisma.$transaction(async tx => {
      // Mark the cycle completed
      await tx.cycle.update({
        data: { completedAt: new Date() },
        where: { id: cycleId },
      });

      // Find incomplete issues (not in completed/cancelled state)
      const incompleteIssues = await tx.issue.findMany({
        include: { state: { select: { type: true } } },
        where: {
          archivedAt: null,
          cycleId,
          trashed: false,
        },
      });

      const toMove = incompleteIssues.filter(
        i => i.state.type !== 'completed' && i.state.type !== 'canceled',
      );

      // Find next upcoming cycle for this org+team
      const now = new Date();
      const nextCycle = await tx.cycle.findFirst({
        orderBy: { startsAt: 'asc' },
        where: {
          archivedAt: null,
          id: { not: cycleId },
          organizationId: orgId,
          startsAt: { gte: now },
          teamId: cycle.teamId,
        },
      });

      if (toMove.length > 0 && nextCycle) {
        await tx.issue.updateMany({
          data: { addedToCycleAt: new Date(), cycleId: nextCycle.id },
          where: { id: { in: toMove.map(i => i.id) } },
        });
      } else if (toMove.length > 0) {
        // No next cycle — unassign issues
        await tx.issue.updateMany({
          data: { addedToCycleAt: null, cycleId: null },
          where: { id: { in: toMove.map(i => i.id) } },
        });
      }

      return {
        movedCount: toMove.length,
        movedIssueIds: toMove.map(i => i.id),
        nextCycleId: nextCycle?.id ?? null,
      };
    });
  }

  /**
   * Get velocity data for the last N completed cycles.
   */
  async getVelocity(
    teamId: string,
    cycleCount = 8,
  ): Promise<{
    averageIssues: number;
    cycles: Array<{
      cycleId: string;
      cycleNumber: number;
      completedIssues: number;
    }>;
  }> {
    const now = new Date();
    const completedCycles = await this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      take: cycleCount,
      where: {
        archivedAt: null,
        OR: [{ completedAt: { not: null } }, { endsAt: { lte: now } }],
        teamId,
      },
    });

    const cycles = await Promise.all(
      completedCycles.map(async cycle => {
        const completedIssues = await this.prisma.issue.count({
          where: {
            archivedAt: null,
            completedAt: { not: null },
            cycleId: cycle.id,
            trashed: false,
          },
        });
        return {
          completedIssues,
          cycleId: cycle.id,
          cycleNumber: cycle.number,
        };
      }),
    );

    const averageIssues =
      cycles.length > 0 ? cycles.reduce((sum, c) => sum + c.completedIssues, 0) / cycles.length : 0;

    return { averageIssues, cycles };
  }

  /**
   * Compute burndown data for a cycle using issue completedAt timestamps.
   */
  async getBurndown(
    cycleId: string,
  ): Promise<Array<{ date: string; remaining: number; completed: number }>> {
    const cycle = await this.prisma.cycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) {
      return [];
    }

    const issues = await this.prisma.issue.findMany({
      select: { completedAt: true, id: true },
      where: { archivedAt: null, cycleId, trashed: false },
    });

    const totalIssues = issues.length;
    if (totalIssues === 0) {
      return [];
    }

    const start = new Date(cycle.startsAt);
    const end = new Date(Math.min(cycle.endsAt.getTime(), Date.now()));

    // Sort completed timestamps ascending once — O(n log n) — then walk a
    // single pointer through them as days advance, giving O(days + n) total
    // instead of O(days × n).
    const completedDates = issues
      .filter(i => i.completedAt !== null)
      .map(i => i.completedAt as Date)
      .sort((a, b) => a.getTime() - b.getTime());

    const points: Array<{
      date: string;
      remaining: number;
      completed: number;
    }> = [];
    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);
    let completedIdx = 0;

    while (current <= end) {
      const dayEnd = new Date(current);
      dayEnd.setUTCHours(23, 59, 59, 999);

      while (completedIdx < completedDates.length && completedDates[completedIdx] <= dayEnd) {
        completedIdx++;
      }

      points.push({
        completed: completedIdx,
        date: current.toISOString().slice(0, 10),
        remaining: totalIssues - completedIdx,
      });

      current.setUTCDate(current.getUTCDate() + 1);
    }

    return points;
  }

  async addIssueToCycle(cycleId: string, issueId: string): Promise<void> {
    await this.prisma.issue.update({
      data: { addedToCycleAt: new Date(), cycleId },
      where: { id: issueId },
    });
  }

  async removeIssueFromCycle(issueId: string): Promise<void> {
    await this.prisma.issue.update({
      data: { addedToCycleAt: null, cycleId: null },
      where: { id: issueId },
    });
  }

  async getProgress(cycleId: string): Promise<{ progress: number; scope: number }> {
    const issues = await this.prisma.issue.findMany({
      include: { state: { select: { type: true } } },
      where: { archivedAt: null, cycleId, trashed: false },
    });

    const scope = issues.length;
    const completed = issues.filter(
      i => i.state.type === 'completed' || i.state.type === 'canceled',
    ).length;

    return {
      progress: scope > 0 ? completed / scope : 0,
      scope,
    };
  }

  /**
   * Auto-create upcoming cycles for a team based on its cycle configuration.
   * Creates cycles up to the specified count into the future.
   */
  async autoCreateUpcomingCycles(orgId: string, teamId: string, count = 15): Promise<Cycle[]> {
    const team = await this.prisma.team.findUnique({
      select: {
        cycleCooldownTime: true,
        cycleDuration: true,
        cycleStartDay: true,
        cyclesEnabled: true,
      },
      where: { id: teamId },
    });

    if (!team?.cyclesEnabled) {
      return [];
    }

    const durationWeeks = team.cycleDuration ?? 2;
    const cooldownDays = team.cycleCooldownTime ?? 0;

    // Find the latest cycle to start from
    const latestCycle = await this.prisma.cycle.findFirst({
      orderBy: { endsAt: 'desc' },
      where: { archivedAt: null, teamId },
    });

    const existingUpcoming = await this.getUpcomingCycles(teamId);
    const toCreate = count - existingUpcoming.length;
    if (toCreate <= 0) {
      return [];
    }

    let nextStart: Date;
    if (latestCycle) {
      nextStart = new Date(latestCycle.endsAt);
      nextStart.setDate(nextStart.getDate() + cooldownDays);
    } else {
      nextStart = new Date();
      // Align to the team's start day (1=Monday, 7=Sunday)
      const startDay = team.cycleStartDay ?? 1;
      const currentDay = nextStart.getDay() || 7; // Convert 0 (Sunday) to 7
      const daysUntilStart = (startDay - currentDay + 7) % 7;
      nextStart.setDate(nextStart.getDate() + daysUntilStart);
      nextStart.setHours(0, 0, 0, 0);
    }

    // Build all cycle date ranges first, then create them in a single
    // transaction to prevent overlapping cycles from concurrent calls.
    const ranges: Array<{ startsAt: Date; endsAt: Date }> = [];
    for (let i = 0; i < toCreate; i++) {
      const endsAt = new Date(nextStart);
      endsAt.setDate(endsAt.getDate() + durationWeeks * 7);
      ranges.push({ endsAt, startsAt: new Date(nextStart) });
      nextStart = new Date(endsAt);
      nextStart.setDate(nextStart.getDate() + cooldownDays);
    }

    return this.prisma.$transaction(async tx => {
      const created: Cycle[] = [];

      // Get the current max cycle number inside the transaction
      const lastCycle = await tx.cycle.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
        where: { teamId },
      });
      let nextNumber = (lastCycle?.number ?? 0) + 1;

      for (const range of ranges) {
        const cycle = await tx.cycle.create({
          data: {
            endsAt: range.endsAt,
            number: nextNumber,
            organizationId: orgId,
            startsAt: range.startsAt,
            teamId,
          },
        });
        created.push(cycle);
        nextNumber++;
      }

      return created;
    });
  }
}
