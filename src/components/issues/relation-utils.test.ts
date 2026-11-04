import { describe, expect, it } from 'vitest';
import { type IssueRelation, normalizeRelations } from './relation-utils';

const ref = (n: number) => ({ id: `i${n}`, identifier: `ENG-${n}`, title: `Issue ${n}` });

function row(
  id: string,
  from: number,
  to: number,
  type: string,
  createdAt = '2026-01-01T00:00:00.000Z',
): IssueRelation {
  return {
    createdAt,
    id,
    issue: ref(from),
    issueId: `i${from}`,
    relatedIssue: ref(to),
    relatedIssueId: `i${to}`,
    type,
  };
}

// ENG-8 blocks ENG-9 is stored as two rows: the one written, and its inverse.
const BLOCKS_PAIR = [row('r1', 8, 9, 'blocks'), row('r2', 9, 8, 'blocked_by')];

describe('normalizeRelations', () => {
  it('shows a stored blocks pair once, as "blocks", from the blocker', () => {
    const entries = normalizeRelations(BLOCKS_PAIR, 'i8');
    expect(entries.map(e => [e.otherId, e.type])).toEqual([['i9', 'blocks']]);
  });

  it('shows the same pair once, as "blocked_by", from the blocked issue', () => {
    const entries = normalizeRelations(BLOCKS_PAIR, 'i9');
    expect(entries.map(e => [e.otherId, e.type])).toEqual([['i8', 'blocked_by']]);
  });

  it('flips a lone inverse row (the viewed issue is the related side)', () => {
    const entries = normalizeRelations([row('r1', 9, 8, 'blocked_by')], 'i8');
    expect(entries.map(e => [e.otherId, e.type])).toEqual([['i9', 'blocks']]);
    expect(entries[0].other?.identifier).toBe('ENG-9');
  });

  it("targets the viewed issue's own row for deletion", () => {
    expect(normalizeRelations(BLOCKS_PAIR, 'i8')[0].id).toBe('r1');
    expect(normalizeRelations(BLOCKS_PAIR, 'i9')[0].id).toBe('r2');
    // even when the mirror row is listed first
    expect(normalizeRelations([...BLOCKS_PAIR].reverse(), 'i8')[0].id).toBe('r1');
  });

  it('keeps distinct relations to distinct issues', () => {
    const entries = normalizeRelations(
      [...BLOCKS_PAIR, row('r3', 10, 8, 'blocks'), row('r4', 8, 10, 'blocked_by')],
      'i8',
    );
    expect(entries.map(e => [e.otherId, e.type])).toEqual([
      ['i9', 'blocks'],
      ['i10', 'blocked_by'],
    ]);
  });

  it('collapses a mirrored related pair', () => {
    const entries = normalizeRelations(
      [row('r1', 8, 9, 'related'), row('r2', 9, 8, 'related')],
      'i8',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'r1', type: 'related' });
  });

  it('reads a duplicate pair by which row was written first', () => {
    // ENG-8 was marked a duplicate of ENG-9: row r1 first, mirror r2 a moment later.
    const pair = [
      row('r1', 8, 9, 'duplicate', '2026-01-01T00:00:00.000Z'),
      row('r2', 9, 8, 'duplicate', '2026-01-01T00:00:00.050Z'),
    ];
    expect(normalizeRelations(pair, 'i8').map(e => e.type)).toEqual(['duplicate']);
    expect(normalizeRelations(pair, 'i9').map(e => e.type)).toEqual(['duplicated_by']);
  });

  it('reads a tied-timestamp duplicate pair consistently from both sides', () => {
    const t = '2026-01-01T00:00:00.000Z';
    const pair = [row('r1', 8, 9, 'duplicate', t), row('r2', 9, 8, 'duplicate', t)];
    const a = normalizeRelations(pair, 'i8').map(e => e.type);
    const b = normalizeRelations(pair, 'i9').map(e => e.type);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // Exactly one side is the duplicate, whatever the insertion order.
    expect([a[0], b[0]].sort()).toEqual(['duplicate', 'duplicated_by']);
    expect(normalizeRelations([...pair].reverse(), 'i8').map(e => e.type)).toEqual(a);
  });
});
