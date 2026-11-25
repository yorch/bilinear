import { describe, expect, it } from 'vitest';
import { changedWebhookFields, isHttpUrl, webhookUrlErrorKey } from './webhook-form';

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

describe('isHttpUrl', () => {
  it('accepts http(s) and rejects everything else', () => {
    expect(isHttpUrl('https://example.com/hook')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('not-a-url')).toBe(false);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('webhookUrlErrorKey', () => {
  const err = (code: string, reason?: string) => [{ extensions: { code, reason } }];

  it('maps the SSRF rejection to the specific private-URL copy', () => {
    expect(webhookUrlErrorKey(err('BAD_USER_INPUT', 'PRIVATE_URL'))).toBe(
      'settings.webhooks.urlPrivate',
    );
  });

  it('maps a malformed URL to the invalid-URL copy', () => {
    expect(webhookUrlErrorKey(err('BAD_USER_INPUT', 'INVALID_URL'))).toBe(
      'settings.webhooks.urlInvalid',
    );
  });

  it('returns null for anything else so the caller keeps its generic message', () => {
    expect(webhookUrlErrorKey(err('BAD_USER_INPUT'))).toBeNull();
    expect(webhookUrlErrorKey(err('FORBIDDEN', 'PRIVATE_URL'))).toBeNull();
    expect(webhookUrlErrorKey(undefined)).toBeNull();
  });
});
