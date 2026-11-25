/** The subset of `Badge` tones a delivery status can render as. */
export type DeliveryTone = 'danger' | 'info' | 'muted' | 'success';

export type WebhookDeliveryStatus = 'failed' | 'in_flight' | 'pending' | 'success';

/**
 * Delivery status → badge tone. `success`/`failed` are the terminal states;
 * `pending` and `in_flight` are both "not yet known" and read as info so a
 * retry queue never looks like a wall of failures. Anything unrecognised is
 * muted rather than thrown on: the server owns this enum and may grow it.
 */
export function deliveryTone(status: string): DeliveryTone {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
    case 'in_flight':
      return 'info';
    default:
      return 'muted';
  }
}

/** The failure classes the server records on a delivery (`errorCode`). */
export const DELIVERY_ERROR_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'HTTP_STATUS',
  'PRIVATE_ADDRESS',
  'TIMEOUT',
  'TLS',
  'URL_NOT_ALLOWED',
  'WEBHOOK_DISABLED',
] as const;

/** The param whose absence selects a `…NoDetail` variant of the copy. */
const DETAIL_PARAM: Partial<Record<(typeof DELIVERY_ERROR_CODES)[number], string>> = {
  ECONNREFUSED: 'target',
  EAI_AGAIN: 'target',
  ENOTFOUND: 'target',
  TIMEOUT: 'ms',
  TLS: 'tlsCode',
};

export interface DeliveryErrorFields {
  errorCode?: string | null;
  errorMessage?: string | null;
  errorParams?: unknown;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Localised reason for a failed delivery attempt. The server stores a stable
 * `errorCode` plus interpolation `errorParams`; the English `errorMessage` is
 * only the fallback for rows that predate codes or carry a code this client
 * does not know yet (the server may grow the set). Returns null when there is
 * nothing to show.
 */
export function deliveryErrorText(t: Translate, d: DeliveryErrorFields): string | null {
  const code = DELIVERY_ERROR_CODES.find(c => c === d.errorCode);
  if (!code) {
    return d.errorMessage ?? null;
  }
  const params: Record<string, string | number> = {};
  if (d.errorParams && typeof d.errorParams === 'object') {
    for (const [k, v] of Object.entries(d.errorParams)) {
      if (typeof v === 'string' || typeof v === 'number') {
        params[k] = v;
      }
    }
  }
  const needed = DETAIL_PARAM[code];
  const suffix = needed && !(needed in params) ? 'NoDetail' : '';
  return t(`settings.webhooks.deliveries.errors.${code}${suffix}`, params);
}
