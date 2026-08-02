/**
 * Does `pathname` sit at or below `href`, respecting path-segment boundaries?
 *
 * The boundary is the whole point. A bare `pathname.startsWith(href)` makes
 * `/w/team/ENGX` match team `ENG`, because team keys are free-form and one is
 * routinely a prefix of another. The sidebar used it twice — once to pick the
 * expanded team and once for the active-row highlight — and only one of the
 * two got it right, so visiting ENGX expanded ENG and left ENGX's sub-nav
 * hidden.
 */
export function isPathWithin(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
