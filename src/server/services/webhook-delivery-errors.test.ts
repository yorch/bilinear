import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';

// Hermetic DNS: `vm` is a hostname that /etc/hosts maps to loopback, `public.test`
// resolves to a public address, anything else fails like a missing record.
const lookupMock = vi.fn(async (host: string) => {
  if (host === 'vm') {
    return [{ address: '127.0.0.1', family: 4 }];
  }
  if (host === 'public.test') {
    return [{ address: '93.184.216.34', family: 4 }];
  }
  throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
});
vi.mock('node:dns/promises', () => ({
  lookup: (host: string) => lookupMock(host),
}));

import {
  describeDeliveryError,
  readBodyCapped,
  WebhookPrivateUrlError,
  WebhookService,
} from './webhook.service';

const WEBHOOK = {
  archivedAt: null,
  consecutiveFailures: 0,
  createdById: TEST_USER.id,
  enabled: true,
  events: ['issue.created'],
  id: '00000000-0000-0000-0000-000000000a00',
  name: 'hook',
  organizationId: TEST_ORG.id,
  signingSecret: 'secret123',
  teamId: null,
  url: 'http://vm:3000/hook',
};

describe('describeDeliveryError', () => {
  it('surfaces the SSRF block hidden in the cause of undici\'s "fetch failed"', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: new WebhookPrivateUrlError(),
    });
    expect(describeDeliveryError(err)).toBe(
      'fetch failed (Webhook URL cannot point to a private/internal address)',
    );
  });

  it('distinguishes DNS and TLS failures by code', () => {
    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND nope.test'), { code: 'ENOTFOUND' }),
    });
    const tls = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
    });
    expect(describeDeliveryError(dns)).toContain('ENOTFOUND');
    expect(describeDeliveryError(tls)).toContain('CERT_HAS_EXPIRED');
    expect(describeDeliveryError(dns)).not.toBe(describeDeliveryError(tls));
  });

  it('strips URL credentials and bounds the length', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: new Error(
        `connect to https://user:hunter2@internal.test/x failed ${'x'.repeat(2000)}`,
      ),
    });
    const out = describeDeliveryError(err);
    expect(out).not.toContain('hunter2');
    expect(out).toContain('https://***@internal.test');
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it('reports a timeout plainly', () => {
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    expect(describeDeliveryError(abort, 10_000)).toBe('Request timed out after 10000 ms');
  });
});

describe('readBodyCapped', () => {
  it('stops reading and cancels an endless body instead of buffering it all', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode('a'.repeat(1024)));
      },
    });
    const text = await readBodyCapped(new Response(body));
    expect(text).toHaveLength(1000);
    expect(cancelled).toBe(true);
    // 4096 byte read cap at 1 KiB per chunk: a handful of pulls, not unbounded
    expect(pulls).toBeLessThanOrEqual(8);
  });

  it('returns small bodies whole', async () => {
    expect(await readBodyCapped(new Response('hello'))).toBe('hello');
    expect(await readBodyCapped(new Response(null, { status: 204 }))).toBe('');
  });
});

describe('private hostnames that resolve to loopback', () => {
  let prisma: MockPrismaClient;
  let service: WebhookService;
  beforeEach(() => {
    lookupMock.mockClear();
    prisma = createMockPrisma();
    service = new WebhookService(prisma as never);
  });

  it('is rejected at create time by resolving the name', async () => {
    await expect(
      service.create(TEST_ORG.id, TEST_USER.id, {
        events: ['issue.created'],
        name: 'x',
        url: 'http://vm:3000/',
      }),
    ).rejects.toBeInstanceOf(WebhookPrivateUrlError);
    expect(prisma.webhook.create).not.toHaveBeenCalled();
  });

  it('is rejected at update time too', async () => {
    await expect(
      service.update(TEST_ORG.id, WEBHOOK.id, { url: 'http://vm:3000/' }),
    ).rejects.toBeInstanceOf(WebhookPrivateUrlError);
    expect(prisma.webhook.updateMany).not.toHaveBeenCalled();
  });

  it('still accepts public and not-yet-resolvable names (delivery re-checks)', async () => {
    prisma.webhook.create.mockResolvedValue(WEBHOOK);
    for (const url of ['https://public.test/hook', 'https://not-live-yet.test/hook']) {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, { events: ['issue.created'], name: 'x', url }),
      ).resolves.toBeDefined();
    }
  });

  it('is blocked at delivery by the pinned dispatcher even if it slipped past create', async () => {
    // A row that predates the check (or whose DNS changed after create).
    const delivery = {
      attempts: 0,
      event: 'issue.created',
      id: '00000000-0000-0000-0000-000000000b00',
      payload: { data: {}, event: 'issue.created' },
      webhook: WEBHOOK,
      webhookId: WEBHOOK.id,
    };
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.webhookDelivery.findUnique.mockResolvedValue(delivery);
    prisma.webhookDelivery.update.mockResolvedValue({});
    prisma.webhook.update.mockResolvedValue({});

    await service.processDelivery(delivery.id);

    const data = prisma.webhookDelivery.update.mock.calls[0]?.[0].data;
    expect(data.status).toBe('pending'); // scheduled for retry, never delivered
    expect(data.responseStatus).toBeNull();
    // the reason is visible, not a bare "fetch failed"
    expect(data.errorMessage).toContain('private/internal address');
    expect(lookupMock).toHaveBeenCalledWith('vm');
  });
});

describe('processDelivery response capture', () => {
  it('does not download an endless response body before truncating it', async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('z'.repeat(1024)));
      },
    });
    const prisma = createMockPrisma();
    const fetchMock = vi.fn().mockResolvedValue(new Response(endless, { status: 200 }));
    const service = new WebhookService(prisma as never, undefined, undefined, fetchMock as never);
    const delivery = {
      attempts: 0,
      event: 'issue.created',
      id: '00000000-0000-0000-0000-000000000b01',
      payload: { data: {}, event: 'issue.created' },
      webhook: { ...WEBHOOK, url: 'https://93.184.216.34/hook' },
      webhookId: WEBHOOK.id,
    };
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.webhookDelivery.findUnique.mockResolvedValue(delivery);
    prisma.webhookDelivery.update.mockResolvedValue({});
    prisma.webhook.update.mockResolvedValue({});

    await service.processDelivery(delivery.id);

    expect(cancelled).toBe(true);
    expect(prisma.webhookDelivery.update.mock.calls[0]?.[0].data.responseBody).toHaveLength(1000);
  });
});
