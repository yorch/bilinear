import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_TEAM } from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import {
  CustomFieldDefinitionNotFoundError,
  CustomFieldInvalidOptionsError,
  CustomFieldInvalidValueError,
  CustomFieldLimitExceededError,
  CustomFieldService,
  MAX_CUSTOM_FIELDS_PER_TEAM,
  validateValueForType,
} from './custom-field.service';

const TEST_DEF = {
  archivedAt: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  description: null,
  id: '00000000-0000-0000-0000-000000000900',
  name: 'Severity',
  options: [
    { label: 'Low', value: 'low' },
    { label: 'High', value: 'high' },
  ],
  required: false,
  sortOrder: 0,
  teamId: TEST_TEAM.id,
  type: 'select' as const,
  updatedAt: new Date('2026-04-01T00:00:00Z'),
};

const TEST_TEXT_DEF = {
  ...TEST_DEF,
  id: '00000000-0000-0000-0000-000000000901',
  name: 'External Link',
  options: null,
  type: 'url' as const,
};

describe('CustomFieldService', () => {
  let prisma: MockPrismaClient;
  let service: CustomFieldService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CustomFieldService(prisma as never);
  });

  describe('createDefinition', () => {
    it('creates a select field with options', async () => {
      prisma.customFieldDefinition.count.mockResolvedValue(3);
      prisma.customFieldDefinition.create.mockResolvedValue(TEST_DEF);

      const result = await service.createDefinition({
        name: 'Severity',
        options: [
          { label: 'Low', value: 'low' },
          { label: 'High', value: 'high' },
        ],
        teamId: TEST_TEAM.id,
        type: 'select',
      });

      expect(result).toEqual(TEST_DEF);
      expect(prisma.customFieldDefinition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Severity',
          sortOrder: 3,
          teamId: TEST_TEAM.id,
          type: 'select',
        }),
      });
    });

    it('rejects select field without options', async () => {
      prisma.customFieldDefinition.count.mockResolvedValue(0);
      await expect(
        service.createDefinition({
          name: 'X',
          teamId: TEST_TEAM.id,
          type: 'select',
        }),
      ).rejects.toBeInstanceOf(CustomFieldInvalidOptionsError);
    });

    it('rejects text field with options', async () => {
      await expect(
        service.createDefinition({
          name: 'X',
          options: [{ label: 'A', value: 'a' }],
          teamId: TEST_TEAM.id,
          type: 'text',
        }),
      ).rejects.toBeInstanceOf(CustomFieldInvalidOptionsError);
    });

    it('rejects duplicate option values', async () => {
      await expect(
        service.createDefinition({
          name: 'X',
          options: [
            { label: 'A', value: 'a' },
            { label: 'Also A', value: 'a' },
          ],
          teamId: TEST_TEAM.id,
          type: 'select',
        }),
      ).rejects.toBeInstanceOf(CustomFieldInvalidOptionsError);
    });

    it('throws when team already has max fields', async () => {
      prisma.customFieldDefinition.count.mockResolvedValue(
        MAX_CUSTOM_FIELDS_PER_TEAM,
      );
      await expect(
        service.createDefinition({
          name: 'X',
          teamId: TEST_TEAM.id,
          type: 'text',
        }),
      ).rejects.toBeInstanceOf(CustomFieldLimitExceededError);
    });
  });

  describe('updateDefinition', () => {
    it('updates name', async () => {
      prisma.customFieldDefinition.findUnique.mockResolvedValue(TEST_DEF);
      prisma.customFieldDefinition.update.mockResolvedValue({
        ...TEST_DEF,
        name: 'Urgency',
      });

      const result = await service.updateDefinition(TEST_DEF.id, {
        name: 'Urgency',
      });

      expect(result.name).toBe('Urgency');
      expect(prisma.customFieldDefinition.update).toHaveBeenCalledWith({
        data: { name: 'Urgency' },
        where: { id: TEST_DEF.id },
      });
    });

    it('throws NotFound when missing', async () => {
      prisma.customFieldDefinition.findUnique.mockResolvedValue(null);
      await expect(
        service.updateDefinition('missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(CustomFieldDefinitionNotFoundError);
    });

    it('validates options against existing type on update', async () => {
      prisma.customFieldDefinition.findUnique.mockResolvedValue(TEST_TEXT_DEF);
      await expect(
        service.updateDefinition(TEST_TEXT_DEF.id, {
          options: [{ label: 'A', value: 'a' }],
        }),
      ).rejects.toBeInstanceOf(CustomFieldInvalidOptionsError);
    });
  });

  describe('archiveDefinition', () => {
    it('sets archivedAt', async () => {
      prisma.customFieldDefinition.findUnique.mockResolvedValue(TEST_DEF);
      prisma.customFieldDefinition.update.mockResolvedValue({
        ...TEST_DEF,
        archivedAt: new Date(),
      });

      const result = await service.archiveDefinition(TEST_DEF.id);
      expect(result.archivedAt).not.toBeNull();
    });
  });

  describe('findDefinitionsByTeamId', () => {
    it('orders by sortOrder then name, excludes archived', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([TEST_DEF]);

      const result = await service.findDefinitionsByTeamId(TEST_TEAM.id);

      expect(result).toEqual([TEST_DEF]);
      expect(prisma.customFieldDefinition.findMany).toHaveBeenCalledWith({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        where: { archivedAt: null, teamId: TEST_TEAM.id },
      });
    });
  });

  describe('setValuesForIssue', () => {
    it('upserts each value after type validation', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([TEST_DEF]);
      prisma.customFieldValue.upsert.mockResolvedValue({});

      await service.setValuesForIssue('issue-1', [
        { definitionId: TEST_DEF.id, value: 'low' },
      ]);

      expect(prisma.customFieldValue.upsert).toHaveBeenCalledWith({
        create: {
          definitionId: TEST_DEF.id,
          issueId: 'issue-1',
          value: 'low',
        },
        update: { value: 'low' },
        where: {
          issueId_definitionId: {
            definitionId: TEST_DEF.id,
            issueId: 'issue-1',
          },
        },
      });
    });

    it('deletes value when null provided', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([TEST_DEF]);
      prisma.customFieldValue.deleteMany.mockResolvedValue({ count: 1 });

      await service.setValuesForIssue('issue-1', [
        { definitionId: TEST_DEF.id, value: null },
      ]);

      expect(prisma.customFieldValue.deleteMany).toHaveBeenCalledWith({
        where: { definitionId: TEST_DEF.id, issueId: 'issue-1' },
      });
    });

    it('rejects invalid select value', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([TEST_DEF]);
      await expect(
        service.setValuesForIssue('issue-1', [
          { definitionId: TEST_DEF.id, value: 'not-an-option' },
        ]),
      ).rejects.toBeInstanceOf(CustomFieldInvalidValueError);
    });

    it('rejects unknown definition', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([]);
      await expect(
        service.setValuesForIssue('issue-1', [
          { definitionId: 'nope', value: 'x' },
        ]),
      ).rejects.toBeInstanceOf(CustomFieldDefinitionNotFoundError);
    });
  });

  describe('validateValueForType', () => {
    it('accepts valid URL', () => {
      expect(() =>
        validateValueForType('url', 'https://example.com', null),
      ).not.toThrow();
    });

    it('rejects non-URL string for url type', () => {
      expect(() => validateValueForType('url', 'not a url', null)).toThrow(
        CustomFieldInvalidValueError,
      );
    });

    it('accepts ISO date', () => {
      expect(() =>
        validateValueForType('date', '2026-04-16', null),
      ).not.toThrow();
    });

    it('rejects bad date string', () => {
      expect(() => validateValueForType('date', 'not-a-date', null)).toThrow(
        CustomFieldInvalidValueError,
      );
    });

    it('validates multi_select elements against allowed options', () => {
      const opts = [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ];
      expect(() =>
        validateValueForType('multi_select', ['a', 'b'], opts),
      ).not.toThrow();
      expect(() =>
        validateValueForType('multi_select', ['a', 'c'], opts),
      ).toThrow(CustomFieldInvalidValueError);
    });

    it('accepts boolean for checkbox', () => {
      expect(() => validateValueForType('checkbox', true, null)).not.toThrow();
      expect(() => validateValueForType('checkbox', 'yes', null)).toThrow(
        CustomFieldInvalidValueError,
      );
    });
  });
});
