import type {
  Issue,
  PrismaClient,
  Team,
  TeamMembership,
  WorkflowState,
} from '../../generated/prisma';

// Prisma's $transaction callback receives a lighter client (without $connect, etc.)
// This type alias works with both PrismaClient and the transaction client.
type PrismaLike = Pick<
  PrismaClient,
  'issue' | 'team' | 'teamMembership' | 'workflowState'
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

export interface TeamDeleteInput {
  issueAction: 'DELETE' | 'MOVE';
  moveToTeamId?: string;
}

export class TeamService {
  constructor(private prisma: PrismaClient) {}

  async create(
    orgId: string,
    userId: string,
    input: TeamCreateInput,
  ): Promise<{ states: WorkflowState[]; team: Team }> {
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

      const states = await this.seedDefaultStates(tx, team.id, input.triageEnabled ?? false);

      // Add creator as team owner
      await tx.teamMembership.create({
        data: {
          isOwner: true,
          teamId: team.id,
          userId,
        },
      });

      // Re-read team to include the updated defaultIssueStateId
      const updatedTeam = await tx.team.findUnique({ where: { id: team.id } });
      return { states, team: updatedTeam ?? team };
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

  async delete(id: string, input: TeamDeleteInput): Promise<{ movedIssues: Issue[]; team: Team }> {
    if (input.issueAction === 'MOVE' && !input.moveToTeamId) {
      throw new TeamDeleteMoveTargetRequiredError();
    }
    if (input.moveToTeamId === id) {
      throw new TeamDeleteMoveToSelfError();
    }

    return this.prisma.$transaction(async tx => {
      let movedIssues: Issue[] = [];

      if (input.issueAction === 'MOVE' && input.moveToTeamId) {
        movedIssues = await this.moveIssuesToTeam(tx, id, input.moveToTeamId);
      } else {
        // Soft-delete all issues belonging to this team
        await tx.issue.updateMany({
          data: { archivedAt: new Date() },
          where: { teamId: id, archivedAt: null },
        });
      }

      const team = await tx.team.update({
        data: { archivedAt: new Date() },
        where: { id },
      });

      return { movedIssues, team };
    });
  }

  private async moveIssuesToTeam(
    tx: PrismaLike,
    sourceTeamId: string,
    targetTeamId: string,
  ): Promise<Issue[]> {
    const targetTeam = await tx.team.findUnique({
      where: { id: targetTeamId },
    });
    if (!targetTeam) {
      throw new TeamNotFoundError();
    }

    // Build state type mapping: source state id → target state id
    const [sourceStates, targetStates] = await Promise.all([
      tx.workflowState.findMany({ where: { teamId: sourceTeamId, archivedAt: null } }),
      tx.workflowState.findMany({ where: { teamId: targetTeamId, archivedAt: null } }),
    ]);

    const stateMap = new Map<string, string>();
    for (const src of sourceStates) {
      const match = targetStates.find(t => t.type === src.type);
      if (match) {
        stateMap.set(src.id, match.id);
      }
    }
    // Fallback: if no match by type, map to the target team's default or first backlog state
    const fallbackStateId =
      targetTeam.defaultIssueStateId ??
      targetStates.find(s => s.type === 'backlog')?.id ??
      targetStates[0]?.id;

    if (!fallbackStateId) {
      throw new TeamDeleteMoveNoStatesError();
    }

    // Get all active issues from the source team
    const issues = await tx.issue.findMany({
      where: { teamId: sourceTeamId, archivedAt: null },
    });

    // Assign new numbers in the target team
    const updatedTeam = await tx.team.update({
      data: { issueCount: { increment: issues.length } },
      where: { id: targetTeamId },
    });
    const startNumber = updatedTeam.issueCount - issues.length + 1;

    // Move each issue
    const movedIssues: Issue[] = [];
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const newNumber = startNumber + i;
      const newIdentifier = `${targetTeam.key}-${newNumber}`;
      const newStateId = stateMap.get(issue.stateId) ?? fallbackStateId;

      const updated = await tx.issue.update({
        data: {
          identifier: newIdentifier,
          number: newNumber,
          previousIdentifiers: { push: issue.identifier },
          stateId: newStateId,
          teamId: targetTeamId,
        },
        where: { id: issue.id },
      });
      movedIssues.push(updated);
    }

    return movedIssues;
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
  ): Promise<WorkflowState[]> {
    const states = triageEnabled
      ? [
          TRIAGE_STATE,
          ...DEFAULT_WORKFLOW_STATES.map(s => ({
            ...s,
            position: s.position + 1,
          })),
        ]
      : DEFAULT_WORKFLOW_STATES;

    const created = await Promise.all(
      states.map(state =>
        tx.workflowState.create({
          data: { ...state, teamId },
        }),
      ),
    );

    // Set the first "backlog" state as the team's default issue state
    const backlogState = created.find(s => s.type === 'backlog');
    if (backlogState) {
      await tx.team.update({
        data: { defaultIssueStateId: backlogState.id },
        where: { id: teamId },
      });
    }

    return created;
  }
}

export class TeamKeyInvalidError extends Error {
  constructor() {
    super('Team key must be 1-10 uppercase characters');
    this.name = 'TeamKeyInvalidError';
  }
}

export class TeamNotFoundError extends Error {
  constructor() {
    super('Target team not found');
    this.name = 'TeamNotFoundError';
  }
}

export class TeamDeleteMoveTargetRequiredError extends Error {
  constructor() {
    super('moveToTeamId is required when issueAction is MOVE');
    this.name = 'TeamDeleteMoveTargetRequiredError';
  }
}

export class TeamDeleteMoveToSelfError extends Error {
  constructor() {
    super('Cannot move issues to the same team being deleted');
    this.name = 'TeamDeleteMoveToSelfError';
  }
}

export class TeamDeleteMoveNoStatesError extends Error {
  constructor() {
    super('Target team has no workflow states to assign issues to');
    this.name = 'TeamDeleteMoveNoStatesError';
  }
}
