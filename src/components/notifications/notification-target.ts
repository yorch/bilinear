import type { DBNotification } from '@/lib/db';

/** The slice of the stores the resolver reads — injected so it stays a pure function. */
export interface NotificationTargetLookups {
  document: (id: string) => { title: string } | null;
  initiative: (id: string) => { name: string } | null;
  issue: (id: string) => { identifier: string; title: string } | null;
  project: (id: string) => { name: string; slugId: string } | null;
}

export interface NotificationTarget {
  href: string;
  /** Short mono prefix (the issue identifier), when the entity has one. */
  identifier?: string;
  title: string;
}

type EntityKind = 'document' | 'initiative' | 'project';

const DATA_KEYS: Array<[key: string, kind: EntityKind]> = [
  ['projectId', 'project'],
  ['documentId', 'document'],
  ['initiativeId', 'initiative'],
];

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Where a notification should take the reader.
 *
 * Issue notifications carry `issueId`; every other entity (project, document,
 * initiative) rides in the free-form `data` payload as `projectId` /
 * `documentId` / `initiativeId`, or a generic `{ entityType, entityId }` pair.
 * Before this, the inbox only knew `issueId`, so any other notification was an
 * unlinked, titleless row. Returns null when nothing resolves, so the row can
 * say what it knows without a dead link.
 */
export function resolveNotificationTarget(
  notification: Pick<DBNotification, 'data' | 'issueId'>,
  workspace: string,
  lookups: NotificationTargetLookups,
): NotificationTarget | null {
  if (notification.issueId) {
    const issue = lookups.issue(notification.issueId);
    if (issue) {
      return {
        href: `/${workspace}/issue/${notification.issueId}`,
        identifier: issue.identifier,
        title: issue.title,
      };
    }
  }

  const data = (notification.data ?? {}) as Record<string, unknown>;
  const fallbackTitle = str(data.title) ?? str(data.name);
  const candidates: Array<[EntityKind, string]> = [];
  for (const [key, kind] of DATA_KEYS) {
    const id = str(data[key]);
    if (id) {
      candidates.push([kind, id]);
    }
  }
  const genericType = str(data.entityType)?.toLowerCase();
  const genericId = str(data.entityId);
  if (
    genericId &&
    (genericType === 'project' || genericType === 'document' || genericType === 'initiative')
  ) {
    candidates.push([genericType, genericId]);
  }

  for (const [kind, id] of candidates) {
    if (kind === 'project') {
      const project = lookups.project(id);
      if (project) {
        return { href: `/${workspace}/project/${project.slugId}`, title: project.name };
      }
    } else if (kind === 'document') {
      // A document route is by id, so it resolves even before the store knows it.
      return {
        href: `/${workspace}/docs/${id}`,
        title: lookups.document(id)?.title ?? fallbackTitle ?? '',
      };
    } else {
      return {
        href: `/${workspace}/initiatives/${id}`,
        title: lookups.initiative(id)?.name ?? fallbackTitle ?? '',
      };
    }
  }
  return null;
}
