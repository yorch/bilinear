import type { Prisma } from '../../generated/prisma';

/**
 * Guest visibility predicate for issue queries: an issue is visible under
 * this predicate when EITHER (a) its team is not one of `guestTeamIds` (the
 * caller isn't guest-restricted on that team), OR (b) the caller created it
 * or is assigned to it — the same "own work only" rule
 * `requireIssueAccessNotGuestOrOwn` enforces on the write path.
 *
 * Shared by two call sites that previously derived this independently:
 *  - `SearchService.visibilityWhere`, scoped across every team the caller
 *    is a member of, passes the caller's full `guestTeamIds` list so the
 *    "team is not a guest team" branch actually does work: non-guest-team
 *    results stay unrestricted while guest-team results are pared down to
 *    creator-or-assignee.
 *  - `IssueService.buildWhere`/`findByTeamId`, always scoped to exactly one
 *    team (the `issues` resolver requires `filter.teamId`; `findByTeamId`
 *    takes `teamId` directly), pass `guestTeamIds: [teamId]` — since every
 *    row the surrounding query can return already has `teamId === teamId`,
 *    the "not one of guestTeamIds" branch can never be satisfied there, so
 *    the predicate collapses to plain creator-or-assignee, exactly the
 *    narrower rule those two call sites applied before this was extracted.
 */
export function buildGuestVisibilityWhere({
  userId,
  guestTeamIds,
}: {
  userId: string;
  guestTeamIds: string[];
}): Prisma.IssueWhereInput {
  return {
    OR: [{ teamId: { notIn: guestTeamIds } }, { creatorId: userId }, { assigneeId: userId }],
  };
}
