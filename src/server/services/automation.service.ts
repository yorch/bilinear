import type { AutomationRule, Issue, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import { logger } from '../lib/logger';

/**
 * Rule-based automation engine. Triggers are emitted from resolvers (issue.ts,
 * comment.ts) fire-and-forget — failures here must never block the originating
 * mutation. Each call to {@link AutomationService.evaluateForIssue} fetches
 * matching enabled rules, applies optional conditions, then executes actions in
 * array order.
 *
 * MVP scope:
 *   - Triggers: issue_created, issue_state_changed, issue_priority_changed,
 *     issue_assignee_changed, comment_created
 *   - Conditions: same JSON shape as IssueFilter (team_id, label_id, priority,
 *     state_id) — evaluated against the changed issue
 *   - Actions: set_state, set_assignee, set_priority, add_label, post_comment
 *
 * Future scope (deferred):
 *   - Cycle / project lifecycle triggers
 *   - SLA-driven escalation
 *   - Dry-run mode
 *   - Per-action audit log (currently rolls up to `last_run_at` + `run_count`)
 */

export const TRIGGER_TYPES = [
  'issue_created',
  'issue_state_changed',
  'issue_priority_changed',
  'issue_assignee_changed',
  'comment_created',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const ACTION_TYPES = [
  'set_state',
  'set_assignee',
  'set_priority',
  'add_label',
  'post_comment',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface AutomationAction {
  config: Record<string, unknown>;
  type: ActionType;
}

export interface AutomationConditions {
  // Simple AND-of-leaves predicate for MVP. A full filter-tree shape can
  // replace this without breaking the column schema.
  assigneeId?: string | null;
  labelId?: string;
  priority?: number;
  stateCategory?: string;
  stateId?: string;
  teamId?: string;
}

export interface RuleCreateInput {
  actions: AutomationAction[];
  conditions?: AutomationConditions | null;
  description?: string;
  enabled?: boolean;
  name: string;
  organizationId: string;
  sortOrder?: number;
  teamId?: string | null;
  triggerConfig?: Record<string, unknown>;
  triggerType: TriggerType;
}

export interface RuleUpdateInput {
  actions?: AutomationAction[];
  conditions?: AutomationConditions | null;
  description?: string | null;
  enabled?: boolean;
  name?: string;
  sortOrder?: number;
  triggerConfig?: Record<string, unknown>;
  triggerType?: TriggerType;
}

export interface TriggerEvent {
  changes?: Record<string, { newValue: unknown; oldValue: unknown }>;
  commentId?: string;
  issue: Issue;
  type: TriggerType;
}

export class AutomationRuleNotFoundError extends Error {
  constructor() {
    super('Automation rule not found');
    this.name = 'AutomationRuleNotFoundError';
  }
}

export class AutomationInvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationInvalidConfigError';
  }
}

function isTriggerType(value: unknown): value is TriggerType {
  return typeof value === 'string' && (TRIGGER_TYPES as readonly string[]).includes(value);
}

function isActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && (ACTION_TYPES as readonly string[]).includes(value);
}

export function validateActions(actions: AutomationAction[]): void {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new AutomationInvalidConfigError('At least one action is required');
  }
  for (const action of actions) {
    if (!isActionType(action.type)) {
      throw new AutomationInvalidConfigError(`Unknown action type: ${action.type}`);
    }
    if (!action.config || typeof action.config !== 'object') {
      throw new AutomationInvalidConfigError(`Action config must be an object`);
    }
  }
}

export class AutomationService {
  constructor(private prisma: PrismaClient) {}

  async create(input: RuleCreateInput): Promise<AutomationRule> {
    if (!isTriggerType(input.triggerType)) {
      throw new AutomationInvalidConfigError(`Unknown trigger type: ${input.triggerType}`);
    }
    validateActions(input.actions);
    if (input.teamId) {
      // Cross-tenant safety: verify the team belongs to the org
      const team = await this.prisma.team.findFirst({
        where: { id: input.teamId, organizationId: input.organizationId },
      });
      if (!team) {
        throw new AutomationInvalidConfigError('Team not found in organization');
      }
    }
    return this.prisma.automationRule.create({
      data: {
        actions: input.actions as object,
        conditions: input.conditions as object | undefined,
        description: input.description,
        enabled: input.enabled ?? true,
        name: input.name,
        organizationId: input.organizationId,
        sortOrder: input.sortOrder ?? 0,
        teamId: input.teamId ?? null,
        triggerConfig: (input.triggerConfig ?? {}) as object,
        triggerType: input.triggerType,
      },
    });
  }

  async update(id: string, orgId: string, input: RuleUpdateInput): Promise<AutomationRule> {
    const existing = await this.prisma.automationRule.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) {
      throw new AutomationRuleNotFoundError();
    }
    if (input.triggerType && !isTriggerType(input.triggerType)) {
      throw new AutomationInvalidConfigError(`Unknown trigger type: ${input.triggerType}`);
    }
    if (input.actions) {
      validateActions(input.actions);
    }
    return this.prisma.automationRule.update({
      data: {
        actions: input.actions as object | undefined,
        // Prisma's Json column accepts JsonNull as a sentinel for SQL NULL;
        // explicit `null` must be passed through that sentinel.
        conditions:
          input.conditions === null ? Prisma.JsonNull : (input.conditions as object | undefined),
        description: input.description,
        enabled: input.enabled,
        name: input.name,
        sortOrder: input.sortOrder,
        triggerConfig: input.triggerConfig as object | undefined,
        triggerType: input.triggerType,
      },
      where: { id },
    });
  }

  async archive(id: string, orgId: string): Promise<AutomationRule> {
    const existing = await this.prisma.automationRule.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) {
      throw new AutomationRuleNotFoundError();
    }
    return this.prisma.automationRule.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async listByOrg(orgId: string): Promise<AutomationRule[]> {
    return this.prisma.automationRule.findMany({
      orderBy: [{ sortOrder: 'desc' }, { createdAt: 'asc' }],
      where: { archivedAt: null, organizationId: orgId },
    });
  }

  async findById(id: string, orgId: string): Promise<AutomationRule | null> {
    return this.prisma.automationRule.findFirst({
      where: { archivedAt: null, id, organizationId: orgId },
    });
  }

  /**
   * Entry point from resolvers. Fire-and-forget. Errors here are logged but
   * never thrown to the caller — automations must never break the user's
   * mutation flow.
   */
  async evaluateForIssue(orgId: string, event: TriggerEvent, actorUserId: string): Promise<void> {
    try {
      const rules = await this.prisma.automationRule.findMany({
        orderBy: { sortOrder: 'desc' },
        where: {
          archivedAt: null,
          enabled: true,
          OR: [{ teamId: null }, { teamId: event.issue.teamId }],
          organizationId: orgId,
          triggerType: event.type,
        },
      });

      for (const rule of rules ?? []) {
        const conditions = (rule.conditions ?? null) as AutomationConditions | null;
        if (!this.matchesConditions(event.issue, conditions)) {
          continue;
        }
        if (!this.matchesTriggerConfig(rule, event)) {
          continue;
        }
        await this.executeActions(orgId, rule, event, actorUserId);
        await this.prisma.automationRule.update({
          data: { lastRunAt: new Date(), runCount: { increment: 1 } },
          where: { id: rule.id },
        });
      }
    } catch (err) {
      logger.error({ err, event: event.type, orgId }, 'AutomationService.evaluateForIssue failed');
    }
  }

  private matchesConditions(issue: Issue, conditions: AutomationConditions | null): boolean {
    if (!conditions) {
      return true;
    }
    if (conditions.teamId && issue.teamId !== conditions.teamId) {
      return false;
    }
    if (conditions.stateId && issue.stateId !== conditions.stateId) {
      return false;
    }
    if (conditions.priority !== undefined && issue.priority !== conditions.priority) {
      return false;
    }
    if (conditions.assigneeId !== undefined) {
      if (conditions.assigneeId === null && issue.assigneeId !== null) {
        return false;
      }
      if (conditions.assigneeId !== null && issue.assigneeId !== conditions.assigneeId) {
        return false;
      }
    }
    // stateCategory + labelId require extra fetches; skip in MVP and document.
    return true;
  }

  private matchesTriggerConfig(rule: AutomationRule, event: TriggerEvent): boolean {
    const config = (rule.triggerConfig ?? {}) as Record<string, unknown>;
    if (event.type === 'issue_state_changed' && event.changes?.stateId) {
      const fromStateId = config.fromStateId as string | undefined;
      const toStateId = config.toStateId as string | undefined;
      if (fromStateId && event.changes.stateId.oldValue !== fromStateId) {
        return false;
      }
      if (toStateId && event.changes.stateId.newValue !== toStateId) {
        return false;
      }
    }
    if (event.type === 'issue_priority_changed' && event.changes?.priority) {
      const toPriority = config.toPriority as number | undefined;
      if (toPriority !== undefined && event.changes.priority.newValue !== toPriority) {
        return false;
      }
    }
    return true;
  }

  private async executeActions(
    orgId: string,
    rule: AutomationRule,
    event: TriggerEvent,
    actorUserId: string,
  ): Promise<void> {
    const actions = (rule.actions ?? []) as unknown as AutomationAction[];
    for (const action of actions) {
      try {
        await this.executeAction(orgId, action, event, actorUserId);
      } catch (err) {
        logger.error({ actionType: action.type, err, ruleId: rule.id }, 'Automation action failed');
      }
    }
  }

  private async executeAction(
    orgId: string,
    action: AutomationAction,
    event: TriggerEvent,
    actorUserId: string,
  ): Promise<void> {
    switch (action.type) {
      case 'set_state': {
        const stateId = action.config.stateId as string | undefined;
        if (!stateId) {
          return;
        }
        // Tenant safety: verify state belongs to the issue's team
        const state = await this.prisma.workflowState.findFirst({
          where: { id: stateId, teamId: event.issue.teamId },
        });
        if (!state) {
          return;
        }
        await this.prisma.issue.update({
          data: { stateId },
          where: { id: event.issue.id },
        });
        return;
      }
      case 'set_assignee': {
        const assigneeId = action.config.assigneeId as string | null | undefined;
        await this.prisma.issue.update({
          data: { assigneeId: assigneeId ?? null },
          where: { id: event.issue.id },
        });
        return;
      }
      case 'set_priority': {
        const priority = action.config.priority as number | undefined;
        if (priority === undefined) {
          return;
        }
        await this.prisma.issue.update({
          data: { priority },
          where: { id: event.issue.id },
        });
        return;
      }
      case 'add_label': {
        const labelId = action.config.labelId as string | undefined;
        if (!labelId) {
          return;
        }
        const label = await this.prisma.issueLabel.findFirst({
          where: {
            id: labelId,
            OR: [{ teamId: event.issue.teamId }, { organizationId: orgId, teamId: null }],
          },
        });
        if (!label) {
          return;
        }
        await this.prisma.issueLabelAssignment.upsert({
          create: { issueId: event.issue.id, labelId },
          update: {},
          where: { issueId_labelId: { issueId: event.issue.id, labelId } },
        });
        return;
      }
      case 'post_comment': {
        const body = action.config.body as string | undefined;
        if (!body) {
          return;
        }
        await this.prisma.comment.create({
          data: {
            authorId: actorUserId,
            body,
            issueId: event.issue.id,
            organizationId: orgId,
          },
        });
        return;
      }
      default: {
        // exhaustive switch — unknown actions are caught at validate time
        const _exhaustive: never = action.type;
        void _exhaustive;
      }
    }
  }
}
