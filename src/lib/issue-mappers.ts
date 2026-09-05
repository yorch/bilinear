import type { DBIssueLabel, DBUser, IssueSyncRow } from '@/lib/db';
import type { IssueLabel, IssueUser } from '@/types/issues';

/**
 * Store-model → view-model mappers shared by every page that feeds users and
 * labels into the issue components (previously copy-pasted per page).
 */
export function toIssueUsers(users: DBUser[]): IssueUser[] {
  return users.map(u => ({
    avatarBackgroundColor: u.avatarBgColor,
    avatarUrl: u.avatarUrl ?? null,
    displayName: u.displayName,
    id: u.id,
    initials: u.initials,
  }));
}

export function toIssueLabels(labels: DBIssueLabel[]): IssueLabel[] {
  return labels.map(l => ({
    color: l.color,
    id: l.id,
    name: l.name,
  }));
}

/** The one store method label resolution needs — structural so `lib/` stays free of `stores/`. */
export interface LabelLookup {
  findById(id: string): DBIssueLabel | null;
}

/**
 * Resolve an issue's `labelIds` against the label pool. An id the pool no
 * longer holds (a label deleted while its assignment row is still in flight)
 * is dropped rather than rendered as a blank chip.
 */
export function resolveIssueLabels(
  labelIds: readonly string[] | null | undefined,
  labelStore: LabelLookup,
): IssueLabel[] {
  const found: DBIssueLabel[] = [];
  for (const id of labelIds ?? []) {
    const label = labelStore.findById(id);
    if (label) {
      found.push(label);
    }
  }
  return toIssueLabels(found);
}

/**
 * Store row → the `IssueDetail` shape the issue components consume: labels
 * resolved to `{ color, id, name }` and `dueDate` normalised to `null` so the
 * date fields never carry `undefined` into a component prop. Used by every
 * list page and the detail panel (it lived in seven copies before).
 */
export function toIssueDetail<T extends { dueDate?: string | null; labelIds?: readonly string[] }>(
  raw: T,
  labelStore: LabelLookup,
): T & { dueDate: string | null; labels: IssueLabel[] } {
  return {
    ...raw,
    dueDate: raw.dueDate ?? null,
    labels: resolveIssueLabels(raw.labelIds, labelStore),
  };
}

/** Every optional `string | null` field on `IssueSyncRow`, derived from the type. */
type OptionalStringKey = {
  [K in keyof IssueSyncRow]-?: undefined extends IssueSyncRow[K]
    ? IssueSyncRow[K] extends string | null | undefined
      ? K
      : never
    : never;
}[keyof IssueSyncRow];

/**
 * The optional string columns copied through verbatim. Listed rather than
 * iterated off the value so an unexpected key on the wire cannot write itself
 * into the row — and checked against the type in both directions below, so a
 * column added to `DBIssue` and forgotten here fails `yarn typecheck` instead of
 * silently ceasing to reconcile.
 */
const OPTIONAL_STRING_KEYS = [
  'archivedAt',
  'assigneeId',
  'branchName',
  'canceledAt',
  'completedAt',
  'creatorId',
  'cycleId',
  'description',
  'dueDate',
  'parentId',
  'projectId',
  'snoozedById',
  'snoozedUntilAt',
  'startDate',
  'startedAt',
  'startedTriageAt',
  'triagedAt',
] as const satisfies readonly OptionalStringKey[];

/** Completeness half: every `OptionalStringKey` appears in the tuple above. */
const _allOptionalStringKeysCovered: Exclude<
  OptionalStringKey,
  (typeof OPTIONAL_STRING_KEYS)[number]
> extends never
  ? true
  : never = true;
void _allOptionalStringKeysCovered;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Collect `key` off every element, or `null` if any element is the wrong shape. */
function pluckIds(value: unknown, key: string): string[] | null {
  if (!isUnknownArray(value)) {
    return null;
  }
  const ids: string[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item[key] !== 'string') {
      return null;
    }
    ids.push(item[key]);
  }
  return ids;
}

/**
 * Validate an issue row that came off the wire — a GraphQL mutation response —
 * into the shape the issue store accepts.
 *
 * The store's apply is a whole-object replace, so handing it an object that only
 * *claims* to be an issue is how a malformed or partial response blanks every
 * column of a row. Returning `null` on anything unexpected makes the failure
 * mode "skip the local reconcile" instead: the authoritative row still arrives
 * over the SyncAction stream moments later, so the UI converges either way.
 *
 * Strict on purpose — a present-but-wrong-typed field rejects the whole row
 * rather than being dropped, because a dropped field reaches the store as
 * `undefined` and clears the column.
 */
export function toIssueSyncRow(raw: Record<string, unknown>): IssueSyncRow | null {
  const {
    createdAt,
    id,
    identifier,
    number,
    organizationId,
    priority,
    prioritySortOrder,
    sortOrder,
    stateId,
    teamId,
    title,
    trashed,
    updatedAt,
  } = raw;

  if (
    typeof createdAt !== 'string' ||
    typeof id !== 'string' ||
    typeof identifier !== 'string' ||
    typeof number !== 'number' ||
    typeof organizationId !== 'string' ||
    typeof priority !== 'number' ||
    typeof prioritySortOrder !== 'number' ||
    typeof sortOrder !== 'number' ||
    typeof stateId !== 'string' ||
    typeof teamId !== 'string' ||
    typeof title !== 'string' ||
    typeof trashed !== 'boolean' ||
    typeof updatedAt !== 'string'
  ) {
    return null;
  }

  const row: IssueSyncRow = {
    createdAt,
    id,
    identifier,
    number,
    organizationId,
    priority,
    prioritySortOrder,
    sortOrder,
    stateId,
    teamId,
    title,
    trashed,
    updatedAt,
  };

  for (const key of OPTIONAL_STRING_KEYS) {
    const value = raw[key];
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value !== 'string') {
      return null;
    }
    row[key] = value;
  }

  if (raw.estimate !== undefined) {
    if (raw.estimate !== null && typeof raw.estimate !== 'number') {
      return null;
    }
    row.estimate = raw.estimate;
  }

  // Exactly one of the three label shapes may be present. An absent one is not
  // "no labels" — `normalizeIssueRow` falls back to the labels already held.
  if (raw.labels !== undefined) {
    const ids = pluckIds(raw.labels, 'id');
    if (ids === null) {
      return null;
    }
    row.labels = ids.map(labelId => ({ id: labelId }));
  }
  if (raw.labelAssignments !== undefined) {
    const ids = pluckIds(raw.labelAssignments, 'labelId');
    if (ids === null) {
      return null;
    }
    row.labelAssignments = ids.map(labelId => ({ labelId }));
  }
  if (raw.labelIds !== undefined) {
    if (!isUnknownArray(raw.labelIds) || raw.labelIds.some(v => typeof v !== 'string')) {
      return null;
    }
    row.labelIds = raw.labelIds.filter(v => typeof v === 'string');
  }

  return row;
}
