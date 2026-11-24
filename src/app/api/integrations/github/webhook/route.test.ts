import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOrg = vi.fn();
const validate = vi.fn();
vi.mock('@/server/lib/prisma', () => ({
  prisma: { organization: { findUnique: (a: unknown) => findOrg(a) } },
}));
vi.mock('@/server/config', () => ({ config: {} }));
vi.mock('@/server/services/github.service', () => ({
  GitHubService: class {
    validateWebhookSignature = validate;
    handlePullRequestEvent = vi.fn().mockResolvedValue(undefined);
  },
}));

import { GITHUB_WEBHOOK_MAX_BYTES, POST } from './route';

const post = (url: string, body: BodyInit, headers: Record<string, string> = {}) =>
  POST(new NextRequest(url, { body, headers, method: 'POST' }));
const BASE = 'http://localhost/api/integrations/github/webhook';

describe('github webhook route', () => {
  beforeEach(() => {
    findOrg.mockReset();
    validate.mockReset();
  });

  it('answers unknown org, missing org, no integration and bad signature identically', async () => {
    const results: Array<{ body: unknown; status: number }> = [];
    const capture = async (res: Response) =>
      results.push({ body: await res.json(), status: res.status });

    await capture(await post(`${BASE}?org=ghost`, '{}', { 'x-hub-signature-256': 'sha256=00' })); // unknown org
    findOrg.mockResolvedValue({ id: 'org-1' });
    validate.mockResolvedValue(false);
    await capture(await post(`${BASE}?org=real`, '{}', { 'x-hub-signature-256': 'sha256=00' })); // bad sig / no integration
    await capture(await post(BASE, '{}')); // missing org

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r).toEqual({ body: { error: 'Invalid signature' }, status: 401 });
    }
  });

  it('refuses an oversized declared Content-Length before reading or looking anything up', async () => {
    const res = await post(`${BASE}?org=real`, '{}', {
      'content-length': String(GITHUB_WEBHOOK_MAX_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(findOrg).not.toHaveBeenCalled();
  });

  it('cuts off a streamed body that exceeds the cap even without Content-Length', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > GITHUB_WEBHOOK_MAX_BYTES / chunk.length + 5) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const req = new NextRequest(`${BASE}?org=real`, {
      body,
      duplex: 'half',
      method: 'POST',
    } as ConstructorParameters<typeof NextRequest>[1]);
    const res = await POST(req);
    expect(res.status).toBe(413);
    // stopped reading well before the producer finished
    expect(sent).toBeLessThan(GITHUB_WEBHOOK_MAX_BYTES / chunk.length + 5);
    expect(findOrg).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed event', async () => {
    findOrg.mockResolvedValue({ id: 'org-1' });
    validate.mockResolvedValue(true);
    const body = JSON.stringify({ action: 'ping' });
    const sig = `sha256=${createHmac('sha256', 's').update(body).digest('hex')}`;
    const res = await post(`${BASE}?org=real`, body, {
      'x-github-event': 'ping',
      'x-hub-signature-256': sig,
    });
    expect(res.status).toBe(200);
  });
});
