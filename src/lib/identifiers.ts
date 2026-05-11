/**
 * Shared issue-identifier pattern. An identifier is a team key (one or more
 * uppercase letters) plus a hyphen plus a positive integer, e.g. `ENG-42`.
 *
 * Case-insensitive so the same regex works on the client (where users may
 * type lowercase) and the server. Callers that want canonical form should
 * `.toUpperCase()` before storing or comparing.
 */
export const IDENTIFIER_RE = /^[A-Z]+-\d+$/i;
