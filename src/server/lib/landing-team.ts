export interface LandingTeamCandidate {
  /** Whether the viewer has a membership row on this team. */
  isMember: boolean;
  key: string;
  private: boolean;
}

/**
 * The team a workspace root should forward to: the first one, in the order
 * given, that the viewer can actually open. A private team they don't belong to
 * is skipped (org owners/admins see every team, matching the `teams` query),
 * because redirecting there lands on "Team not found".
 */
export function pickLandingTeamKey(
  teams: readonly LandingTeamCandidate[],
  viewerIsOrgAdmin: boolean,
): string | null {
  const visible = teams.find(t => !t.private || t.isMember || viewerIsOrgAdmin);
  return visible?.key ?? null;
}
