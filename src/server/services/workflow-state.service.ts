import type { PrismaClient, WorkflowState } from '../../generated/prisma';

const VALID_TYPES = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];

const REQUIRED_TYPES = ['completed', 'canceled'];

export interface WorkflowStateCreateInput {
  color: string;
  description?: string;
  id?: string;
  name: string;
  position?: number;
  teamId: string;
  type: string;
}

export interface WorkflowStateUpdateInput {
  color?: string;
  description?: string;
  name?: string;
  position?: number;
}

export class WorkflowStateService {
  constructor(private prisma: PrismaClient) {}

  async create(input: WorkflowStateCreateInput): Promise<WorkflowState> {
    this.validateType(input.type);

    return this.prisma.workflowState.create({
      data: {
        color: input.color,
        description: input.description,
        id: input.id,
        name: input.name,
        position: input.position ?? 0,
        teamId: input.teamId,
        type: input.type,
      },
    });
  }

  async findById(id: string): Promise<WorkflowState | null> {
    return this.prisma.workflowState.findUnique({ where: { id } });
  }

  async findByTeamId(teamId: string): Promise<WorkflowState[]> {
    return this.prisma.workflowState.findMany({
      orderBy: { position: 'asc' },
      where: { archivedAt: null, teamId },
    });
  }

  async update(id: string, input: WorkflowStateUpdateInput): Promise<WorkflowState> {
    return this.prisma.workflowState.update({
      data: {
        color: input.color,
        description: input.description,
        name: input.name,
        position: input.position,
      },
      where: { id },
    });
  }

  async archive(state: WorkflowState): Promise<WorkflowState> {
    if (REQUIRED_TYPES.includes(state.type)) {
      const siblingCount = await this.prisma.workflowState.count({
        where: {
          archivedAt: null,
          id: { not: state.id },
          teamId: state.teamId,
          type: state.type,
        },
      });

      if (siblingCount === 0) {
        throw new LastRequiredStateError(state.type);
      }
    }

    return this.prisma.workflowState.update({
      data: { archivedAt: new Date() },
      where: { id: state.id },
    });
  }

  private validateType(type: string): void {
    if (!VALID_TYPES.includes(type)) {
      throw new InvalidStateTypeError(type);
    }
  }
}

export class InvalidStateTypeError extends Error {
  constructor(type: string) {
    super(`Invalid workflow state type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
    this.name = 'InvalidStateTypeError';
  }
}

export class LastRequiredStateError extends Error {
  constructor(type: string) {
    super(`Cannot archive the last ${type} state. At least one ${type} state is required.`);
    this.name = 'LastRequiredStateError';
  }
}
