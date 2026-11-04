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
import { parseNumberDraft } from './number-draft';

/** A resolved value in the form a text field holds it. */
function toDraft(value: ResolvedSettingDto['value']): string {
  return String(value ?? '');
}

/**
 * Where this value came from, in one sentence.
 *
 * Four states, written as guard clauses rather than a nested ternary: an
 * environment variable that is forcing the value, one that *would* force it but
 * is unset (env-only knobs are locked either way, and claiming "forced by
 * SMTP_HOST" when nothing set it is a lie), a row stored at this scope, and
 * everything else — inherited from a layer above.
 */
function provenance(
  t: (key: string, params?: Record<string, string>) => string,
  setting: ResolvedSettingDto,
  storedHere: boolean,
): string {
  if (setting.locked && setting.envVarName) {
    return setting.envIsSet
      ? t('config.lockedByEnv', { name: setting.envVarName })
      : t('config.unsetEnv', { name: setting.envVarName });
  }
  return storedHere ? t('config.setHere') : t('config.inheritedFrom', { source: setting.source });
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
  const [draftError, setDraftError] = useState<string | null>(null);

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
  //
  // Guarded by `focusedRef` for the same reason the re-seed above is. The field
  // is disabled for the whole round trip, so today the user cannot have retyped
  // by the time this lands — but that is a property of `busy`, not of this
  // code, and "never overwrite a draft the user is editing" should hold here
  // without depending on it.
  const commit = (value: boolean | number | string | null) => {
    void onCommit(value).catch(() => {
      if (!focusedRef.current) {
        setDraft(toDraft(setting.value));
      }
    });
  };

  // Fields the registry marks locked (an environment variable supplies the
  // value) can never be edited here, so they read as plain text rather than as
  // a disabled, often empty, box that looks like an editable field that broke.
  if (setting.locked && !setting.redacted) {
    const shown = toDraft(setting.value);
    return shown === '' ? (
      <span className="text-muted-foreground text-xs">{t('config.secretUnset')}</span>
    ) : (
      <span className="max-w-full break-all font-mono text-foreground-secondary text-sm">
        {shown}
      </span>
    );
  }

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

  const isNumber = setting.type !== 'string';

  // Number knobs commit on blur or Enter, but only a valid number: an emptied
  // field is rejected (not stored as 0) and an out-of-range one is explained
  // inline instead of surfacing later as a server toast.
  const commitDraft = () => {
    if (draft === serverValue) {
      setDraftError(null);
      return;
    }
    if (!isNumber) {
      commit(draft);
      return;
    }
    const parsed = parseNumberDraft(draft, { max: setting.max, min: setting.min });
    if (!parsed.ok) {
      setDraftError(
        parsed.reason === 'range'
          ? t('config.numberRange', {
              max: String(setting.max ?? '∞'),
              min: String(setting.min ?? '-∞'),
            })
          : t('config.numberRequired'),
      );
      return;
    }
    setDraftError(null);
    commit(parsed.value);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        aria-describedby={draftError ? `${setting.key}-error` : undefined}
        aria-invalid={draftError ? true : undefined}
        aria-label={label}
        className={cn(
          'text-right font-mono tabular-nums',
          isNumber ? 'w-32' : 'w-40 sm:w-56',
          TOUCH_TARGET,
        )}
        disabled={disabled}
        inputMode={isNumber ? 'numeric' : 'text'}
        max={setting.max ?? undefined}
        min={setting.min ?? undefined}
        onBlur={() => {
          focusedRef.current = false;
          commitDraft();
        }}
        onChange={e => {
          setDraft(e.target.value);
          setDraftError(null);
        }}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDraft();
          } else if (e.key === 'Escape') {
            setDraft(serverValue);
            setDraftError(null);
          }
        }}
        placeholder={isNumber ? undefined : t('config.usingDefault')}
        type={isNumber ? 'number' : 'text'}
        value={draft}
      />
      {draftError && (
        <p
          className="max-w-48 text-right text-danger-subtle-foreground text-xs"
          id={`${setting.key}-error`}
          role="alert"
        >
          {draftError}
        </p>
      )}
    </div>
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
    <div
      className="flex flex-col gap-2 border-border border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      // Addressable by knob, so an e2e spec targets a row by its key rather
      // than by a Tailwind utility list — the locator that broke the triage
      // specs when one `cn()` edit made it match nothing.
      data-testid={`setting-row-${setting.key}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground text-sm">
            {label === setting.labelKey ? setting.key : label}
          </p>
          {setting.locked && (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
              <Lock aria-hidden className="h-3 w-3" />
              {t('config.readOnlyChip')}
            </span>
          )}
        </div>
        <p className="break-all font-mono text-muted-foreground text-xs">{setting.key}</p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {provenance(t, setting, storedHere)}
          {setting.restartRequired && ` · ${t('config.restartRequired')}`}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:shrink-0">
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
