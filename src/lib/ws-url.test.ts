import { describe, expect, it } from 'vitest';
import { resolveWsUrl, type WsOrigin } from './ws-url';

const HTTPS: WsOrigin = {
  host: 'bilinear.brnby.com',
  hostname: 'bilinear.brnby.com',
  protocol: 'https:',
};

const LOCALHOST: WsOrigin = {
  host: 'localhost:3000',
  hostname: 'localhost',
  protocol: 'http:',
};

describe('resolveWsUrl', () => {
  describe('unconfigured (legacy behavior)', () => {
    it('uses hostname + default port, upgrading the scheme on https', () => {
      expect(resolveWsUrl(undefined, HTTPS)).toBe('wss://bilinear.brnby.com:3001');
    });

    it('drops the page port and uses the WS port', () => {
      expect(resolveWsUrl(undefined, LOCALHOST)).toBe('ws://localhost:3001');
    });

    it('honors a custom fallback port', () => {
      expect(resolveWsUrl(null, LOCALHOST, '4444')).toBe('ws://localhost:4444');
    });

    it('treats an empty/whitespace value as unset', () => {
      expect(resolveWsUrl('', HTTPS)).toBe('wss://bilinear.brnby.com:3001');
      expect(resolveWsUrl('   ', HTTPS)).toBe('wss://bilinear.brnby.com:3001');
      expect(resolveWsUrl(undefined, LOCALHOST, '  ')).toBe('ws://localhost:3001');
    });
  });

  describe('same-origin path (the reverse-proxy layout)', () => {
    it('routes a path against the page origin without adding a port', () => {
      expect(resolveWsUrl('/ws', HTTPS)).toBe('wss://bilinear.brnby.com/ws');
    });

    it('carries a non-default page port over, so local dev works', () => {
      expect(resolveWsUrl('/ws', LOCALHOST)).toBe('ws://localhost:3000/ws');
    });

    it('supports a nested path', () => {
      expect(resolveWsUrl('/realtime/sync', HTTPS)).toBe('wss://bilinear.brnby.com/realtime/sync');
    });
  });

  describe('absolute URLs', () => {
    it('uses a wss:// URL verbatim', () => {
      expect(resolveWsUrl('wss://rt.example.com/ws', HTTPS)).toBe('wss://rt.example.com/ws');
    });

    it('uses a ws:// URL verbatim, even on an https page', () => {
      expect(resolveWsUrl('ws://10.0.0.5:3001', HTTPS)).toBe('ws://10.0.0.5:3001');
    });

    it('swaps http(s):// to the matching ws scheme', () => {
      expect(resolveWsUrl('https://rt.example.com/ws', LOCALHOST)).toBe('wss://rt.example.com/ws');
      expect(resolveWsUrl('http://rt.example.com/ws', HTTPS)).toBe('ws://rt.example.com/ws');
    });
  });

  describe('bare host', () => {
    it('adopts the page scheme rather than falling back to the default port', () => {
      expect(resolveWsUrl('rt.example.com', HTTPS)).toBe('wss://rt.example.com');
      expect(resolveWsUrl('rt.example.com:3001', LOCALHOST)).toBe('ws://rt.example.com:3001');
    });
  });

  describe('trailing slashes', () => {
    // The caller appends `?token=…`, so a trailing slash must not survive
    // into `wss://host/ws/?token=…`.
    it('is stripped from every configured shape', () => {
      expect(resolveWsUrl('wss://rt.example.com/ws/', HTTPS)).toBe('wss://rt.example.com/ws');
      expect(resolveWsUrl('https://rt.example.com/', HTTPS)).toBe('wss://rt.example.com');
      expect(resolveWsUrl('/ws/', HTTPS)).toBe('wss://bilinear.brnby.com/ws');
      expect(resolveWsUrl('rt.example.com/', HTTPS)).toBe('wss://rt.example.com');
    });
  });
});
