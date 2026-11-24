/**
 * Derived initiative health. Pure.
 *
 * This is a COMPUTED hint rolled up from an initiative's projects; it is never
 * stored and never replaces a manually posted initiative update (the UI shows
 * the manual update's health as the authoritative one and this as "derived").
 *
 * Per project, two signals are combined (worse wins):
 *  - manual: the project's latest posted health (project field or newest update);
 *  - schedule: projected finish vs target date. Past target and unfinished is
 *    off track; projected more than OFF_TRACK_SLIP_DAYS late is off track; any
 *    lateness is at risk.
 * Per initiative: worst project signal wins; the initiative's own target date
 * is checked against the latest projected finish across its projects.
 */

export type DerivedHealth = 'atRisk' | 'noData' | 'offTrack' | 'onTrack';

export type HealthReasonCode =
  | 'initiativeTargetSlip'
  | 'noActiveProjects'
  | 'noSignals'
  | 'projectManualHealth'
  | 'projectOverdue'
  | 'projectProjectedLate';

export interface HealthReason {
  code: HealthReasonCode;
  projectId?: string;
}

export interface HealthProjectInput {
  id: string;
  /** Latest manually posted health: 'onTrack' | 'atRisk' | 'offTrack' | null. */
  manualHealth: string | null;
  /** From the burn-up forecast. */
  projectedFinish: string | null;
  /** Project status type: completed/canceled projects carry no signal. */
  statusType: string;
  /** YYYY-MM-DD */
  targetDate: string | null;
}

export interface DerivedHealthResult {
  health: DerivedHealth;
  reasons: HealthReason[];
}

/** A projected slip beyond this many days is off track rather than at risk. */
export const OFF_TRACK_SLIP_DAYS = 14;

const RANK: Record<DerivedHealth, number> = { atRisk: 2, noData: 0, offTrack: 3, onTrack: 1 };
const DAY_MS = 86_400_000;

function days(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

function normalizeManual(h: string | null): DerivedHealth | null {
  return h === 'onTrack' || h === 'atRisk' || h === 'offTrack' ? h : null;
}

function slipHealth(slipDays: number): DerivedHealth {
  if (slipDays > OFF_TRACK_SLIP_DAYS) {
    return 'offTrack';
  }
  return slipDays > 0 ? 'atRisk' : 'onTrack';
}

function worse(a: DerivedHealth, b: DerivedHealth): DerivedHealth {
  return RANK[b] > RANK[a] ? b : a;
}

export function deriveInitiativeHealth(
  projects: HealthProjectInput[],
  opts: { initiativeTargetDate?: string | null; today: string },
): DerivedHealthResult {
  const active = projects.filter(p => p.statusType !== 'completed' && p.statusType !== 'canceled');
  if (active.length === 0) {
    return { health: 'noData', reasons: [{ code: 'noActiveProjects' }] };
  }

  let health: DerivedHealth = 'noData';
  const reasons: HealthReason[] = [];
  let latestFinish: string | null = null;

  for (const p of active) {
    let signal: DerivedHealth = 'noData';
    const manual = normalizeManual(p.manualHealth);
    if (manual) {
      signal = manual;
      if (manual !== 'onTrack') {
        reasons.push({ code: 'projectManualHealth', projectId: p.id });
      }
    }
    if (p.targetDate) {
      if (p.projectedFinish) {
        const slip = slipHealth(days(p.targetDate, p.projectedFinish));
        if (slip !== 'onTrack') {
          reasons.push({ code: 'projectProjectedLate', projectId: p.id });
        }
        signal = worse(signal, slip);
      } else if (p.targetDate < opts.today) {
        signal = worse(signal, 'offTrack');
        reasons.push({ code: 'projectOverdue', projectId: p.id });
      }
    }
    if (p.projectedFinish && (!latestFinish || p.projectedFinish > latestFinish)) {
      latestFinish = p.projectedFinish;
    }
    health = worse(health, signal);
  }

  if (opts.initiativeTargetDate && latestFinish) {
    const slip = slipHealth(days(opts.initiativeTargetDate, latestFinish));
    if (slip !== 'onTrack') {
      reasons.push({ code: 'initiativeTargetSlip' });
    }
    health = worse(health, slip);
  }

  if (health === 'noData') {
    return { health, reasons: [{ code: 'noSignals' }] };
  }
  return { health, reasons };
}
