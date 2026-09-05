import { describe, expect, it } from 'vitest';
import { deliveryTone } from './webhook-delivery';

describe('deliveryTone', () => {
  it('renders the terminal states as success and danger', () => {
    expect(deliveryTone('success')).toBe('success');
    expect(deliveryTone('failed')).toBe('danger');
  });

  // A queued retry is not a failure yet; painting it red made a healthy
  // backlog look like an outage.
  it('renders queued and in-flight deliveries as info', () => {
    expect(deliveryTone('pending')).toBe('info');
    expect(deliveryTone('in_flight')).toBe('info');
  });

  it('falls back to muted for a status it does not know', () => {
    expect(deliveryTone('quarantined')).toBe('muted');
  });
});
