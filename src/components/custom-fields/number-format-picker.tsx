'use client';

import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import {
  formatNumberValue,
  isValidCurrencyCode,
  NUMBER_FORMAT_KINDS,
  type NumberFieldFormat,
  type NumberFormatKind,
} from '@/lib/custom-field-format';

const SAMPLE = 1234.5;

/** Format picker for a number field, with a live preview of a sample value. */
export function NumberFormatPicker({
  onChange,
  value,
}: {
  onChange: (next: NumberFieldFormat) => void;
  value: NumberFieldFormat;
}) {
  const t = useTranslations();
  const { intlLocale } = useFormatters();
  const currencyBad =
    value.kind === 'currency' && !!value.currency && !isValidCurrencyCode(value.currency);

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t('customFields.numberFormat.title')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SimpleSelect
          ariaLabel={t('customFields.numberFormat.title')}
          className="w-40"
          onChange={v => onChange({ ...value, kind: v as NumberFormatKind })}
          options={NUMBER_FORMAT_KINDS.map(k => ({
            label: t(`customFields.numberFormat.kinds.${k}`),
            value: k,
          }))}
          value={value.kind}
        />
        {value.kind === 'currency' && (
          <Input
            aria-invalid={currencyBad}
            aria-label={t('customFields.numberFormat.currency')}
            className="w-24 uppercase"
            maxLength={3}
            onChange={e => onChange({ ...value, currency: e.target.value.toUpperCase() })}
            placeholder="USD"
            value={value.currency ?? ''}
          />
        )}
        {value.kind !== 'duration' && (
          <SimpleSelect
            ariaLabel={t('customFields.numberFormat.decimals')}
            className="w-32"
            onChange={v => onChange({ ...value, decimals: v === '' ? undefined : Number(v) })}
            options={[
              { label: t('customFields.numberFormat.decimalsAuto'), value: '' },
              ...[0, 1, 2, 3, 4].map(n => ({
                label: t('customFields.numberFormat.decimalsCount', { count: n }),
                value: String(n),
              })),
            ]}
            value={value.decimals === undefined ? '' : String(value.decimals)}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('customFields.numberFormat.preview')}{' '}
        <span
          className="font-mono tabular-nums text-foreground"
          data-testid="number-format-preview"
        >
          {formatNumberValue(value.kind === 'duration' ? 90 : SAMPLE, value, intlLocale)}
        </span>
        {currencyBad && (
          <span className="ml-2 text-warning-subtle-foreground">
            {t('customFields.numberFormat.invalidCurrency')}
          </span>
        )}
      </p>
      <p className="text-xs text-foreground-faint">{t('customFields.numberFormat.hint')}</p>
    </div>
  );
}
