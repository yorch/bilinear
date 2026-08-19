'use client';

import { Lock, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useTranslations } from '@/hooks/use-translations';
import type { SettingScope } from '@/lib/config';
import type { ResolvedSettingDto } from '@/lib/settings-api';
import { cn, TOUCH_TARGET, TOUCH_TARGET_SQUARE } from '@/lib/utils';

/** A resolved value in the form a text field holds it. */
function toDraft(value: ResolvedSettingDto['value']): string {
  return String(value ?? '');
}

interface SettingControlProps {
  disabled: boolean;
  label: string;
  /** Rejects when the write was refused, which is what reverts the draft. */
  onCommit: (value: boolean | number | string | null) => Promise<void>;
  setting: ResolvedSettingDto;
}

/**
 * The single input for one knob, chosen by its declared type.
 *
 * Split out of `SettingRow` because each branch carries its own draft/commit
 * wiring, and reading them interleaved in one ternary chain meant tracing
 * indentation to work out which `onChange` belonged to which control.
 */
function SettingControl({ disabled, label, onCommit, setting }: SettingControlProps) {
  const t = useTranslations();
  const serverValue = toDraft(setting.value);
  const [draft, setDraft] = useState(serverValue);
  // True while the field has focus. Guards the re-seed below — without it, a
  // concurrent write arriving mid-edit silently discards whatever the admin has
  // typed, which is the classic "sync state from props in an effect" bug.
  const focusedRef = useRef(false);

  // Re-seed when the resolved value changes underneath us (another admin's
  // write, or our own save returning the re-resolved row) — but never while the
  // user is mid-edit.
  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(toDraft(setting.value));
    }
  }, [setting.value]);

  // A rejected write leaves `setting.value` unchanged, so without this the
  // draft would keep the bad value AND re-submit it on every subsequent blur —
  // one duplicate mutation and one duplicate error toast per tab through the
  // field. Reverting makes the rejection visible and stops the loop. The page
  // has already surfaced the error.
  const commit = (value: boolean | number | string | null) => {
    void onCommit(value).catch(() => setDraft(toDraft(setting.value)));
  };

  if (setting.redacted) {
    // Never render a value for a secret — only whether the variable is set.
    // The registry marks these; the server never sends the value.
    return (
      <span className="text-muted-foreground text-xs">
        {setting.envIsSet ? t('config.secretSet') : t('config.secretUnset')}
      </span>
    );
  }

  if (setting.type === 'boolean') {
    return (
      <Switch
        aria-label={label}
        checked={setting.value === true}
        disabled={disabled}
        onCheckedChange={commit}
      />
    );
  }

  if (setting.type === 'enum') {
    return (
      <SimpleSelect
        ariaLabel={label}
        className={cn('w-40', TOUCH_TARGET)}
        disabled={disabled}
        onChange={commit}
        options={(setting.enumValues ?? []).map(v => ({ label: v, value: v }))}
        value={serverValue}
      />
    );
  }

  return (
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
          commit(setting.type === 'string' ? draft : Number(draft));
        }
      }}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      type={setting.type === 'string' ? 'text' : 'number'}
      value={draft}
    />
  );
}

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
  const [busy, setBusy] = useState(false);

  const storedHere = setting.source === scope;
  const disabled = !writable || setting.locked || busy;

  // Rethrows: `SettingControl` reverts its draft on a rejection, and the reset
  // button has no draft to revert.
  const commit = async (value: boolean | number | string | null) => {
    setBusy(true);
    try {
      await onChange(value);
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
        <SettingControl disabled={disabled} label={label} onCommit={commit} setting={setting} />

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
            onClick={() => {
              // The page toasts the failure; there is no draft to restore.
              void commit(null).catch(() => {});
            }}
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
