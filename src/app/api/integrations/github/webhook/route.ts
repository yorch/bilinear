import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { GitHubService } from '@/server/services/github.service';

const log = childLogger({ module: 'github-webhook' });

/**
 * POST /api/integrations/github/webhook
 *
 * Receives GitHub webhook events. The workspace is identified from the
 * X-Bilinear-Org-Id header that the user must set in their GitHub webhook URL,
 * e.g.: https://app.example.com/api/integrations/github/webhook?org=<urlKey>
 *
 * Supports:
 *   - pull_request (opened, synchronize, closed)
 *
 * Signature validated with HMAC-SHA256 against the stored webhook_secret.
 */
export async function POST(req: NextRequest) {
  // Identify the org via query param (?org=<urlKey>)
  const orgKey = req.nextUrl.searchParams.get('org');
  if (!orgKey) {
    return NextResponse.json({ error: 'Missing org parameter' }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    select: { id: true },
    where: { urlKey: orgKey },
  });
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  // Read raw body for signature validation
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signatureHeader = req.headers.get('x-hub-signature-256');

  const service = new GitHubService(prisma);
  const valid = await service.validateWebhookSignature(org.id, rawBody, signatureHeader);
  if (!valid) {
    log.warn({ orgKey }, 'GitHub webhook signature validation failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
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
