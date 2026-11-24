/**
 * Display formats for number custom fields.
 *
 * Display-only: the stored value is always the raw number, so sorting and
 * filtering stay numeric. `percent` values are percentages as typed (45 is
 * "45%", not 4500%); `duration` values are minutes.
 */
export type NumberFormatKind = 'compact' | 'currency' | 'duration' | 'percent' | 'plain';

export interface NumberFieldFormat {
  /** ISO 4217 code; only read for `currency`. */
  currency?: string;
  /** Max fraction digits (0-6); omitted uses a per-kind default. */
  decimals?: number;
  kind: NumberFormatKind;
}

export const NUMBER_FORMAT_KINDS: readonly NumberFormatKind[] = [
  'plain',
  'currency',
  'percent',
  'duration',
  'compact',
];

export const DEFAULT_NUMBER_FORMAT: NumberFieldFormat = { kind: 'plain' };

/** True for a well-formed, recognised ISO 4217 code. */
export function isValidCurrencyCode(code: string | undefined): boolean {
  if (!code || !/^[A-Za-z]{3}$/.test(code)) {
    return false;
  }
  try {
    new Intl.NumberFormat('en', { currency: code, style: 'currency' });
    return true;
  } catch {
    return false;
  }
}

function clampDecimals(d: number | undefined): number | undefined {
  return typeof d === 'number' && Number.isFinite(d)
    ? Math.min(6, Math.max(0, Math.trunc(d)))
    : undefined;
}

function formatDuration(minutes: number, locale: string | undefined): string {
  const negative = minutes < 0;
  let remaining = Math.round(Math.abs(minutes));
  if (remaining === 0) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'narrow',
    }).format(0);
  }
  const days = Math.floor(remaining / 1440);
  remaining -= days * 1440;
  const hours = Math.floor(remaining / 60);
  const mins = remaining - hours * 60;
  const part = (n: number, unit: 'day' | 'hour' | 'minute') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n);
  const parts: string[] = [];
  if (days) {
    parts.push(part(days, 'day'));
  }
  if (hours) {
    parts.push(part(hours, 'hour'));
  }
  if (mins) {
    parts.push(part(mins, 'minute'));
  }
  return (negative ? '-' : '') + parts.join(' ');
}

/**
 * Format `value` for display. Null/undefined/NaN give '' (an empty cell);
 * infinities render as-is. An invalid currency code degrades to the plain
 * number followed by the code as typed, never throws.
 */
export function formatNumberValue(
  value: number | null | undefined,
  format: NumberFieldFormat = DEFAULT_NUMBER_FORMAT,
  locale?: string,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '∞' : '-∞';
  }
  const decimals = clampDecimals(format.decimals);
  switch (format.kind) {
    case 'currency': {
      const code = format.currency?.trim().toUpperCase();
      if (code && isValidCurrencyCode(code)) {
        return new Intl.NumberFormat(locale, {
          currency: code,
          maximumFractionDigits: decimals,
          minimumFractionDigits: decimals,
          style: 'currency',
        }).format(value);
      }
      const plain = new Intl.NumberFormat(locale, {
        maximumFractionDigits: decimals ?? 2,
      }).format(value);
      return code ? `${plain} ${code}` : plain;
    }
    case 'percent':
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: decimals ?? 2,
        style: 'unit',
        unit: 'percent',
      }).format(value);
    case 'duration':
      return formatDuration(value, locale);
    case 'compact':
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: decimals ?? 1,
        notation: 'compact',
      }).format(value);
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals ?? 20 }).format(value);
  }
}

/** Parse an untrusted stored blob into a format, falling back to plain. */
export function parseNumberFormat(raw: unknown): NumberFieldFormat {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_NUMBER_FORMAT;
  }
  const r = raw as Record<string, unknown>;
  const kind = NUMBER_FORMAT_KINDS.find(k => k === r.kind);
  if (!kind) {
    return DEFAULT_NUMBER_FORMAT;
  }
  return {
    ...(typeof r.currency === 'string' ? { currency: r.currency } : {}),
    ...(typeof r.decimals === 'number' ? { decimals: r.decimals } : {}),
    kind,
  };
}

/**
 * The number format stored on a definition. It lives in the definition's
 * `options` JSON as `{ numberFormat: {...} }` (select fields keep an array
 * there), so it syncs with the definition and is the same for every viewer.
 * Anything else (null, an options array, junk) reads as plain.
 */
export function readNumberFormat(options: unknown): NumberFieldFormat {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return DEFAULT_NUMBER_FORMAT;
  }
  return parseNumberFormat((options as Record<string, unknown>).numberFormat);
}

/** True when the format would render differently from the raw number. */
export function isDefaultNumberFormat(format: NumberFieldFormat): boolean {
  return format.kind === 'plain' && format.decimals === undefined;
}

/**
 * The `numberFormat` GraphQL input for a format, or null for "plain" (which
 * clears a stored format). Drops keys that do not apply to the kind so the
 * server's strict validation never trips on a leftover from a previous choice.
 */
export function toNumberFormatInput(format: NumberFieldFormat): NumberFieldFormat | null {
  if (isDefaultNumberFormat(format)) {
    return null;
  }
  const decimals = clampDecimals(format.decimals);
  return {
    ...(format.kind === 'currency' ? { currency: format.currency?.trim().toUpperCase() } : {}),
    ...(decimals !== undefined && format.kind !== 'duration' ? { decimals } : {}),
    kind: format.kind,
  };
}
