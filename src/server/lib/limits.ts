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
