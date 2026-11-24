import { createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { config } from '@/server/config';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { readBodyCapped } from '@/server/lib/request-security';
import { GitHubService } from '@/server/services/github.service';

const log = childLogger({ module: 'github-webhook' });

const DECOY_SECRET = 'github-webhook-decoy-secret';

/**
 * POST /api/integrations/github/webhook
 *
 * Receives GitHub webhook events. The workspace is identified via the `?org=`
 * query param that the user appends to their GitHub webhook URL,
 * e.g.: https://app.example.com/api/integrations/github/webhook?org=<urlKey>
 *
 * Supports:
 *   - pull_request (opened, synchronize, closed)
 *
 * Signature validated with HMAC-SHA256 against the stored webhook_secret.
 */
/** GitHub's documented maximum webhook payload. */
export const GITHUB_WEBHOOK_MAX_BYTES = 25 * 1024 * 1024;

/** One response for every authentication failure, so the route is not an oracle. */
function unauthorized() {
  return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
}

async function handlePost(req: NextRequest) {
  // Bounded read first: nothing is trusted or looked up until the body is
  // known to be within GitHub's maximum, and a larger upload is cut off.
  const rawBody = await readBodyCapped(req, GITHUB_WEBHOOK_MAX_BYTES);
  if (!rawBody) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  const signatureHeader = req.headers.get('x-hub-signature-256');

  // Missing ?org=, unknown org, no integration and a bad signature are all the
  // same 401 and do the same HMAC work, so response status/body/timing do not
  // reveal which workspaces exist.
  const orgKey = req.nextUrl.searchParams.get('org');
  const org = orgKey
    ? await prisma.organization.findUnique({ select: { id: true }, where: { urlKey: orgKey } })
    : null;
  if (!org) {
    createHmac('sha256', DECOY_SECRET).update(rawBody).digest();
    return unauthorized();
  }
  bindRequestContext({ orgId: org.id });

  const service = new GitHubService(prisma, config);
  const valid = await service.validateWebhookSignature(org.id, rawBody, signatureHeader);
  if (!valid) {
    log.warn({ orgKey }, 'GitHub webhook signature validation failed');
    return unauthorized();
  }

  const event = req.headers.get('x-github-event');
  if (!event) {
    return NextResponse.json({ error: 'Missing X-GitHub-Event header' }, { status: 400 });
  }

  // biome-ignore lint/suspicious/noExplicitAny: webhook payload
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  log.debug({ event, orgId: org.id }, 'GitHub webhook received');

  if (event === 'pull_request') {
    const action: string = payload.action;
    // Only handle meaningful state transitions
    if (['opened', 'reopened', 'synchronize', 'closed'].includes(action)) {
      void service
        .handlePullRequestEvent(org.id, payload)
        .catch(err =>
          log.error({ err, event, orgId: org.id }, 'Failed to handle pull_request event'),
        );
    }
  }

  return NextResponse.json({ ok: true });
}

export const POST = withRequestContext('integrations/github/webhook', handlePost);
