import type { PrismaClient } from '../../generated/prisma';
import { getSyncVisibility, type SyncVisibility } from './sync-visibility';

/**
 * Per-entity read visibility, derived from the same `SyncVisibility` scope the
 * replication paths use so the GraphQL read surface and the offline-first
 * paths agree on who may see what:
 *
 *  - a private team (and everything scoped to it) is invisible to non-members;
 *  - a guest sees only the issues they created or are assigned to;
 *  - a custom view is visible to its creator, or to everyone when shared.
 *
 * Used wherever a row is reachable by *id alone* (favorites, notifications,
 * attachments) rather than through a team-scoped list query.
 */

export interface IssueVisibilityRow {
  assigneeId: string | null;
  creatorId: string | null;
  teamId: string;
}

export function isIssueVisible(vis: SyncVisibility, issue: IssueVisibilityRow): boolean {
  if (vis.hiddenTeamIds.includes(issue.teamId)) {
    return false;
  }
  if (vis.guestTeamIds.includes(issue.teamId)) {
    return issue.creatorId === vis.userId || issue.assigneeId === vis.userId;
  }
  return true;
}

export function isTeamVisible(vis: SyncVisibility, teamId: string | null | undefined): boolean {
  return !teamId || !vis.hiddenTeamIds.includes(teamId);
}

export function isCustomViewVisible(
  vis: SyncVisibility,
  view: { creatorId: string; shared: boolean; teamId: string | null },
): boolean {
  if (!isTeamVisible(vis, view.teamId)) {
    return false;
  }
  return view.shared || view.creatorId === vis.userId;
}

export type VisibilityEntityType =
  | 'Issue'
  | 'Project'
  | 'Initiative'
  | 'CustomView'
  | 'Cycle'
  | 'Document'
  | 'Team';

/**
 * Whether `row` (already fetched, already org-checked) of `entityType` is
 * visible under `vis`. Unknown types fail closed.
 */
export function isEntityVisible(
  vis: SyncVisibility,
  entityType: string,
  row: Record<string, unknown>,
): boolean {
  switch (entityType) {
    case 'Issue':
      return isIssueVisible(vis, row as unknown as IssueVisibilityRow);
    case 'Team':
      return isTeamVisible(vis, row.id as string);
    case 'Cycle':
    case 'Document':
      return isTeamVisible(vis, row.teamId as string | null);
    case 'CustomView':
      return isCustomViewVisible(
        vis,
        row as unknown as { creatorId: string; shared: boolean; teamId: string | null },
      );
    case 'Project':
    case 'Initiative':
      return true;
    default:
      return false;
  }
}

function modelFor(prisma: PrismaClient, entityType: string) {
  const models = {
    CustomView: prisma.customView,
    Cycle: prisma.cycle,
    Document: prisma.document,
    Initiative: prisma.initiative,
    Issue: prisma.issue,
    Project: prisma.project,
    Team: prisma.team,
  } as unknown as Record<
    string,
    { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }
  >;
  return models[entityType] ?? null;
}

/**
 * Ids of `entityIds` (all of `entityType`) that exist in `orgId` AND are
 * visible under `vis`. One query per call — callers group by type.
 */
export async function visibleEntityIds(
  prisma: PrismaClient,
  vis: SyncVisibility,
  orgId: string,
  entityType: string,
  entityIds: readonly string[],
): Promise<Set<string>> {
  const model = modelFor(prisma, entityType);
  if (!model || entityIds.length === 0) {
    return new Set();
  }
  const rows = await model.findMany({
    where: { id: { in: [...entityIds] }, organizationId: orgId },
  });
  return new Set(rows.filter(r => isEntityVisible(vis, entityType, r)).map(r => r.id as string));
}

/** Fetch `entityType`/`entityId` and report visibility; false when absent or cross-org. */
export async function canViewEntity(
  prisma: PrismaClient,
  vis: SyncVisibility,
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  return (await visibleEntityIds(prisma, vis, orgId, entityType, [entityId])).has(entityId);
}

/** One-shot: issue visibility for (user, org) without the caller holding a scope. */
export async function canViewIssue(
  prisma: PrismaClient,
  userId: string,
  orgId: string,
  issue: IssueVisibilityRow,
): Promise<boolean> {
  return isIssueVisible(await getSyncVisibility(prisma, userId, orgId), issue);
}
