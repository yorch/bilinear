import { describe, expect, it } from 'vitest';
import { changedWebhookFields } from './webhook-form';

const current = {
  events: ['issue.created', 'issue.updated'],
  name: 'Hook',
  url: 'https://a.test/x',
};

describe('changedWebhookFields', () => {
  it('sends only the name when only the name changed', () => {
    expect(changedWebhookFields(current, { ...current, name: 'Renamed' })).toEqual({
      name: 'Renamed',
    });
  });

  it('sends nothing when nothing changed, including a reordered event list', () => {
    expect(changedWebhookFields(current, { ...current })).toEqual({});
    expect(
      changedWebhookFields(current, { ...current, events: ['issue.updated', 'issue.created'] }),
    ).toEqual({});
  });

  it('reports each changed field, and a different event set', () => {
    expect(
      changedWebhookFields(current, {
        events: ['issue.created'],
        name: 'Hook',
        url: 'https://b.test',
      }),
    ).toEqual({ events: ['issue.created'], url: 'https://b.test' });
  });
});
