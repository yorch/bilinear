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
