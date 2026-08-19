'use client';

import { Lock, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTranslations } from '@/hooks/use-translations';
import type { SettingScope } from '@/lib/config';
import type { ResolvedSettingDto } from '@/lib/settings-api';
import { cn, TOUCH_TARGET, TOUCH_TARGET_SQUARE } from '@/lib/utils';

interface SettingRowProps {
  /** Called with the value to store, or `null` to reset to inherited. */
  onChange: (value: boolean | number | string | null) => Promise<void>;
  /** Scope this row is editing at, which decides what "inherited" means. */
  scope: SettingScope;
  setting: ResolvedSettingDto;
  /** False when the caller's role does not satisfy the knob's editableBy. */
  writable: boolean;
}

/**
 * One registry-driven configuration row: label, provenance, control.
 *
 * Rendered identically by the platform console and the workspace settings
 * pages — the registry declaration decides the control type, the bounds and
 * the enum members, so neither page hand-writes a form field. This is the
 * generalisation of `PLAN_LIMIT_FIELDS`, which already did exactly this for
 * five knobs across two pages.
 *
 * Two states are load-bearing rather than cosmetic:
 *
 * - **locked** — an override-mode environment variable supplied the value, so
 *   nothing stored can take effect. The control is disabled and the variable
 *   is named. Accepting a write here would appear to succeed and silently do
 *   nothing, which is the exact confusion the lock exists to prevent.
 * - **inherited vs set here** — a value from a higher layer is shown greyed
 *   with its source, and "reset to inherited" only appears when this scope
 *   actually stores a row. Writing the default is not the same as clearing:
 *   a stored default still shadows a later change to the platform value.
 */
export function SettingRow({ onChange, scope, setting, writable }: SettingRowProps) {
  const t = useTranslations();
  const serverValue = String(setting.value ?? '');
  const [draft, setDraft] = useState(serverValue);
  const [busy, setBusy] = useState(false);
  // True while the field has focus. Guards the re-seed below — without it, a
  // concurrent write arriving mid-edit silently discards whatever the admin has
  // typed, which is the classic "sync state from props in an effect" bug.
  const focusedRef = useRef(false);

  // Re-seed when the resolved value changes underneath us (another admin's
  // write, or our own save returning the re-resolved row) — but never while the
  // user is mid-edit.
  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(setting.value ?? ''));
    }
  }, [setting.value]);

  const storedHere = setting.source === scope;
  const disabled = !writable || setting.locked || busy;

  const commit = async (value: boolean | number | string | null) => {
    setBusy(true);
    try {
      await onChange(value);
    } catch {
      // A rejected write leaves `setting.value` unchanged, so without this the
      // draft would keep the bad value AND re-submit it on every subsequent
      // blur — one duplicate mutation and one duplicate error toast per tab
      // through the field. Reverting makes the rejection visible and stops the
      // loop. The page has already surfaced the error.
      setDraft(String(setting.value ?? ''));
    } finally {
      setBusy(false);
    }
  };

  const label = t(setting.labelKey);

  return (
    <div className="flex items-start justify-between gap-4 border-border border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground text-sm">
            {label === setting.labelKey ? setting.key : label}
          </p>
          {setting.locked && <Lock aria-hidden className="h-3 w-3 text-muted-foreground" />}
        </div>
        <p className="font-mono text-muted-foreground text-xs">{setting.key}</p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {setting.locked && setting.envVarName
            ? t('config.lockedByEnv', { name: setting.envVarName })
            : storedHere
              ? t('config.setHere')
              : t('config.inheritedFrom', { source: setting.source })}
          {setting.restartRequired && ` · ${t('config.restartRequired')}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {setting.redacted ? (
          // Never render a value for a secret — only whether the variable is
          // set. The registry marks these; the server never sends the value.
          <span className="text-muted-foreground text-xs">
            {setting.envIsSet ? t('config.secretSet') : t('config.secretUnset')}
          </span>
        ) : setting.type === 'boolean' ? (
          <Switch
            aria-label={label}
            checked={setting.value === true}
            disabled={disabled}
            onCheckedChange={v => void commit(v)}
          />
        ) : setting.type === 'enum' ? (
          <select
            aria-label={label}
            className={cn(
              'rounded border border-input bg-background px-2 py-1 text-sm focus:border-ring focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50',
              TOUCH_TARGET,
            )}
            disabled={disabled}
            onChange={e => void commit(e.target.value)}
            value={String(setting.value ?? '')}
          >
            {(setting.enumValues ?? []).map(v => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <Input
            aria-label={label}
            className={cn('w-32 text-right font-mono tabular-nums', TOUCH_TARGET)}
            disabled={disabled}
            inputMode={setting.type === 'string' ? 'text' : 'numeric'}
            max={setting.max ?? undefined}
            min={setting.min ?? undefined}
            onBlur={() => {
              focusedRef.current = false;
              if (draft !== serverValue) {
                void commit(setting.type === 'string' ? draft : Number(draft));
              }
            }}
            onChange={e => setDraft(e.target.value)}
            onFocus={() => {
              focusedRef.current = true;
            }}
            type={setting.type === 'string' ? 'text' : 'number'}
            value={draft}
          />
        )}

        {/* Only offered when this scope actually stores a row — there is
            nothing to reset otherwise, and showing it would imply there is. */}
        {writable && !setting.locked && storedHere && (
          <button
            aria-label={t('config.resetToInherited')}
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground',
              TOUCH_TARGET_SQUARE,
            )}
            disabled={busy}
            onClick={() => void commit(null)}
            title={t('config.resetToInherited')}
            type="button"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
