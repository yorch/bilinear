import type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldValue,
  PrismaClient,
} from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';

export const MAX_CUSTOM_FIELDS_PER_TEAM = 20;

export interface CustomFieldOption {
  value: string;
  label: string;
  color?: string;
}

export interface CustomFieldDefinitionCreateInput {
  teamId: string;
  name: string;
  type: CustomFieldType;
  description?: string;
  required?: boolean;
  options?: CustomFieldOption[];
  sortOrder?: number;
}

export interface CustomFieldDefinitionUpdateInput {
  name?: string;
  description?: string | null;
  required?: boolean;
  options?: CustomFieldOption[] | null;
  sortOrder?: number;
}

export interface CustomFieldValueInput {
  definitionId: string;
  value: unknown;
}

export class CustomFieldDefinitionNotFoundError extends Error {
  constructor() {
    super('Custom field definition not found');
    this.name = 'CustomFieldDefinitionNotFoundError';
  }
}

export class CustomFieldLimitExceededError extends Error {
  constructor() {
    super(`Team has reached the ${MAX_CUSTOM_FIELDS_PER_TEAM}-field limit`);
    this.name = 'CustomFieldLimitExceededError';
  }
}

export class CustomFieldInvalidValueError extends Error {
  constructor(reason: string) {
    super(`Invalid custom field value: ${reason}`);
    this.name = 'CustomFieldInvalidValueError';
  }
}

export class CustomFieldInvalidOptionsError extends Error {
  constructor(reason: string) {
    super(`Invalid custom field options: ${reason}`);
    this.name = 'CustomFieldInvalidOptionsError';
  }
}

const SELECT_TYPES = new Set<CustomFieldType>(['select', 'multi_select']);

export function validateValueForType(
  type: CustomFieldType,
  value: unknown,
  options: CustomFieldOption[] | null,
): void {
  // null/undefined clears the value; always allowed at this layer (required
  // enforcement happens at the issue-save boundary, not here).
  if (value === null || value === undefined) {
    return;
  }

  switch (type) {
    case 'text':
    case 'url':
      if (typeof value !== 'string') {
        throw new CustomFieldInvalidValueError(
          `expected string, got ${typeof value}`,
        );
      }
      if (type === 'url' && value.length > 0) {
        try {
          new URL(value);
        } catch {
          throw new CustomFieldInvalidValueError('not a valid URL');
        }
      }
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new CustomFieldInvalidValueError(
          `expected number, got ${typeof value}`,
        );
      }
      break;
    case 'date':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new CustomFieldInvalidValueError('expected ISO date string');
      }
      break;
    case 'checkbox':
      if (typeof value !== 'boolean') {
        throw new CustomFieldInvalidValueError(
          `expected boolean, got ${typeof value}`,
        );
      }
      break;
    case 'select': {
      if (typeof value !== 'string') {
        throw new CustomFieldInvalidValueError(
          `expected option string, got ${typeof value}`,
        );
      }
      const allowed = (options ?? []).map(o => o.value);
      if (!allowed.includes(value)) {
        throw new CustomFieldInvalidValueError(
          `"${value}" is not a valid option`,
        );
      }
      break;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) {
        throw new CustomFieldInvalidValueError(
          'expected array of option strings',
        );
      }
      const allowed = new Set((options ?? []).map(o => o.value));
      for (const v of value) {
        if (typeof v !== 'string' || !allowed.has(v)) {
          throw new CustomFieldInvalidValueError(
            `"${String(v)}" is not a valid option`,
          );
        }
      }
      break;
    }
  }
}

function validateOptionsForType(
  type: CustomFieldType,
  options: CustomFieldOption[] | null | undefined,
): void {
  if (SELECT_TYPES.has(type)) {
    if (!options || options.length === 0) {
      throw new CustomFieldInvalidOptionsError(
        'select types require at least one option',
      );
    }
    const seen = new Set<string>();
    for (const o of options) {
      if (!o.value || !o.label) {
        throw new CustomFieldInvalidOptionsError(
          'each option needs a value and a label',
        );
      }
      if (seen.has(o.value)) {
        throw new CustomFieldInvalidOptionsError(
          `duplicate option value "${o.value}"`,
        );
      }
      seen.add(o.value);
    }
  } else if (options && options.length > 0) {
    throw new CustomFieldInvalidOptionsError(
      `${type} fields do not accept options`,
    );
  }
}

export class CustomFieldService {
  constructor(private prisma: PrismaClient) {}

  async createDefinition(
    input: CustomFieldDefinitionCreateInput,
  ): Promise<CustomFieldDefinition> {
    validateOptionsForType(input.type, input.options);

    return this.prisma.$transaction(async tx => {
      const activeCount = await tx.customFieldDefinition.count({
        where: { archivedAt: null, teamId: input.teamId },
      });
      if (activeCount >= MAX_CUSTOM_FIELDS_PER_TEAM) {
        throw new CustomFieldLimitExceededError();
      }

      return tx.customFieldDefinition.create({
        data: {
          description: input.description ?? null,
          name: input.name,
          options: input.options
            ? (input.options as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          required: input.required ?? false,
          sortOrder: input.sortOrder ?? activeCount,
          teamId: input.teamId,
          type: input.type,
        },
      });
    });
  }

  async updateDefinition(
    id: string,
    input: CustomFieldDefinitionUpdateInput,
  ): Promise<CustomFieldDefinition> {
    const existing = await this.prisma.customFieldDefinition.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new CustomFieldDefinitionNotFoundError();
    }

    if ('options' in input && input.options !== undefined) {
      validateOptionsForType(existing.type, input.options);
    }

    const data: Prisma.CustomFieldDefinitionUpdateInput = {};
    if (input.name !== undefined) {
      data.name = input.name;
    }
    if ('description' in input) {
      data.description = input.description;
    }
    if (input.required !== undefined) {
      data.required = input.required;
    }
    if ('options' in input) {
      data.options = input.options
        ? (input.options as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
    }

    return this.prisma.customFieldDefinition.update({ data, where: { id } });
  }

  async archiveDefinition(id: string): Promise<CustomFieldDefinition> {
    const existing = await this.prisma.customFieldDefinition.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new CustomFieldDefinitionNotFoundError();
    }
    return this.prisma.customFieldDefinition.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  async deleteDefinition(id: string): Promise<CustomFieldDefinition> {
    const existing = await this.prisma.customFieldDefinition.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new CustomFieldDefinitionNotFoundError();
    }
    return this.prisma.customFieldDefinition.delete({ where: { id } });
  }

  async findDefinitionById(id: string): Promise<CustomFieldDefinition | null> {
    return this.prisma.customFieldDefinition.findUnique({ where: { id } });
  }

  async findDefinitionsByTeamId(
    teamId: string,
    includeArchived = false,
  ): Promise<CustomFieldDefinition[]> {
    return this.prisma.customFieldDefinition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        teamId,
      },
    });
  }

  async findDefinitionsByOrgId(
    organizationId: string,
  ): Promise<CustomFieldDefinition[]> {
    return this.prisma.customFieldDefinition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      where: {
        archivedAt: null,
        team: { organizationId },
      },
    });
  }

  async findValuesByIssueIds(issueIds: string[]): Promise<CustomFieldValue[]> {
    if (issueIds.length === 0) {
      return [];
    }
    return this.prisma.customFieldValue.findMany({
      where: { issueId: { in: issueIds } },
    });
  }

  async findValuesByOrgId(organizationId: string): Promise<CustomFieldValue[]> {
    return this.prisma.customFieldValue.findMany({
      where: { issue: { organizationId } },
    });
  }

  /**
   * Set a list of custom field values for an issue. Null/undefined value for
   * a definition removes the row. Caller is responsible for permission checks.
   */
  async setValuesForIssue(
    issueId: string,
    values: CustomFieldValueInput[],
  ): Promise<void> {
    if (values.length === 0) {
      return;
    }

    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: { id: { in: values.map(v => v.definitionId) } },
    });
    const defById = new Map(definitions.map(d => [d.id, d]));

    for (const v of values) {
      const def = defById.get(v.definitionId);
      if (!def) {
        throw new CustomFieldDefinitionNotFoundError();
      }
      validateValueForType(
        def.type,
        v.value,
        (def.options as CustomFieldOption[] | null) ?? null,
      );
    }

    await this.prisma.$transaction(async tx => {
      for (const v of values) {
        if (v.value === null || v.value === undefined) {
          await tx.customFieldValue.deleteMany({
            where: { definitionId: v.definitionId, issueId },
          });
          continue;
        }
        await tx.customFieldValue.upsert({
          create: {
            definitionId: v.definitionId,
            issueId,
            value: v.value as never,
          },
          update: { value: v.value as never },
          where: {
            issueId_definitionId: { definitionId: v.definitionId, issueId },
          },
        });
      }
    });
  }
}
