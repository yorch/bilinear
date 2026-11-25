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

function fetchFailed(cause: unknown) {
  return Object.assign(new TypeError('fetch failed'), { cause });
}

describe('describeDeliveryError', () => {
  it('surfaces the SSRF block hidden in the cause of undici\'s "fetch failed"', () => {
    const out = describeDeliveryError(fetchFailed(new WebhookPrivateUrlError()));
    expect(out).toEqual({
      code: 'PRIVATE_ADDRESS',
      message: 'fetch failed (Webhook URL cannot point to a private/internal address)',
      params: null,
    });
  });

  it('distinguishes DNS and TLS failures by code', () => {
    const dns = fetchFailed(
      Object.assign(new Error('getaddrinfo ENOTFOUND nope.test'), { code: 'ENOTFOUND' }),
    );
    const tls = fetchFailed(
      Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
    );
    expect(describeDeliveryError(dns).message).toContain('ENOTFOUND');
    expect(describeDeliveryError(tls).message).toContain('CERT_HAS_EXPIRED');
    expect(describeDeliveryError(dns).code).toBe('ENOTFOUND');
    expect(describeDeliveryError(tls)).toMatchObject({
      code: 'TLS',
      params: { tlsCode: 'CERT_HAS_EXPIRED' },
    });
  });

  it('maps known network codes to plain language, a code and params', () => {
    const dns = fetchFailed(
      Object.assign(new Error('getaddrinfo ENOTFOUND hooks.example.com'), { code: 'ENOTFOUND' }),
    );
    const refused = fetchFailed(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }),
    );
    expect(describeDeliveryError(dns)).toEqual({
      code: 'ENOTFOUND',
      message: "Couldn't resolve host hooks.example.com (ENOTFOUND)",
      params: { target: 'hooks.example.com' },
    });
    expect(describeDeliveryError(refused)).toEqual({
      code: 'ECONNREFUSED',
      message: 'Connection refused by 10.0.0.1:443 (ECONNREFUSED)',
      params: { target: '10.0.0.1:443' },
    });
  });

  it('classifies EAI_AGAIN, ECONNRESET and connect timeouts', () => {
    const codeOf = (code: string) =>
      describeDeliveryError(fetchFailed(Object.assign(new Error(`x ${code} y`), { code }))).code;
    expect(codeOf('EAI_AGAIN')).toBe('EAI_AGAIN');
    expect(codeOf('ECONNRESET')).toBe('ECONNRESET');
    expect(codeOf('UND_ERR_CONNECT_TIMEOUT')).toBe('TIMEOUT');
    expect(codeOf('ETIMEDOUT')).toBe('TIMEOUT');
  });

  it('leaves an unclassifiable failure uncoded with the raw description', () => {
    const out = describeDeliveryError(new Error('boom'));
    expect(out).toEqual({ code: null, message: 'boom', params: null });
  });

  it('strips URL credentials from the message and from params, and bounds the length', () => {
    const err = fetchFailed(
      new Error(`connect to https://user:hunter2@internal.test/x failed ${'x'.repeat(2000)}`),
    );
    const out = describeDeliveryError(err);
    expect(out.message).not.toContain('hunter2');
    expect(out.message).toContain('https://***@internal.test');
    expect(out.message.length).toBeLessThanOrEqual(500);

    const leaky = describeDeliveryError(
      fetchFailed(
        Object.assign(new Error('getaddrinfo ENOTFOUND https://u:hunter2@h.test/'), {
          code: 'ENOTFOUND',
        }),
      ),
    );
    expect(JSON.stringify(leaky)).not.toContain('hunter2');
  });

  it('reports a timeout plainly, with the limit as a param', () => {
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    expect(describeDeliveryError(abort, 10_000)).toEqual({
      code: 'TIMEOUT',
      message: 'Request timed out after 10000 ms',
      params: { ms: 10_000 },
    });
    expect(describeDeliveryError(abort)).toMatchObject({ code: 'TIMEOUT', params: null });
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
    expect(data.errorCode).toBe('PRIVATE_ADDRESS');
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
