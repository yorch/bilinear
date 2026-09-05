import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { getClientIp, isOriginAllowed, isOriginStringAllowed } from './request-security';

function fakeRequest(headers: Record<string, string>, ip?: string): NextRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    ip,
  } as unknown as NextRequest;
}

const saved = {
  APP_URL: process.env.APP_URL,
  GRAPHQL_ALLOWED_ORIGINS: process.env.GRAPHQL_ALLOWED_ORIGINS,
  TRUST_PROXY_HEADERS: process.env.TRUST_PROXY_HEADERS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('isOriginStringAllowed', () => {
  it('accepts APP_URL and every GRAPHQL_ALLOWED_ORIGINS entry, trailing slashes ignored', () => {
    process.env.APP_URL = 'https://app.example.com/';
    process.env.GRAPHQL_ALLOWED_ORIGINS =
      ' https://admin.example.com/ ,, https://other.example.com';
    expect(isOriginStringAllowed('https://app.example.com')).toBe(true);
    expect(isOriginStringAllowed('https://admin.example.com')).toBe(true);
    expect(isOriginStringAllowed('https://other.example.com')).toBe(true);
  });

  it('rejects an Origin that is present but not listed', () => {
    process.env.APP_URL = 'https://app.example.com';
    delete process.env.GRAPHQL_ALLOWED_ORIGINS;
    expect(isOriginStringAllowed('https://evil.example.com')).toBe(false);
    // A scheme or port mismatch is a different origin.
    expect(isOriginStringAllowed('http://app.example.com')).toBe(false);
    expect(isOriginStringAllowed('https://app.example.com:8443')).toBe(false);
  });

  it('allows a missing Origin and disables the check when nothing is configured', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(isOriginStringAllowed(null)).toBe(true);
    delete process.env.APP_URL;
    delete process.env.GRAPHQL_ALLOWED_ORIGINS;
    expect(isOriginStringAllowed('https://anything.example.com')).toBe(true);
  });

  it('isOriginAllowed reads the request header', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(isOriginAllowed(fakeRequest({ Origin: 'https://app.example.com' }))).toBe(true);
    expect(isOriginAllowed(fakeRequest({ Origin: 'https://evil.example.com' }))).toBe(false);
  });
});

describe('getClientIp', () => {
  it('ignores forwarding headers unless TRUST_PROXY_HEADERS is set', () => {
    delete process.env.TRUST_PROXY_HEADERS;
    const req = fakeRequest({ 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' }, '198.51.100.7');
    expect(getClientIp(req)).toBe('198.51.100.7');
  });

  it('takes the first X-Forwarded-For hop, then X-Real-IP, when the proxy is trusted', () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    expect(getClientIp(fakeRequest({ 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' }))).toBe(
      '203.0.113.9',
    );
    expect(getClientIp(fakeRequest({ 'X-Real-IP': '203.0.113.10' }))).toBe('203.0.113.10');
    expect(getClientIp(fakeRequest({}, '198.51.100.7'))).toBe('198.51.100.7');
    expect(getClientIp(fakeRequest({}))).toBeNull();
  });
});
