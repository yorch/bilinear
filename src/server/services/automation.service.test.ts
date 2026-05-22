import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  ACTION_TYPES,
  AutomationInvalidConfigError,
  AutomationRuleNotFoundError,
  AutomationService,
  TRIGGER_TYPES,
} from './automation.service';

describe('AutomationService', () => {
  let prisma: MockPrismaClient;
  let service: AutomationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AutomationService(prisma as never);
  });

  describe('validation', () => {
    it('rejects unknown trigger type at create', async () => {
      await expect(
        service.create({
          actions: [{ config: {}, type: 'set_state' }],
          name: 'Bad',
          organizationId: 'org-1',
          triggerType: 'not_a_real_trigger' as never,
        }),
      ).rejects.toBeInstanceOf(AutomationInvalidConfigError);
    });

    it('rejects unknown action type at create', async () => {
      await expect(
        service.create({
          actions: [{ config: {}, type: 'wat' as never }],
          name: 'Bad',
          organizationId: 'org-1',
          triggerType: 'issue_created',
        }),
      ).rejects.toBeInstanceOf(AutomationInvalidConfigError);
    });

    it('rejects empty actions array', async () => {
      await expect(
        service.create({
          actions: [],
          name: 'Bad',
          organizationId: 'org-1',
          triggerType: 'issue_created',
        }),
      ).rejects.toBeInstanceOf(AutomationInvalidConfigError);
    });

    it('rejects cross-tenant team on create', async () => {
      prisma.team.findFirst.mockResolvedValue(null);
      await expect(
        service.create({
          actions: [{ config: { priority: 1 }, type: 'set_priority' }],
          name: 'cross-tenant',
          organizationId: 'org-1',
          teamId: 'team-from-different-org',
          triggerType: 'issue_created',
        }),
      ).rejects.toBeInstanceOf(AutomationInvalidConfigError);
    });

    it('throws AutomationRuleNotFoundError when updating across orgs', async () => {
      prisma.automationRule.findFirst.mockResolvedValue(null);
      await expect(service.update('rule-1', 'org-2', { enabled: false })).rejects.toBeInstanceOf(
        AutomationRuleNotFoundError,
      );
    });
  });

  describe('introspection', () => {
    it('exposes a stable set of trigger types', () => {
      expect(TRIGGER_TYPES).toContain('issue_created');
      expect(TRIGGER_TYPES).toContain('issue_state_changed');
    });

    it('exposes a stable set of action types', () => {
      expect(ACTION_TYPES).toContain('set_priority');
      expect(ACTION_TYPES).toContain('add_label');
    });
  });

  describe('evaluateForIssue', () => {
    const issue = {
      assigneeId: null,
      id: 'issue-1',
      organizationId: 'org-1',
      priority: 0,
      stateId: 'state-1',
      teamId: 'team-1',
    } as never;

    it('is a no-op when no rules match', async () => {
      prisma.automationRule.findMany.mockResolvedValue([]);
      await service.evaluateForIssue('org-1', { issue, type: 'issue_created' }, 'user-1');
      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('executes set_priority action when trigger and conditions match', async () => {
      prisma.automationRule.findMany.mockResolvedValue([
        {
          actions: [{ config: { priority: 1 }, type: 'set_priority' }],
          conditions: null,
          enabled: true,
          id: 'rule-1',
          triggerConfig: {},
          triggerType: 'issue_created',
        },
      ]);
      prisma.issue.update.mockResolvedValue({ ...issue, priority: 1 });
      prisma.automationRule.update.mockResolvedValue({});

      await service.evaluateForIssue('org-1', { issue, type: 'issue_created' }, 'user-1');

      expect(prisma.issue.update).toHaveBeenCalledWith({
        data: { priority: 1 },
        where: { id: 'issue-1' },
      });
      expect(prisma.automationRule.update).toHaveBeenCalledWith({
        data: { lastRunAt: expect.any(Date), runCount: { increment: 1 } },
        where: { id: 'rule-1' },
      });
    });

    it('skips rules whose teamId condition does not match the issue', async () => {
      prisma.automationRule.findMany.mockResolvedValue([
        {
          actions: [{ config: { priority: 1 }, type: 'set_priority' }],
          conditions: { teamId: 'team-2' },
          enabled: true,
          id: 'rule-skip',
          triggerConfig: {},
          triggerType: 'issue_created',
        },
      ]);

      await service.evaluateForIssue('org-1', { issue, type: 'issue_created' }, 'user-1');

      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('matches trigger config on state change rules', async () => {
      prisma.automationRule.findMany.mockResolvedValue([
        {
          actions: [{ config: { priority: 1 }, type: 'set_priority' }],
          conditions: null,
          enabled: true,
          id: 'rule-state',
          triggerConfig: { toStateId: 'state-target' },
          triggerType: 'issue_state_changed',
        },
      ]);
      prisma.issue.update.mockResolvedValue(issue);
      prisma.automationRule.update.mockResolvedValue({});

      // newValue matches → fires
      await service.evaluateForIssue(
        'org-1',
        {
          changes: { stateId: { newValue: 'state-target', oldValue: 'state-other' } },
          issue,
          type: 'issue_state_changed',
        },
        'user-1',
      );
      expect(prisma.issue.update).toHaveBeenCalledTimes(1);

      // newValue does not match → does not fire
      prisma.issue.update.mockClear();
      await service.evaluateForIssue(
        'org-1',
        {
          changes: { stateId: { newValue: 'state-other', oldValue: 'state-third' } },
          issue,
          type: 'issue_state_changed',
        },
        'user-1',
      );
      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('refuses set_state to a workflow state from a different team', async () => {
      prisma.automationRule.findMany.mockResolvedValue([
        {
          actions: [{ config: { stateId: 'state-from-other-team' }, type: 'set_state' }],
          conditions: null,
          enabled: true,
          id: 'rule-cross-team',
          triggerConfig: {},
          triggerType: 'issue_created',
        },
      ]);
      prisma.workflowState.findFirst.mockResolvedValue(null);
      prisma.automationRule.update.mockResolvedValue({});

      await service.evaluateForIssue('org-1', { issue, type: 'issue_created' }, 'user-1');

      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('never throws — automation failures must not break caller', async () => {
      prisma.automationRule.findMany.mockRejectedValue(new Error('db down'));
      // Should resolve without throwing
      await expect(
        service.evaluateForIssue('org-1', { issue, type: 'issue_created' }, 'user-1'),
      ).resolves.toBeUndefined();
    });
  });
});
