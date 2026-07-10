export interface IssueReturnTo {
  label: string;
  path: string;
}

/**
 * Builds a link to the standalone issue detail route, optionally carrying a
 * `from`/`fromLabel` pair so the detail page can show a breadcrumb back to
 * the list it was opened from and return there on close instead of always
 * falling back to the issue's own team page.
 */
export function buildIssueHref(
  workspaceKey: string,
  issueId: string,
  returnTo?: IssueReturnTo,
): string {
  const base = `/${workspaceKey}/issue/${issueId}`;
  if (!returnTo) {
    return base;
  }
  const params = new URLSearchParams({ from: returnTo.path, fromLabel: returnTo.label });
  return `${base}?${params.toString()}`;
}
