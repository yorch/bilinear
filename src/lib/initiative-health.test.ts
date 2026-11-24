import { describe, expect, it } from 'vitest';
import { deriveInitiativeHealth, type HealthProjectInput } from './initiative-health';

const today = '2026-06-15';
const p = (over: Partial<HealthProjectInput> = {}): HealthProjectInput => ({
  id: 'p1',
  manualHealth: null,
  projectedFinish: null,
  statusType: 'inProgress',
  targetDate: null,
  ...over,
});

describe('deriveInitiativeHealth', () => {
  it('is noData with no projects or only finished projects', () => {
    expect(deriveInitiativeHealth([], { today }).health).toBe('noData');
    expect(
      deriveInitiativeHealth([p({ manualHealth: 'offTrack', statusType: 'completed' })], { today }),
    ).toMatchObject({ health: 'noData', reasons: [{ code: 'noActiveProjects' }] });
  });

  it('is noData when active projects carry no signal', () => {
    expect(deriveInitiativeHealth([p()], { today })).toMatchObject({
      health: 'noData',
      reasons: [{ code: 'noSignals' }],
    });
  });

  it('on track when forecast meets the target', () => {
    const r = deriveInitiativeHealth(
      [p({ projectedFinish: '2026-07-01', targetDate: '2026-07-01' })],
      { today },
    );
    expect(r.health).toBe('onTrack');
  });

  it('at risk for a small slip, off track beyond 14 days', () => {
    expect(
      deriveInitiativeHealth([p({ projectedFinish: '2026-07-05', targetDate: '2026-07-01' })], {
        today,
      }).health,
    ).toBe('atRisk');
    expect(
      deriveInitiativeHealth([p({ projectedFinish: '2026-07-16', targetDate: '2026-07-01' })], {
        today,
      }).health,
    ).toBe('offTrack');
  });

  it('a past target with no completion forecast is off track', () => {
    const r = deriveInitiativeHealth([p({ targetDate: '2026-06-01' })], { today });
    expect(r.health).toBe('offTrack');
    expect(r.reasons).toEqual([{ code: 'projectOverdue', projectId: 'p1' }]);
  });

  it('worst project wins, and a manual red is not softened by a good forecast', () => {
    const r = deriveInitiativeHealth(
      [
        p({ id: 'a', manualHealth: 'onTrack' }),
        p({
          id: 'b',
          manualHealth: 'offTrack',
          projectedFinish: '2026-06-20',
          targetDate: '2026-07-01',
        }),
      ],
      { today },
    );
    expect(r.health).toBe('offTrack');
    expect(r.reasons).toContainEqual({ code: 'projectManualHealth', projectId: 'b' });
  });

  it('checks the initiative target against the latest projected finish', () => {
    const r = deriveInitiativeHealth(
      [p({ manualHealth: 'onTrack', projectedFinish: '2026-08-10' })],
      { initiativeTargetDate: '2026-08-01', today },
    );
    expect(r.health).toBe('atRisk');
    expect(r.reasons).toContainEqual({ code: 'initiativeTargetSlip' });
  });

  it('ignores unknown manual health strings', () => {
    expect(deriveInitiativeHealth([p({ manualHealth: 'bogus' })], { today }).health).toBe('noData');
  });
});
