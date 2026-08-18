import { describe, expect, it } from 'vitest';
import { applyPoolSyncAction } from './apply-pool-sync-action';

interface Row {
  id: string;
  name: string;
}

const ROW: Row = { id: 'r1', name: 'original' };
const NEXT: Row = { id: 'r1', name: 'updated' };

/**
 * The seventeen store methods that delegate here are each covered through their own
 * suite, but the contract itself lives in one place, so it is pinned in one
 * place too — including the two branches that are easy to "simplify" away: the
 * payload-less upsert and the unrecognised verb.
 */
describe('applyPoolSyncAction', () => {
  it.each(['I', 'U', 'A'])("'%s' upserts the row", actionType => {
    const pool = new Map<string, Row>();

    applyPoolSyncAction(pool, actionType, 'r1', ROW);

    expect(pool.get('r1')).toEqual(ROW);
  });

  it.each(['U', 'A'])("'%s' replaces an existing row", actionType => {
    const pool = new Map<string, Row>([['r1', ROW]]);

    applyPoolSyncAction(pool, actionType, 'r1', NEXT);

    expect(pool.get('r1')).toEqual(NEXT);
    expect(pool.size).toBe(1);
  });

  it("'D' removes the row", () => {
    const pool = new Map<string, Row>([['r1', ROW]]);

    applyPoolSyncAction(pool, 'D', 'r1', null);

    expect(pool.has('r1')).toBe(false);
  });

  it.each(['I', 'U', 'A'])("'%s' with no payload leaves the pool untouched", actionType => {
    const pool = new Map<string, Row>([['r1', ROW]]);

    applyPoolSyncAction(pool, actionType, 'r1', null);

    // `null` must not be written over a live row: archive/unarchive/snooze/triage
    // all broadcast without a body, and a `null` entry would satisfy a
    // `get(id) ?? null` read while breaking every field access downstream.
    expect(pool.get('r1')).toEqual(ROW);
    expect(pool.size).toBe(1);
  });

  it.each(['X', '', 'delete', 'i'])(
    "'%s' is not a recognised verb and changes nothing",
    actionType => {
      const pool = new Map<string, Row>([['r1', ROW]]);

      applyPoolSyncAction(pool, actionType, 'r1', NEXT);
      applyPoolSyncAction(pool, actionType, 'r2', NEXT);

      expect(pool.get('r1')).toEqual(ROW);
      expect(pool.size).toBe(1);
    },
  );

  it("'D' on an absent id is a no-op rather than a throw", () => {
    const pool = new Map<string, Row>([['r1', ROW]]);

    applyPoolSyncAction(pool, 'D', 'missing', null);

    expect(pool.size).toBe(1);
  });
});
