'use client';

import { useMemo } from 'react';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { ColorSwatchPicker } from '@/components/teams/color-swatch-picker';
import { ColorDot } from '@/components/ui/color-dot';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useTranslations } from '@/hooks/use-translations';
import type { DBWorkflowState } from '@/lib/db';
import {
  AUTO_PERIOD_RANGE,
  CYCLE_COOLDOWN_RANGE,
  CYCLE_DURATION_RANGE,
  ESTIMATION_TYPES,
  type EstimationType,
  listTimezones,
  WEEKDAY_INDEXES,
} from './team-settings-helpers';

/**
 * Presentational cards for the team settings page. They own no server state:
 * the page holds the draft form values and one explicit Save button, matching
 * how the general card has always worked.
 */

const FIELD_LABEL = 'text-xs font-medium text-muted-foreground';
const CARD = 'rounded-lg border border-border bg-card p-5 flex flex-col gap-4';
const SECTION_HEADING = 'mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const NATIVE_SELECT =
  'rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--brand-subtle)] dark:bg-card';

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

export function EstimationCard({
  onChange,
  value,
}: {
  onChange: (value: EstimationType) => void;
  value: EstimationType;
}) {
  const t = useTranslations();
  const options = useMemo(
    () =>
      ESTIMATION_TYPES.map(type => ({
        label: t(`settings.team.estimation.types.${type}`),
        value: type,
      })),
    [t],
  );
  return (
    <section>
      <h2 className={SECTION_HEADING}>{t('settings.team.estimation.title')}</h2>
      <div className={CARD}>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="settings-estimation">
            {t('settings.team.estimation.label')}
          </label>
          <SimpleSelect
            id="settings-estimation"
            onChange={v => onChange(v as EstimationType)}
            options={options}
            value={value}
          />
          <p className="text-xs text-muted-foreground">
            {t(`settings.team.estimation.descriptions.${value}`)}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export function CyclesCard({
  cycleCooldownTime,
  cycleDuration,
  cycleStartDay,
  cyclesEnabled,
  onCycleCooldownTimeChange,
  onCycleDurationChange,
  onCycleStartDayChange,
  onCyclesEnabledChange,
}: {
  cycleCooldownTime: string;
  cycleDuration: string;
  cycleStartDay: number;
  cyclesEnabled: boolean;
  onCycleCooldownTimeChange: (value: string) => void;
  onCycleDurationChange: (value: string) => void;
  onCycleStartDayChange: (value: number) => void;
  onCyclesEnabledChange: (value: boolean) => void;
}) {
  const t = useTranslations();
  const weekdayOptions = useMemo(
    () =>
      WEEKDAY_INDEXES.map(day => ({
        label: t(`settings.team.cycles.weekdays.${day}`),
        value: String(day),
      })),
    [t],
  );
  return (
    <section>
      <h2 className={SECTION_HEADING}>{t('settings.team.cycles.title')}</h2>
      <div className={CARD}>
        <SettingToggleRow
          checked={cyclesEnabled}
          description={t('settings.team.cycles.enabledDescription')}
          label={t('settings.team.cycles.enabled')}
          onCheckedChange={onCyclesEnabledChange}
        />
        {cyclesEnabled && (
          <div className="flex flex-col gap-1">
            <label className={FIELD_LABEL} htmlFor="settings-cycle-duration">
              {t('settings.team.cycles.duration')}
            </label>
            <Input
              className="w-28"
              id="settings-cycle-duration"
              inputMode="numeric"
              max={CYCLE_DURATION_RANGE.max}
              min={CYCLE_DURATION_RANGE.min}
              onChange={e => onCycleDurationChange(e.target.value)}
              type="number"
              value={cycleDuration}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.team.cycles.durationHint')}
            </p>
          </div>
        )}
        {cyclesEnabled && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className={FIELD_LABEL} htmlFor="settings-cycle-start-day">
                {t('settings.team.cycles.startDay')}
              </label>
              <SimpleSelect
                id="settings-cycle-start-day"
                onChange={v => onCycleStartDayChange(Number(v))}
                options={weekdayOptions}
                value={String(cycleStartDay)}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.team.cycles.startDayHint')}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className={FIELD_LABEL} htmlFor="settings-cycle-cooldown">
                {t('settings.team.cycles.cooldown')}
              </label>
              <Input
                className="w-28"
                id="settings-cycle-cooldown"
                inputMode="numeric"
                max={CYCLE_COOLDOWN_RANGE.max}
                min={CYCLE_COOLDOWN_RANGE.min}
                onChange={e => onCycleCooldownTimeChange(e.target.value)}
                type="number"
                value={cycleCooldownTime}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.team.cycles.cooldownHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Auto-close & archive
// ---------------------------------------------------------------------------

export function AutoCloseCard({
  autoArchivePeriod,
  autoCloseChildIssues,
  autoCloseParentIssues,
  autoClosePeriod,
  onAutoArchivePeriodChange,
  onAutoCloseChildIssuesChange,
  onAutoCloseParentIssuesChange,
  onAutoClosePeriodChange,
}: {
  autoArchivePeriod: string;
  autoCloseChildIssues: boolean;
  autoCloseParentIssues: boolean;
  autoClosePeriod: string;
  onAutoArchivePeriodChange: (value: string) => void;
  onAutoCloseChildIssuesChange: (value: boolean) => void;
  onAutoCloseParentIssuesChange: (value: boolean) => void;
  onAutoClosePeriodChange: (value: string) => void;
}) {
  const t = useTranslations();
  return (
    <section>
      <h2 className={SECTION_HEADING}>{t('settings.team.autoClose.title')}</h2>
      <div className={CARD}>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="settings-auto-close">
            {t('settings.team.autoClose.closePeriod')}
          </label>
          <Input
            className="w-28"
            id="settings-auto-close"
            inputMode="numeric"
            max={AUTO_PERIOD_RANGE.max}
            min={AUTO_PERIOD_RANGE.min}
            onChange={e => onAutoClosePeriodChange(e.target.value)}
            placeholder={t('settings.team.autoClose.off')}
            type="number"
            value={autoClosePeriod}
          />
          <p className="text-xs text-muted-foreground">
            {t('settings.team.autoClose.closePeriodHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="settings-auto-archive">
            {t('settings.team.autoClose.archivePeriod')}
          </label>
          <Input
            className="w-28"
            id="settings-auto-archive"
            inputMode="numeric"
            max={AUTO_PERIOD_RANGE.max}
            min={AUTO_PERIOD_RANGE.min}
            onChange={e => onAutoArchivePeriodChange(e.target.value)}
            placeholder={t('settings.team.autoClose.off')}
            type="number"
            value={autoArchivePeriod}
          />
          <p className="text-xs text-muted-foreground">
            {t('settings.team.autoClose.archivePeriodHint')}
          </p>
        </div>
        <SettingToggleRow
          checked={autoCloseChildIssues}
          description={t('settings.team.autoClose.childIssuesDescription')}
          label={t('settings.team.autoClose.childIssues')}
          onCheckedChange={onAutoCloseChildIssuesChange}
        />
        <SettingToggleRow
          checked={autoCloseParentIssues}
          description={t('settings.team.autoClose.parentIssuesDescription')}
          label={t('settings.team.autoClose.parentIssues')}
          onCheckedChange={onAutoCloseParentIssuesChange}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Default issue state
// ---------------------------------------------------------------------------

/**
 * Select of the team's own workflow states (already sorted by position). An
 * empty value means "let the server pick" (its first backlog state).
 */
export function DefaultStateField({
  onChange,
  states,
  value,
}: {
  onChange: (value: string) => void;
  states: readonly DBWorkflowState[];
  value: string;
}) {
  const t = useTranslations();
  const options = useMemo(
    () => [
      { label: t('settings.team.defaultState.serverDefault'), value: '' },
      ...states.map(s => ({ label: s.name, value: s.id })),
    ],
    [states, t],
  );
  return (
    <div className="flex flex-col gap-1">
      <label className={FIELD_LABEL} htmlFor="settings-default-state">
        {t('settings.team.defaultState.label')}
      </label>
      <SimpleSelect
        id="settings-default-state"
        onChange={onChange}
        options={options}
        value={value}
      />
      <p className="text-xs text-muted-foreground">{t('settings.team.defaultState.hint')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity: icon, colour, timezone
// ---------------------------------------------------------------------------

export function TeamIdentityFields({
  color,
  icon,
  onColorChange,
  onIconChange,
  onTimezoneChange,
  timezone,
}: {
  color: string;
  icon: string;
  onColorChange: (value: string) => void;
  onIconChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  timezone: string;
}) {
  const t = useTranslations();
  const zones = useMemo(() => listTimezones(timezone), [timezone]);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="settings-icon">
            {t('settings.team.identity.icon')}
          </label>
          <Input
            className="w-24 text-center"
            id="settings-icon"
            maxLength={8}
            onChange={e => onIconChange(e.target.value)}
            placeholder={t('settings.team.identity.iconPlaceholder')}
            value={icon}
          />
          <p className="text-xs text-muted-foreground">{t('settings.team.identity.iconHint')}</p>
        </div>
        <div className="flex flex-col gap-1">
          <p className={FIELD_LABEL} id="settings-color-label">
            {t('settings.team.identity.color')}
          </p>
          <div className="flex items-center gap-3">
            {color && <ColorDot color={color} size="md" title={color} />}
            <ColorSwatchPicker
              aria-label={t('settings.team.identity.color')}
              onChange={onColorChange}
              value={color}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className={FIELD_LABEL} htmlFor="settings-timezone">
          {t('settings.team.identity.timezone')}
        </label>
        {/* Native <select>: ~400 IANA zones need the browser's type-ahead,
            which the SimpleSelect listbox does not provide. */}
        <select
          className={NATIVE_SELECT}
          id="settings-timezone"
          onChange={e => onTimezoneChange(e.target.value)}
          value={timezone}
        >
          {zones.map(z => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t('settings.team.identity.timezoneHint')}</p>
      </div>
    </>
  );
}
