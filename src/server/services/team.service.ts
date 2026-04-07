import type {
  PrismaClient,
  Team,
  TeamMembership,
} from '../../generated/prisma';

// Prisma's $transaction callback receives a lighter client (without $connect, etc.)
// This type alias works with both PrismaClient and the transaction client.
type PrismaLike = Pick<
  PrismaClient,
  'team' | 'teamMembership' | 'workflowState'
>;

const TEAM_KEY_PATTERN = /^[A-Z]{1,10}$/;

const DEFAULT_WORKFLOW_STATES = [
  { color: '#bec2c8', name: 'Backlog', position: 0, type: 'backlog' },
  { color: '#e2e2e2', name: 'Todo', position: 1, type: 'unstarted' },
  { color: '#f2c94c', name: 'In Progress', position: 2, type: 'started' },
  { color: '#5e6ad2', name: 'Done', position: 3, type: 'completed' },
  { color: '#95a2b3', name: 'Canceled', position: 4, type: 'canceled' },
];

const TRIAGE_STATE = {
  color: '#e2e2e2',
  name: 'Triage',
  position: 0,
  type: 'triage',
};

export interface TeamCreateInput {
  color?: string;
  description?: string;
  icon?: string;
  id?: string;
  key: string;
  name: string;
  private?: boolean;
  timezone?: string;
  triageEnabled?: boolean;
}

export interface TeamUpdateInput {
  autoArchivePeriod?: number;
  autoClosePeriod?: number;
  color?: string;
  cycleDuration?: number;
  cyclesEnabled?: boolean;
  description?: string;
  icon?: string;
  issueEstimationType?: string;
  name?: string;
  private?: boolean;
  timezone?: string;
  triageEnabled?: boolean;
}

export class TeamService {
  constructor(private prisma: PrismaClient) {}

  async create(
    orgId: string,
    userId: string,
    input: TeamCreateInput,
  ): Promise<Team> {
    this.validateKey(input.key);

    return this.prisma.$transaction(async tx => {
      const team = await tx.team.create({
        data: {
          color: input.color,
          description: input.description,
          displayName: input.name,
          icon: input.icon,
          id: input.id,
          key: input.key,
          name: input.name,
          organizationId: orgId,
          private: input.private ?? false,
          timezone: input.timezone ?? 'UTC',
          triageEnabled: input.triageEnabled ?? false,
        },
      });

      await this.seedDefaultStates(tx, team.id, input.triageEnabled ?? false);

      // Add creator as team owner
      await tx.teamMembership.create({
        data: {
          isOwner: true,
          teamId: team.id,
          userId,
        },
      });

      return team;
    });
  }

  async findById(id: string): Promise<Team | null> {
    return this.prisma.team.findUnique({ where: { id } });
  }

  async findByOrgId(orgId: string): Promise<Team[]> {
    return this.prisma.team.findMany({
      orderBy: { name: 'asc' },
      where: { archivedAt: null, organizationId: orgId },
    });
  }

  async update(id: string, input: TeamUpdateInput): Promise<Team> {
    return this.prisma.team.update({
      data: {
        autoArchivePeriod: input.autoArchivePeriod,
        autoClosePeriod: input.autoClosePeriod,
        color: input.color,
        cycleDuration: input.cycleDuration,
        cyclesEnabled: input.cyclesEnabled,
        description: input.description,
        // Also update displayName when name changes
        displayName: input.name,
        icon: input.icon,
        issueEstimationType: input.issueEstimationType,
        name: input.name,
        private: input.private,
        timezone: input.timezone,
        triageEnabled: input.triageEnabled,
      },
      where: { id },
    });
  }

  async delete(id: string): Promise<Team> {
    return this.prisma.team.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async addMember(
    teamId: string,
    userId: string,
    isOwner = false,
  ): Promise<TeamMembership> {
    return this.prisma.teamMembership.create({
      data: { isOwner, teamId, userId },
    });
  }

  async updateMembership(
    id: string,
    input: { isOwner?: boolean; sortOrder?: number },
  ): Promise<TeamMembership> {
    return this.prisma.teamMembership.update({
      data: {
        isOwner: input.isOwner,
        sortOrder: input.sortOrder,
      },
      where: { id },
    });
  }

  async removeMember(id: string): Promise<TeamMembership> {
    return this.prisma.teamMembership.delete({ where: { id } });
  }

  async getMembers(teamId: string): Promise<TeamMembership[]> {
    return this.prisma.teamMembership.findMany({
      include: { user: true },
      orderBy: { sortOrder: 'asc' },
      where: { teamId },
    });
  }

  async findMembershipWithTeam(
    id: string,
  ): Promise<(TeamMembership & { team: Team }) | null> {
    return this.prisma.teamMembership.findUnique({
      include: { team: true },
      where: { id },
    });
  }

  async findChildren(parentId: string): Promise<Team[]> {
    return this.prisma.team.findMany({
      where: { archivedAt: null, parentId },
    });
  }

  private validateKey(key: string): void {
    if (!TEAM_KEY_PATTERN.test(key)) {
      throw new TeamKeyInvalidError();
    }
  }

  private async seedDefaultStates(
    tx: PrismaLike,
    teamId: string,
    triageEnabled: boolean,
  ): Promise<void> {
    const states = triageEnabled
      ? [
          TRIAGE_STATE,
          ...DEFAULT_WORKFLOW_STATES.map(s => ({
            ...s,
            position: s.position + 1,
          })),
        ]
      : DEFAULT_WORKFLOW_STATES;

    await Promise.all(
      states.map(state =>
        tx.workflowState.create({
          data: { ...state, teamId },
        }),
      ),
    );
  }
}

export class TeamKeyInvalidError extends Error {
  constructor() {
    super('Team key must be 1-10 uppercase characters');
    this.name = 'TeamKeyInvalidError';
  }
}
