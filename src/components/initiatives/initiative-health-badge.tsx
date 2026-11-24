'use client';

import { observer } from 'mobx-react-lite';
import { createContext, type ReactNode, useContext } from 'react';
import { Badge } from '@/components/ui/badge';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

export interface InitiativeHealthRollup {
  health: string;
  initiativeId: string;
  manualHealth: string | null;
  reasons: Array<{ code: string; projectId?: string | null }>;
}

const QUERY = `query InitiativeHealthRollups {
  initiativeHealthRollups { initiativeId health manualHealth reasons { code projectId } }
}`;

const TONES = {
  atRisk: 'warning',
  noData: 'muted',
  offTrack: 'danger',
  onTrack: 'success',
} as const;

const HealthContext = createContext<Map<string, InitiativeHealthRollup>>(new Map());

/**
 * Fetches every initiative's derived health once and shares it with the badges
 * below, so a list of N rows costs one request, not N. A failed load simply
 * renders no badges: this is a supplementary hint, never the authoritative
 * value (see InitiativeHealthBadge).
 *
 * The roll-up is derived from target dates, statuses and project links, which
 * the stores already hold and keep live over sync. The fetch is keyed on a
 * signature of exactly those fields, so editing a date or moving a project
 * re-derives the badge instead of leaving a stale "Derived" value on screen.
 */
export const InitiativeHealthProvider = observer(function InitiativeHealthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { initiativeStore, projectStore } = useStore();
  const signature = healthSignature(
    [...initiativeStore.pool.values()],
    [...initiativeStore.projectLinks.values()],
    [...projectStore.pool.values()],
  );
  const { data } = useRetryableFetch<Map<string, InitiativeHealthRollup>>(
    async () => {
      const rows = await gqlQuery<InitiativeHealthRollup[]>(QUERY, {}, 'initiativeHealthRollups');
      return new Map((rows ?? []).map(r => [r.initiativeId, r]));
    },
    [signature],
    new Map(),
  );
  return <HealthContext.Provider value={data}>{children}</HealthContext.Provider>;
});

/** Everything the server's health derivation reads that a client edit can change. */
export function healthSignature(
  initiatives: Array<{ id: string; status: string; targetDate?: string | null }>,
  links: Array<{ id: string }>,
  projects: Array<{
    health?: string | null;
    healthUpdatedAt?: string | null;
    id: string;
    statusType: string;
    targetDate?: string | null;
  }>,
): string {
  return [
    initiatives.map(i => `${i.id}:${i.status}:${i.targetDate ?? ''}`).sort(),
    links.map(l => l.id).sort(),
    projects
      .map(
        p =>
          `${p.id}:${p.statusType}:${p.targetDate ?? ''}:${p.health ?? ''}:${p.healthUpdatedAt ?? ''}`,
      )
      .sort(),
  ]
    .map(part => part.join(','))
    .join('|');
}

function healthTone(health: string) {
  return TONES[health as keyof typeof TONES] ?? 'muted';
}

/**
 * Health for one initiative. A manually posted initiative update, when there is
 * one, is shown as "Posted" and is the authoritative value; the roll-up from
 * project health and forecasts is always labelled "Derived" and sits beside it,
 * never in its place.
 */
export const InitiativeHealthBadge = observer(function InitiativeHealthBadge({
  className,
  compact = false,
  initiativeId,
  showReasons = false,
}: {
  className?: string;
  /** List rows: one short badge below `sm`, the full Posted/Derived pair from `sm` up. */
  compact?: boolean;
  initiativeId: string;
  /** Spell out why the derived value is what it is (detail page). */
  showReasons?: boolean;
}) {
  const t = useTranslations();
  const { projectStore } = useStore();
  const rollup = useContext(HealthContext).get(initiativeId);
  if (!rollup) {
    return null;
  }
  const label = (h: string) => t(`initiatives.health.label.${h}`);
  // One line per (reason, project), naming the project so "a project is past
  // its target date" says which one.
  const why = [...new Set(rollup.reasons.map(r => `${r.code}|${r.projectId ?? ''}`))]
    .map(key => {
      const [code, projectId] = key.split('|');
      const name = projectId ? projectStore.findById(projectId)?.name : undefined;
      return t(`initiatives.health.reason.${code}`, {
        project: name ?? t('initiatives.health.aProject'),
      });
    })
    .join('; ');
  const full = (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-1.5',
        compact ? 'max-sm:hidden' : '',
        className,
      )}
    >
      {rollup.manualHealth && (
        <Badge tone={healthTone(rollup.manualHealth)}>
          {t('initiatives.health.posted', { health: label(rollup.manualHealth) })}
        </Badge>
      )}
      <Badge
        data-testid="initiative-derived-health"
        title={`${t('initiatives.health.derivedHint')} ${why}`}
        tone={rollup.manualHealth ? 'outline' : healthTone(rollup.health)}
      >
        {t('initiatives.health.derived', { health: label(rollup.health) })}
      </Badge>
      {showReasons && (
        <span className="basis-full text-xs text-muted-foreground">
          {t('initiatives.health.derivedHint')} {why}
        </span>
      )}
    </span>
  );
  if (!compact) {
    return full;
  }
  // Below `sm` there is no room for the pair: one badge carrying the value that
  // counts (the posted update when there is one), with the detail on hover/tap.
  const effective = rollup.manualHealth ?? rollup.health;
  return (
    <>
      <span className={cn('inline-flex sm:hidden', className)}>
        <Badge
          data-testid="initiative-health-compact"
          title={`${t('initiatives.health.derivedHint')} ${why}`}
          tone={healthTone(effective)}
        >
          {label(effective)}
        </Badge>
      </span>
      {full}
    </>
  );
});
