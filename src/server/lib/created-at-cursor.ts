/**
 * Keyset cursor over `(createdAt desc, id desc)`, encoded `<iso>|<uuid>`.
 *
 * Unlike an id-only Prisma cursor it still resolves when the anchor row has
 * since been removed, and ties on `createdAt` cannot skip or repeat a row.
 * Cursors come from the client, so decoding validates both halves: a bad id
 * would otherwise reach Postgres as an invalid UUID and surface as a 500.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Date.prototype.toISOString output, which is all `encodeCreatedAtCursor` emits.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'InvalidCursorError';
  }
}

export function encodeCreatedAtCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

/** Null for "no cursor"; throws InvalidCursorError for anything malformed. */
export function decodeCreatedAtCursor(
  cursor?: string | null,
): { createdAt: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  const sep = cursor.indexOf('|');
  const iso = cursor.slice(0, sep);
  const id = cursor.slice(sep + 1);
  const createdAt = new Date(iso);
  if (sep < 1 || !ISO_RE.test(iso) || Number.isNaN(createdAt.getTime()) || !UUID_RE.test(id)) {
    throw new InvalidCursorError();
  }
  return { createdAt, id };
}

/** Prisma `where` fragment selecting the rows strictly after the cursor. */
export function afterCreatedAtCursor(cursor?: string | null) {
  const c = decodeCreatedAtCursor(cursor);
  return c
    ? {
        OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
      }
    : null;
}
