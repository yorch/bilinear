import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  signPayload,
  verifySignature,
  WebhookInvalidEventError,
  WebhookInvalidUrlError,
  WebhookNoEventsError,
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
  });

  describe('dispatchEvent', () => {
    it('does nothing when no subscribers match', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);
      const result = await service.dispatchEvent(TEST_ORG.id, 'issue.created', { id: 'x' });
      expect(result).toEqual([]);
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it('creates a delivery row for each subscriber', async () => {
      prisma.webhook.findMany.mockResolvedValue([TEST_WEBHOOK]);
      prisma.webhookDelivery.create.mockResolvedValue({
        attempts: 0,
        event: 'issue.created',
        id: 'delivery-1',
        status: 'pending',
        webhookId: TEST_WEBHOOK.id,
      });
      // Stub processDelivery so the test doesn't make real HTTP calls.
      vi.spyOn(service, 'processDelivery').mockResolvedValue();

      const result = await service.dispatchEvent(TEST_ORG.id, 'issue.created', {
        id: 'issue-1',
      });

      expect(result).toHaveLength(1);
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'issue.created',
          status: 'pending',
          webhookId: TEST_WEBHOOK.id,
        }),
      });
    });
  });
});
