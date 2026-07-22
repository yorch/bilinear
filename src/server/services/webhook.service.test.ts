import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  isBlockedHost,
  signPayload,
  verifySignature,
  WebhookInvalidEventError,
  WebhookInvalidNameError,
  WebhookInvalidUrlError,
  WebhookNoEventsError,
  WebhookPrivateUrlError,
  WebhookService,
} from './webhook.service';

// Mirrors the private constants in webhook.service.ts (not exported — kept
// in sync by name/value so these tests fail loudly if the schedule drifts).
const REQUEST_TIMEOUT_MS = 10_000;
const CLAIM_WINDOW_MS = REQUEST_TIMEOUT_MS + 60_000; // 70s
const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_SECONDS = [30, 120, 600, 1800, 7200];
const AUTO_DISABLE_AFTER = 20;

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

// A public IP-literal URL so processDelivery's assertSafeUrl() short-
// circuits on parseIpLiteral() and never calls dns.lookup() — keeps these
// tests hermetic (no real DNS resolution) and deterministic.
const TEST_WEBHOOK_IP = { ...TEST_WEBHOOK, url: 'https://93.184.216.34/hook' };

const TEST_DELIVERY = {
  attempts: 0,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  deliveredAt: null,
  errorMessage: null,
  event: 'issue.created',
  id: '00000000-0000-0000-0000-000000000b00',
  nextAttemptAt: new Date('2026-06-01T00:00:00Z'),
  payload: {
    data: { id: 'issue-1' },
    deliveryId: '00000000-0000-0000-0000-000000000b00',
    event: 'issue.created',
    organizationId: TEST_ORG.id,
    timestamp: '2026-06-01T00:00:00.000Z',
  },
  responseBody: null,
  responseStatus: null,
  status: 'pending',
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  webhookId: TEST_WEBHOOK_IP.id,
};

const FROZEN_NOW = new Date('2026-06-01T00:00:00.000Z');

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

    it('rejects a name over the length cap', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          events: ['issue.created'],
          name: 'a'.repeat(257),
          url: 'https://example.com/hook',
        }),
      ).rejects.toThrow(WebhookInvalidNameError);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects a name over the length cap', async () => {
      await expect(
        service.update(TEST_ORG.id, TEST_WEBHOOK.id, { name: 'a'.repeat(257) }),
      ).rejects.toThrow(WebhookInvalidNameError);
      expect(prisma.webhook.updateMany).not.toHaveBeenCalled();
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

  describe('processDelivery', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
      vi.useFakeTimers();
      vi.setSystemTime(FROZEN_NOW);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    describe('atomic pending→in_flight claim', () => {
      it('claims via a conditional updateMany with a pending-or-stale-in_flight where-guard', async () => {
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        fetchMock.mockResolvedValue({ status: 200, text: async () => 'ok' });

        await service.processDelivery(TEST_DELIVERY.id);

        expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledTimes(1);
        const [claimArgs] = prisma.webhookDelivery.updateMany.mock.calls[0];
        expect(claimArgs.where.id).toBe(TEST_DELIVERY.id);
        expect(claimArgs.data.status).toBe('in_flight');
        // Claim deadline stamped into nextAttemptAt is symmetric with the
        // reclaim window below (now + CLAIM_WINDOW_MS).
        expect(claimArgs.data.nextAttemptAt).toEqual(
          new Date(FROZEN_NOW.getTime() + CLAIM_WINDOW_MS),
        );
        // The where-guard: claim if pending, OR if a prior claim's window
        // (in_flight + stale nextAttemptAt) has elapsed.
        const pendingArm = claimArgs.where.OR.find(
          (c: { status: string }) => c.status === 'pending',
        );
        expect(pendingArm).toEqual({ status: 'pending' });
        const staleArm = claimArgs.where.OR.find(
          (c: { status: string }) => c.status === 'in_flight',
        );
        expect(staleArm.nextAttemptAt).toEqual({
          lte: new Date(FROZEN_NOW.getTime() - CLAIM_WINDOW_MS),
        });
        // Claim succeeded, so the delivery was actually fetched.
        expect(prisma.webhookDelivery.findUnique).toHaveBeenCalledWith({
          include: { webhook: true },
          where: { id: TEST_DELIVERY.id },
        });
      });

      it('does not re-claim a row already in_flight within its (non-stale) claim window', async () => {
        // updateMany returns count 0 — the where-guard above (pending OR
        // stale-in_flight) simply doesn't match a fresh in_flight row on a
        // real Postgres, so the mock is set up to reflect that outcome.
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });

        await service.processDelivery(TEST_DELIVERY.id);

        // No further work happens — no read of the row, no HTTP attempt, no
        // status-transition writes. A second concurrent runner is a no-op.
        expect(prisma.webhookDelivery.findUnique).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('reclaims a stale in_flight row past the claim deadline and proceeds with delivery', async () => {
        // Row is in_flight (a prior worker claimed it) but its claim window
        // has elapsed — the mock reflects a successful reclaim (count: 1).
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          nextAttemptAt: new Date(FROZEN_NOW.getTime() - CLAIM_WINDOW_MS - 1000),
          status: 'in_flight',
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        fetchMock.mockResolvedValue({ status: 200, text: async () => 'ok' });

        await service.processDelivery(TEST_DELIVERY.id);

        // The claim query's stale-reclaim arm is exactly the boundary a
        // Postgres `lte` comparison would use to pick up this row.
        const [claimArgs] = prisma.webhookDelivery.updateMany.mock.calls[0];
        const staleArm = claimArgs.where.OR.find(
          (c: { status: string }) => c.status === 'in_flight',
        );
        expect(staleArm.nextAttemptAt.lte.getTime()).toBe(FROZEN_NOW.getTime() - CLAIM_WINDOW_MS);
        // Reclaim succeeded, so processing continued past the claim.
        expect(prisma.webhookDelivery.findUnique).toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    describe('success path', () => {
      it('marks a 2xx delivery delivered, resets consecutiveFailures, and schedules no retry', async () => {
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          attempts: 0,
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        fetchMock.mockResolvedValue({ status: 204, text: async () => '' });

        await service.processDelivery(TEST_DELIVERY.id);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
          data: {
            attempts: 1,
            deliveredAt: FROZEN_NOW,
            errorMessage: null,
            nextAttemptAt: null,
            responseBody: '',
            responseStatus: 204,
            status: 'success',
          },
          where: { id: TEST_DELIVERY.id },
        });
        expect(prisma.webhook.update).toHaveBeenCalledWith({
          data: {
            consecutiveFailures: 0,
            lastDeliveryAt: FROZEN_NOW,
            lastSuccessAt: FROZEN_NOW,
          },
          where: { id: TEST_WEBHOOK_IP.id },
        });
        // No retry: exactly one webhookDelivery.update call (the success
        // write), and it never touches the pending/failed retry fields.
        expect(prisma.webhookDelivery.update).toHaveBeenCalledTimes(1);
      });
    });

    describe('failure + backoff', () => {
      it('increments attempts and schedules nextAttemptAt per RETRY_BACKOFF_SECONDS on the first failure', async () => {
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          attempts: 0,
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        fetchMock.mockResolvedValue({ status: 500, text: async () => 'server error' });

        await service.processDelivery(TEST_DELIVERY.id);

        expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
          data: {
            attempts: 1,
            errorMessage: null,
            nextAttemptAt: new Date(FROZEN_NOW.getTime() + RETRY_BACKOFF_SECONDS[0] * 1000),
            responseBody: 'server error',
            responseStatus: 500,
            status: 'pending',
          },
          where: { id: TEST_DELIVERY.id },
        });
        expect(prisma.webhook.update).toHaveBeenCalledWith({
          data: { lastDeliveryAt: FROZEN_NOW },
          where: { id: TEST_WEBHOOK_IP.id },
        });
        // Not yet at MAX_ATTEMPTS — the auto-disable guard must not run.
        expect(prisma.webhook.updateMany).not.toHaveBeenCalled();
      });

      it('records a network error as errorMessage and still schedules a backoff retry', async () => {
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          attempts: 1,
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

        await service.processDelivery(TEST_DELIVERY.id);

        expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
          data: {
            attempts: 2,
            errorMessage: 'ECONNREFUSED',
            nextAttemptAt: new Date(FROZEN_NOW.getTime() + RETRY_BACKOFF_SECONDS[1] * 1000),
            responseBody: null,
            responseStatus: null,
            status: 'pending',
          },
          where: { id: TEST_DELIVERY.id },
        });
      });

      it('marks the delivery failed on the final attempt without scheduling a further retry', async () => {
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          attempts: MAX_ATTEMPTS - 1,
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        prisma.webhook.updateMany.mockResolvedValue({ count: 0 });
        fetchMock.mockResolvedValue({ status: 503, text: async () => 'down' });

        await service.processDelivery(TEST_DELIVERY.id);

        expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
          data: {
            attempts: MAX_ATTEMPTS,
            errorMessage: null,
            nextAttemptAt: null,
            responseBody: 'down',
            responseStatus: 503,
            status: 'failed',
          },
          where: { id: TEST_DELIVERY.id },
        });
        expect(prisma.webhook.update).toHaveBeenCalledWith({
          data: { consecutiveFailures: { increment: 1 }, lastDeliveryAt: FROZEN_NOW },
          where: { id: TEST_WEBHOOK_IP.id },
        });
        // Only ever one delivery-row write on the final attempt — no
        // separate retry-scheduling write follows it.
        expect(prisma.webhookDelivery.update).toHaveBeenCalledTimes(1);
      });
    });

    describe('auto-disable', () => {
      it('disables the webhook via a conditional updateMany once consecutiveFailures reaches AUTO_DISABLE_AFTER', async () => {
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          attempts: MAX_ATTEMPTS - 1,
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        // Simulates the DB row having reached the threshold.
        prisma.webhook.updateMany.mockResolvedValue({ count: 1 });
        fetchMock.mockResolvedValue({ status: 500, text: async () => 'err' });

        await service.processDelivery(TEST_DELIVERY.id);

        expect(prisma.webhook.updateMany).toHaveBeenCalledWith({
          data: { enabled: false },
          where: {
            consecutiveFailures: { gte: AUTO_DISABLE_AFTER },
            enabled: true,
            id: TEST_WEBHOOK_IP.id,
          },
        });
      });

      it('uses a where-guard that cannot clobber a concurrent success (count 0 -> no throw, no double-disable)', async () => {
        prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
        prisma.webhookDelivery.findUnique.mockResolvedValue({
          ...TEST_DELIVERY,
          attempts: MAX_ATTEMPTS - 1,
          webhook: TEST_WEBHOOK_IP,
        });
        prisma.webhookDelivery.update.mockResolvedValue({});
        prisma.webhook.update.mockResolvedValue({});
        // A concurrent successful delivery already reset consecutiveFailures
        // to 0 in the "real" DB, so the conditional updateMany matches
        // nothing here — the guard clause (consecutiveFailures gte
        // threshold AND enabled: true) is what prevents the clobber.
        prisma.webhook.updateMany.mockResolvedValue({ count: 0 });
        fetchMock.mockResolvedValue({ status: 500, text: async () => 'err' });

        await expect(service.processDelivery(TEST_DELIVERY.id)).resolves.toBeUndefined();

        expect(prisma.webhook.updateMany).toHaveBeenCalledWith({
          data: { enabled: false },
          where: {
            consecutiveFailures: { gte: AUTO_DISABLE_AFTER },
            enabled: true,
            id: TEST_WEBHOOK_IP.id,
          },
        });
      });
    });
  });
});
