import { describe, expect, it } from 'vitest';
import { healthSignature } from './initiative-health-badge';

const init = { id: 'i1', status: 'active', targetDate: '2026-09-01' };
const proj: Parameters<typeof healthSignature>[2][number] = {
  health: 'onTrack',
  healthUpdatedAt: null,
  id: 'p1',
  statusType: 'started',
  targetDate: null,
};
const sig = (i = init, links = [{ id: 'l1' }], p = proj) => healthSignature([i], links, [p]);

describe('healthSignature (drives the roll-up refetch)', () => {
  it('is stable for identical data and order-independent', () => {
    expect(sig()).toBe(sig());
    expect(healthSignature([init, { ...init, id: 'i2' }], [], [])).toBe(
      healthSignature([{ ...init, id: 'i2' }, init], [], []),
    );
  });

  it.each([
    ['initiative target date', sig({ ...init, targetDate: '2026-10-01' })],
    ['initiative status', sig({ ...init, status: 'completed' })],
    ['a project link', sig(init, [{ id: 'l1' }, { id: 'l2' }])],
    ['project target date', sig(init, [{ id: 'l1' }], { ...proj, targetDate: '2026-08-01' })],
    ['project status', sig(init, [{ id: 'l1' }], { ...proj, statusType: 'completed' })],
    ['project health', sig(init, [{ id: 'l1' }], { ...proj, health: 'offTrack' })],
  ])('changes when the %s changes', (_n, changed) => {
    expect(changed).not.toBe(sig());
  });
});
