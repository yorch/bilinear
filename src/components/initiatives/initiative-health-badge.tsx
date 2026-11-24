'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { Badge } from '@/components/ui/badge';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { cn } from '@/lib/utils';

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
 */
export function InitiativeHealthProvider({ children }: { children: ReactNode }) {
  const { data } = useRetryableFetch<Map<string, InitiativeHealthRollup>>(
    async () => {
      const rows = await gqlQuery<InitiativeHealthRollup[]>(QUERY, {}, 'initiativeHealthRollups');
      return new Map((rows ?? []).map(r => [r.initiativeId, r]));
    },
    [],
    new Map(),
  );
  return <HealthContext.Provider value={data}>{children}</HealthContext.Provider>;
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
export function InitiativeHealthBadge({
  className,
  initiativeId,
  showReasons = false,
}: {
  className?: string;
  initiativeId: string;
  /** Spell out why the derived value is what it is (detail page). */
  showReasons?: boolean;
}) {
  const t = useTranslations();
  const rollup = useContext(HealthContext).get(initiativeId);
  if (!rollup) {
    return null;
  }
  const label = (h: string) => t(`initiatives.health.label.${h}`);
  const codes = [...new Set(rollup.reasons.map(r => r.code))];
  const why = codes.map(c => t(`initiatives.health.reason.${c}`)).join('; ');
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
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
}
