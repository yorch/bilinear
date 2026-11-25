import { describe, expect, it } from 'vitest';
import { translate } from './i18n';
import en from './i18n/locales/en.json';
import es from './i18n/locales/es.json';
import {
  DELIVERY_ERROR_CODES,
  deliveryErrorText,
  deliveryStatusLabel,
  deliveryTone,
} from './webhook-delivery';

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

describe('deliveryErrorText', () => {
  const tEn = (key: string, params?: Record<string, string | number>) =>
    translate('en', key, params);
  const tEs = (key: string, params?: Record<string, string | number>) =>
    translate('es', key, params);

  it('localises a coded failure with its params, per locale', () => {
    const d = {
      errorCode: 'HTTP_STATUS',
      errorMessage: 'Received HTTP 502',
      errorParams: { status: 502 },
    };
    expect(deliveryErrorText(tEn, d)).toBe('The endpoint responded with HTTP 502');
    expect(deliveryErrorText(tEs, d)).toBe('El endpoint respondió con HTTP 502');
  });

  it('falls back to the stored English message for rows without a code', () => {
    expect(deliveryErrorText(tEs, { errorCode: null, errorMessage: 'old row text' })).toBe(
      'old row text',
    );
  });

  it('falls back to the stored message for a code this client does not know', () => {
    expect(
      deliveryErrorText(tEn, { errorCode: 'FUTURE_CODE', errorMessage: 'raw', errorParams: {} }),
    ).toBe('raw');
  });

  it('returns null when there is neither a code nor a message', () => {
    expect(deliveryErrorText(tEn, {})).toBeNull();
  });

  it('uses the no-detail copy instead of rendering an empty placeholder', () => {
    const out = deliveryErrorText(tEn, { errorCode: 'ENOTFOUND', errorParams: null });
    expect(out).toBe("Couldn't resolve the host");
    expect(out).not.toContain('{');
  });

  it('has complete copy in both locales for every code, with and without detail', () => {
    const full = {
      EAI_AGAIN: { target: 'h' },
      ECONNREFUSED: { target: 'h' },
      ENOTFOUND: { target: 'h' },
      HTTP_STATUS: { status: 500 },
      TIMEOUT: { ms: 5 },
      TLS: { tlsCode: 'X' },
    } as Record<string, object>;
    for (const code of DELIVERY_ERROR_CODES) {
      for (const [t, locale] of [
        [tEn, en],
        [tEs, es],
      ] as const) {
        for (const params of [full[code] ?? null, null]) {
          const out = deliveryErrorText(t, { errorCode: code, errorParams: params });
          expect(out, `${code} in ${locale === en ? 'en' : 'es'}`).toBeTruthy();
          expect(out).not.toMatch(/settings\.webhooks|\{/);
        }
      }
    }
  });
});

describe('deliveryStatusLabel', () => {
  const tEn = (key: string) => translate('en', key);
  const tEs = (key: string) => translate('es', key);
  const statuses = ['pending', 'in_flight', 'success', 'failed'];

  it('localises every known status and never leaks the raw enum in es', () => {
    for (const s of statuses) {
      expect(deliveryStatusLabel(tEs, s)).not.toBe(s);
      expect(deliveryStatusLabel(tEs, s)).not.toBe(deliveryStatusLabel(tEn, s));
    }
    expect(deliveryStatusLabel(tEs, 'pending')).toBe('Pendiente');
    expect(deliveryStatusLabel(tEn, 'failed')).toBe('Failed');
  });

  it('passes an unknown status through unchanged', () => {
    expect(deliveryStatusLabel(tEs, 'quarantined')).toBe('quarantined');
  });

  it('keeps the es nav label short enough not to truncate in the 208px rail', () => {
    expect(es.settings.workspace.navLabel.length).toBeLessThanOrEqual(20);
    expect(en.settings.workspace.navLabel.length).toBeLessThanOrEqual(20);
  });
});
