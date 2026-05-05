import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  isBlockedHost,
  signPayload,
  verifySignature,
  WebhookInvalidEventError,
  WebhookInvalidUrlError,
  WebhookNoEventsError,
  WebhookPrivateUrlError,
  WebhookService,
} from './webhook.service';

const TEST_WEBHOOK = {
  archivedAt: null,
  consecutiveFailures: 0,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  createdById: TEST_USER.id,
  enabled: true,
  events: ['issue.created'],
  id: '00000000-0000-0000-0000-000000000a00',
  lastDeliveryAt: null,
  lastSuccessAt: null,
  name: 'Test webhook',
  organizationId: TEST_ORG.id,
  signingSecret: 'secret123',
  teamId: null,
  updatedAt: new Date('2026-05-01T00:00:00Z'),
  url: 'https://example.com/hook',
};

describe('WebhookService', () => {
  let prisma: MockPrismaClient;
  let service: WebhookService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new WebhookService(prisma as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('creates a webhook with a generated signing secret', async () => {
      prisma.webhook.create.mockResolvedValue(TEST_WEBHOOK);

      const webhook = await service.create(TEST_ORG.id, TEST_USER.id, {
        events: ['issue.created'],
        name: 'Test',
        url: 'https://example.com/hook',
      });

      expect(webhook).toEqual(TEST_WEBHOOK);
      const args = prisma.webhook.create.mock.calls[0][0];
      expect(args.data.signingSecret).toBeTypeOf('string');
      expect(args.data.signingSecret.length).toBeGreaterThan(20);
    });

    it('rejects invalid URLs', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          events: ['issue.created'],
          name: 'Test',
          url: 'not-a-url',
        }),
      ).rejects.toThrow(WebhookInvalidUrlError);
    });

    it('rejects unknown events', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          events: ['issue.invented'],
          name: 'Test',
          url: 'https://example.com/hook',
        }),
      ).rejects.toThrow(WebhookInvalidEventError);
    });

    it('rejects empty events list', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          events: [],
          name: 'Test',
          url: 'https://example.com/hook',
        }),
      ).rejects.toThrow(WebhookNoEventsError);
    });
  });

  describe('signPayload / verifySignature', () => {
    it('produces a hex SHA-256 HMAC', () => {
      const sig = signPayload('hello', 'secret');
      // sha256 hex output is 64 chars
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies a matching signature', () => {
      const body = '{"a":1}';
      const secret = 'topsecret';
      const sig = signPayload(body, secret);
      expect(verifySignature(body, secret, `sha256=${sig}`)).toBe(true);
    });

    it('rejects a mismatched signature', () => {
      const sig = signPayload('hello', 'secret');
      expect(verifySignature('hello', 'other-secret', `sha256=${sig}`)).toBe(false);
    });

    it('handles signatures without sha256= prefix', () => {
      const body = 'x';
      const sig = signPayload(body, 'k');
      expect(verifySignature(body, 'k', sig)).toBe(true);
    });

    it('rejects non-hex header values without throwing', () => {
      // 64 chars but all 'g' — Buffer.from(_, 'hex') silently truncates,
      // so without the regex guard timingSafeEqual would throw on length
      // mismatch. We expect a clean `false`.
      const badHex = 'g'.repeat(64);
      expect(verifySignature('hello', 'secret', `sha256=${badHex}`)).toBe(false);
    });

    it('rejects header values with wrong length', () => {
      expect(verifySignature('hello', 'secret', 'sha256=deadbeef')).toBe(false);
    });

    it('rejects empty header value', () => {
      expect(verifySignature('hello', 'secret', '')).toBe(false);
      expect(verifySignature('hello', 'secret', 'sha256=')).toBe(false);
    });
  });

  describe('isBlockedHost (SSRF guard)', () => {
    it('blocks loopback and meta hostnames', () => {
      expect(isBlockedHost('localhost')).toBe(true);
      expect(isBlockedHost('foo.local')).toBe(true);
      expect(isBlockedHost('bar.internal')).toBe(true);
      expect(isBlockedHost('0')).toBe(true);
    });

    it('blocks dotted-quad IPv4 in private/loopback ranges', () => {
      expect(isBlockedHost('127.0.0.1')).toBe(true);
      expect(isBlockedHost('10.0.0.1')).toBe(true);
      expect(isBlockedHost('192.168.1.1')).toBe(true);
      expect(isBlockedHost('172.16.0.1')).toBe(true);
      expect(isBlockedHost('169.254.169.254')).toBe(true); // AWS IMDS
      expect(isBlockedHost('0.0.0.0')).toBe(true);
    });

    it('blocks decimal-encoded IPv4 (2130706433 = 127.0.0.1)', () => {
      expect(isBlockedHost('2130706433')).toBe(true);
    });

    it('blocks hex-encoded IPv4 (0x7f000001 = 127.0.0.1)', () => {
      expect(isBlockedHost('0x7f000001')).toBe(true);
    });

    it('blocks dotted hex octets (0x7f.0.0.1)', () => {
      expect(isBlockedHost('0x7f.0.0.1')).toBe(true);
    });

    it('blocks IPv4-mapped IPv6 (::ffff:127.0.0.1)', () => {
      expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
      expect(isBlockedHost('::ffff:10.0.0.1')).toBe(true);
    });

    it('blocks IPv6 loopback and ULA / link-local', () => {
      expect(isBlockedHost('::1')).toBe(true);
      expect(isBlockedHost('fe80::1')).toBe(true);
      expect(isBlockedHost('fc00::1')).toBe(true);
      expect(isBlockedHost('fd12::3456')).toBe(true);
    });

    it('allows public hostnames and IPs', () => {
      expect(isBlockedHost('api.example.com')).toBe(false);
      expect(isBlockedHost('1.1.1.1')).toBe(false);
      expect(isBlockedHost('8.8.8.8')).toBe(false);
    });
  });

  describe('validateUrl via create (SSRF integration)', () => {
    afterEach(() => {
      delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
    });

    it('rejects decimal-encoded loopback in production', async () => {
      delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          events: ['issue.created'],
          name: 'evil',
          url: 'http://2130706433/path',
        }),
      ).rejects.toThrow(WebhookPrivateUrlError);
    });

    it('rejects IPv4-mapped IPv6 loopback', async () => {
      delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          events: ['issue.created'],
          name: 'evil',
          url: 'http://[::ffff:127.0.0.1]/x',
        }),
      ).rejects.toThrow(WebhookPrivateUrlError);
    });

    it('allows private URLs only when ALLOW_PRIVATE_WEBHOOK_URLS=1', async () => {
      process.env.ALLOW_PRIVATE_WEBHOOK_URLS = '1';
      prisma.webhook.create.mockResolvedValue(TEST_WEBHOOK);
      // Should NOT throw.
      await service.create(TEST_ORG.id, TEST_USER.id, {
        events: ['issue.created'],
        name: 'dev',
        url: 'http://127.0.0.1:3000/hook',
      });
      expect(prisma.webhook.create).toHaveBeenCalled();
    });
  });

  describe('dispatchEvent', () => {
    it('does nothing when no subscribers match', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);
      const result = await service.dispatchEvent(TEST_ORG.id, 'issue.created', { id: 'x' });
      expect(result).toEqual([]);
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it('batches deliveries with createMany and fires processDelivery per row', async () => {
      const TEST_WEBHOOK_2 = { ...TEST_WEBHOOK, id: '00000000-0000-0000-0000-000000000a01' };
      prisma.webhook.findMany.mockResolvedValue([TEST_WEBHOOK, TEST_WEBHOOK_2]);
      prisma.webhookDelivery.createMany.mockResolvedValue({ count: 2 });
      // Stub processDelivery so the test doesn't make real HTTP calls.
      const spy = vi.spyOn(service, 'processDelivery').mockResolvedValue();

      const result = await service.dispatchEvent(TEST_ORG.id, 'issue.created', {
        id: 'issue-1',
      });

      expect(result).toHaveLength(2);
      // One round-trip (createMany), not N per-row inserts.
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
      expect(prisma.webhookDelivery.createMany).toHaveBeenCalledTimes(1);
      const args = prisma.webhookDelivery.createMany.mock.calls[0][0];
      expect(args.data).toHaveLength(2);
      expect(args.data[0]).toMatchObject({
        event: 'issue.created',
        status: 'pending',
        webhookId: TEST_WEBHOOK.id,
      });
      // Each delivery's first attempt is queued.
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
