/**
 * Relation direction, normalised for one issue's point of view.
 *
 * The server stores every directed relation as a pair of rows
 * (`A blocks B` plus the auto-created inverse `B blocked_by A`) and
 * `issueRelations(issueId)` returns the rows from *both* sides. Bucketing by
 * `rel.type` alone therefore showed one dependency twice, once as "Blocks" and
 * once as "Blocked by". Here each row is re-expressed relative to `issueId`
 * (flipping the type when the viewed issue is the *related* side) and the
 * mirrored pair is collapsed to a single entry.
 */

export type RelationType = 'blocks' | 'blocked_by' | 'related' | 'duplicate';

/** `duplicated_by` only exists as a view: the wire format has no such type. */
export type RelationViewType = RelationType | 'duplicated_by';

export const RELATION_VIEW_ORDER: readonly RelationViewType[] = [
  'blocks',
  'blocked_by',
  'related',
  'duplicate',
  'duplicated_by',
];

export interface RelatedIssueRef {
  id: string;
  identifier: string;
  title: string;
}

export interface IssueRelation {
  createdAt?: string;
  id: string;
  issue: RelatedIssueRef;
  issueId: string;
  relatedIssue: RelatedIssueRef;
  relatedIssueId: string;
  type: string;
}

export interface RelationEntry {
  /** Row to delete (the viewed issue's own row when both exist; the server removes the mirror). */
  id: string;
  other: RelatedIssueRef | undefined;
  otherId: string;
  type: RelationViewType;
}

function flip(type: string): RelationViewType {
  if (type === 'blocks') {
    return 'blocked_by';
  }
  if (type === 'blocked_by') {
    return 'blocks';
  }
  return type as RelationViewType;
}

export function normalizeRelations(
  relations: readonly IssueRelation[],
  issueId: string,
): RelationEntry[] {
  // Collapse by (other issue, kind of relation) for the symmetric types too,
  // so the mirrored duplicate / related row does not list twice.
  const byOther = new Map<string, IssueRelation[]>();
  for (const rel of relations) {
    const otherId = rel.issueId === issueId ? rel.relatedIssueId : rel.issueId;
    const key = `${otherId}\u0000${rel.type === 'blocks' || rel.type === 'blocked_by' ? 'dir' : rel.type}`;
    const list = byOther.get(key);
    if (list) {
      list.push(rel);
    } else {
      byOther.set(key, [rel]);
    }
  }

  const seen = new Set<string>();
  const entries: RelationEntry[] = [];

  for (const rel of relations) {
    const own = rel.issueId === issueId;
    const otherId = own ? rel.relatedIssueId : rel.issueId;
    const other = own ? rel.relatedIssue : rel.issue;

    let type: RelationViewType = own ? (rel.type as RelationViewType) : flip(rel.type);
    let id = rel.id;

    if (rel.type === 'duplicate') {
      // The mirror of a duplicate is also type `duplicate`, so direction comes
      // from which row of the pair was written first: that one's `issueId` is
      // the duplicate. Ties (same-transaction timestamps) break by id so
      // both sides of the pair agree. New duplicates are a single row.
      const pair = byOther.get(`${otherId}\u0000duplicate`) ?? [rel];
      const original = pair.reduce((a, b) => {
        const ta = a.createdAt ?? '';
        const tb = b.createdAt ?? '';
        if (ta === tb) {
          // Legacy mirrored pairs written in the same millisecond: both rows
          // must agree from either side, so tie-break on something
          // viewer-independent (the lower id is treated as written first).
          return a.id <= b.id ? a : b;
        }
        return ta < tb ? a : b;
      });
      type = original.issueId === issueId ? 'duplicate' : 'duplicated_by';
      id = (pair.find(r => r.issueId === issueId) ?? rel).id;
    } else if (rel.type === 'related') {
      id = (byOther.get(`${otherId}\u0000related`)?.find(r => r.issueId === issueId) ?? rel).id;
    } else if (!own) {
      // Prefer the viewed issue's own row for deletion when it exists.
      const mirror = byOther
        .get(`${otherId}\u0000dir`)
        ?.find(r => r.issueId === issueId && r.type === type);
      if (mirror) {
        id = mirror.id;
      }
    }

    const dedupeKey = `${otherId}\u0000${type}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    entries.push({ id, other, otherId, type });
  }

  return entries;
}
