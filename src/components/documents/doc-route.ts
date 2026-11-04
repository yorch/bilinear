/** `/demo/docs/<id>` → `<id>`; null for any other path (including `/demo/docs`). */
export function getDocumentIdFromPath(pathname: string): string | null {
  const match = /^\/[^/]+\/docs\/([^/]+)\/?$/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * Whether a team's "Docs" sidebar link is active. A document lives at
 * `/<workspace>/docs/<id>`, not under the team's `/team/<key>/docs` prefix, so
 * the prefix test alone drops the highlight exactly when a doc is open; the
 * owning team is resolved from the document instead.
 */
export function isTeamDocsActive(opts: {
  docTeamId: string | null | undefined;
  docsHref: string;
  pathname: string;
  teamId: string;
}): boolean {
  if (opts.pathname.startsWith(opts.docsHref)) {
    return true;
  }
  return getDocumentIdFromPath(opts.pathname) !== null && opts.docTeamId === opts.teamId;
}
