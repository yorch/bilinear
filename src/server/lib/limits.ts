/**
 * Centralized caps/limits shared across services and GraphQL resolvers.
 * Previously each call site (audit log, platform admin, issue activities,
 * notifications, webhook deliveries, issue/comment services, favorites)
 * hand-declared its own copy of the same handful of numbers — collecting
 * them here means there's one place to read (and change) each cap.
 */

/** Standard list-pagination default page size. */
export const DEFAULT_LIST_LIMIT = 50;

/** Standard list-pagination ceiling — the maximum a caller-supplied `limit`/`first` can be clamped to. */
export const MAX_LIST_LIMIT = 200;

/** Batch-size cap for bulk mutations (issuesBulkUpdate, favorite reorder). */
export const MAX_BULK_OPERATION = 200;

/** Character-length cap for rich-text bodies (issue description, comment body). */
export const MAX_RICH_TEXT_LENGTH = 100_000;

/** Lower bound of the issue priority scale (0 = none). */
export const MIN_PRIORITY = 0;

/** Upper bound of the issue priority scale (4 = low). */
export const MAX_PRIORITY = 4;

/** Character-length cap for a webhook's display name. */
export const MAX_WEBHOOK_NAME_LENGTH = 256;

/**
 * Character-length cap for a single emoji reaction. Emoji (including ZWJ
 * sequences/skin-tone modifiers) are at most a handful of codepoints —
 * this just needs to be generous enough for any real emoji while blocking
 * an arbitrary-length string from being stored and broadcast to every
 * connected client as a "reaction".
 */
export const MAX_EMOJI_LENGTH = 32;

/**
 * Shared length guard for nullable rich-text-ish string inputs (issue
 * description, comment body, project description, initiative description,
 * etc). Each call site previously hand-rolled this exact check with its own
 * error class — centralized here so the rule ("null/undefined is fine,
 * anything longer than `max` isn't") only needs to be read once. The caller
 * supplies its own error class (via `makeError`) and field name so the
 * thrown error's type and message text are unchanged from before.
 */
export function assertMaxLength(
  value: string | null | undefined,
  max: number,
  makeError: (message: string) => Error,
  fieldName: string,
): void {
  if (value != null && value.length > max) {
    throw makeError(`${fieldName} must be ${max} characters or fewer`);
  }
}
