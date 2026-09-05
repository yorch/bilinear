/**
 * The subset of `Badge` tones a role can render as. Declared here rather than
 * imported from the component so `src/lib` keeps no dependency on
 * `src/components`; the union is assignable to `BadgeProps['tone']`.
 */
export type BadgeTone = 'brand' | 'info' | 'muted';

/**
 * The one role → badge-tone map.
 *
 * It lived twice — `ROLE_BADGES` in the workspace members roster and
 * `ROLE_COLORS` in team member management — and the two had already been
 * tuned separately once. Owners are brand (the workspace's own colour),
 * admins info, everyone else muted. An unknown role falls to muted rather
 * than throwing on a value the server adds later.
 */
export function roleTone(role: string | null | undefined): BadgeTone {
  switch (role) {
    case 'owner':
      return 'brand';
    case 'admin':
      return 'info';
    default:
      return 'muted';
  }
}
