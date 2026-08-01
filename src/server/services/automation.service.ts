import type { AutomationRule, Issue, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import { logger } from '../lib/logger';
import type { IssueService, IssueUpdateInput as ServiceIssueUpdateInput } from './issue.service';
import type { SyncService } from './sync.service';

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
  createdById?: string | null;
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

/**
 * Deps the engine needs to apply action side effects through the same write
 * paths used by user-initiated mutations. Injecting them keeps the engine
 * decoupled from GraphQLContext (so it stays unit-testable) but ensures every
 * action emits SyncActions and stamps lifecycle columns identically.
 */
export interface AutomationDeps {
  issue: Pick<IssueService, 'update'>;
  sync: Pick<SyncService, 'createSyncAction'>;
}

export class AutomationService {
  constructor(
    private prisma: PrismaClient,
    private deps?: AutomationDeps,
  ) {}

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
        createdById: input.createdById ?? null,
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
        await this.executeAction(orgId, rule, action, event, actorUserId);
      } catch (err) {
        logger.error({ actionType: action.type, err, ruleId: rule.id }, 'Automation action failed');
      }
    }
  }

  /**
   * Apply an Issue-targeted update through {@link IssueService.update} when
   * deps are wired (production path) so lifecycle stamping, label syncing,
   * and the auto-close cascade run identically to a user-initiated update.
   * Falls back to a raw prisma write only when deps are absent (legacy unit
   * tests instantiate AutomationService with prisma only). Every successful
   * production write emits a SyncAction so connected clients reflect the
   * change in real time.
   */
  private async applyIssueUpdate(
    orgId: string,
    issueId: string,
    _teamId: string,
    data: ServiceIssueUpdateInput,
    rawData: Prisma.IssueUncheckedUpdateInput,
  ): Promise<void> {
    if (this.deps) {
      const { issue } = await this.deps.issue.update(issueId, data);
      await this.deps.sync.createSyncAction(orgId, 'U', 'Issue', issueId, issue);
      return;
    }
    await this.prisma.issue.update({ data: rawData, where: { id: issueId } });
  }

  private async executeAction(
    orgId: string,
    rule: AutomationRule,
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
        await this.applyIssueUpdate(
          orgId,
          event.issue.id,
          event.issue.teamId,
          { stateId },
          {
            stateId,
          },
        );
        return;
      }
      case 'set_assignee': {
        const assigneeId = action.config.assigneeId as string | null | undefined;
        // Tenant safety: a foreign-org UUID would otherwise be written
        // straight into the issue's assignee_id (and resolve into our
        // org via DataLoader). Mirror the team-membership check the
        // GraphQL issueUpdate resolver depends on for human callers.
        if (assigneeId) {
          const membership = await this.prisma.teamMembership.findFirst({
            where: {
              team: { id: event.issue.teamId, organizationId: orgId },
              userId: assigneeId,
            },
          });
          if (!membership) {
            logger.warn(
              { assigneeId, issueId: event.issue.id, ruleId: rule.id },
              'Automation set_assignee rejected: user not a member of issue team',
            );
            return;
          }
        }
        await this.applyIssueUpdate(
          orgId,
          event.issue.id,
          event.issue.teamId,
          { assigneeId: assigneeId ?? null },
          { assigneeId: assigneeId ?? null },
        );
        return;
      }
      case 'set_priority': {
        const priority = action.config.priority as number | undefined;
        if (priority === undefined) {
          return;
        }
        await this.applyIssueUpdate(
          orgId,
          event.issue.id,
          event.issue.teamId,
          { priority },
          {
            priority,
          },
        );
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
        const assignment = await this.prisma.issueLabelAssignment.upsert({
          create: { issueId: event.issue.id, labelId },
          update: {},
          where: { issueId_labelId: { issueId: event.issue.id, labelId } },
        });
        // Re-fetch the issue so connected clients reflect the new label
        // set via the standard Issue SyncAction (the client's label
        // resolver reads from labelAssignments).
        if (this.deps) {
          const issue = await this.prisma.issue.findUnique({
            include: { labelAssignments: { select: { labelId: true } } },
            where: { id: event.issue.id },
          });
          if (issue) {
            await this.deps.sync.createSyncAction(orgId, 'U', 'Issue', issue.id, issue);
          }
        }
        void assignment;
        return;
      }
      case 'post_comment': {
        const body = action.config.body as string | undefined;
        if (!body) {
          return;
        }
        // Attribute the auto-comment to the rule's author rather than
        // the user who triggered the rule. The triggerer may be a guest
        // who never agreed to post on the rule's behalf, and attaching
        // their identity pollutes the audit trail. Fall back to the
        // triggerer only if the rule's creator has been removed (the
        // FK is ON DELETE SET NULL).
        const authorId = rule.createdById ?? actorUserId;
        const comment = await this.prisma.comment.create({
          data: {
            authorId,
            body,
            issueId: event.issue.id,
            organizationId: orgId,
          },
        });
        if (this.deps) {
          await this.deps.sync.createSyncAction(orgId, 'I', 'Comment', comment.id, comment);
        }
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
