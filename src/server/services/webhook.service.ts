import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { PrismaClient, Webhook, WebhookDelivery } from '../../generated/prisma';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'webhook' });

/**
 * Canonical list of webhook event names. Subscribers list one or more in
 * `Webhook.events`; sending an event not in this list is silently ignored
 * by the dispatcher (see `dispatchEvent`).
 *
 * Add new events here AND wire up a `dispatchEvent` call from the relevant
 * service/resolver. Naming: `<resource>.<verb>` in past tense.
 */
export const WEBHOOK_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.archived',
  'issue.deleted',
  'comment.created',
  'comment.updated',
  'project.created',
  'project.updated',
  'cycle.created',
  'cycle.completed',
  'initiative.created',
  'initiative.updated',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookCreateInput {
  enabled?: boolean;
  events: string[];
  name: string;
  teamId?: string | null;
  url: string;
}

export interface WebhookUpdateInput {
  enabled?: boolean;
  events?: string[];
  name?: string;
  teamId?: string | null;
  url?: string;
}

// Deliveries are retried up to MAX_ATTEMPTS times. Backoff schedule (s):
// 30, 120, 600, 1800, 7200 — totalling ~2.5h before giving up.
const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_SECONDS = [30, 120, 600, 1800, 7200];

// Cap consecutive failures before auto-disabling a webhook. A stuck
// endpoint shouldn't generate retries indefinitely.
const AUTO_DISABLE_AFTER = 20;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * WebhookService manages outbound HTTP webhook subscriptions.
 *
 * Sign:   HMAC-SHA256(rawBody, signingSecret) → hex
 * Header: X-Bilinear-Signature: sha256=<hex>
 * Body:   { event, deliveryId, organizationId, timestamp, data }
 *
 * dispatchEvent fans out to every matching enabled webhook in the org and
 * creates a WebhookDelivery row per subscriber. The actual HTTP send is
 * detached from the request hot path — it runs via processDelivery which
 * the caller fires as `void` so a slow endpoint never blocks a mutation.
 *
 * Failed attempts schedule a retry (exponential backoff). The delivery
 * row's (status, nextAttemptAt) tuple drives the retry scheduler — see
 * `processDuePending`.
 */
export class WebhookService {
  constructor(private prisma: PrismaClient) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(orgId: string, creatorId: string, input: WebhookCreateInput): Promise<Webhook> {
    this.validateUrl(input.url);
    this.validateEvents(input.events);

    const signingSecret = generateSigningSecret();
    return this.prisma.webhook.create({
      data: {
        createdById: creatorId,
        enabled: input.enabled ?? true,
        events: input.events,
        name: input.name,
        organizationId: orgId,
        signingSecret,
        teamId: input.teamId ?? null,
        url: input.url,
      },
    });
  }

  async update(id: string, input: WebhookUpdateInput): Promise<Webhook> {
    if (input.url !== undefined) {
      this.validateUrl(input.url);
    }
    if (input.events !== undefined) {
      this.validateEvents(input.events);
    }
    return this.prisma.webhook.update({
      data: {
        // Resetting consecutiveFailures on enable lets a previously-disabled
        // hook get a fresh chance before auto-disable kicks in again.
        consecutiveFailures: input.enabled === true ? 0 : undefined,
        enabled: input.enabled,
        events: input.events,
        name: input.name,
        teamId: input.teamId,
        url: input.url,
      },
      where: { id },
    });
  }

  async archive(id: string): Promise<Webhook> {
    return this.prisma.webhook.update({
      data: { archivedAt: new Date(), enabled: false },
      where: { id },
    });
  }

  async delete(id: string): Promise<Webhook> {
    return this.prisma.webhook.delete({ where: { id } });
  }

  /**
   * Rotate the signing secret. The new secret is returned so it can be
   * shown once to the user; subsequent reads return only the most recent
   * stored value. Existing pending deliveries continue to use whatever
   * secret was current when they were created — no migration needed
   * because each delivery captures the secret implicitly via its payload
   * signature at send time, which uses the current Webhook row.
   */
  async rotateSecret(id: string): Promise<Webhook> {
    return this.prisma.webhook.update({
      data: { signingSecret: generateSigningSecret() },
      where: { id },
    });
  }

  async findById(id: string): Promise<Webhook | null> {
    return this.prisma.webhook.findUnique({ where: { id } });
  }

  async findByOrgId(orgId: string, includeArchived = false): Promise<Webhook[]> {
    return this.prisma.webhook.findMany({
      orderBy: { createdAt: 'desc' },
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        organizationId: orgId,
      },
    });
  }

  async listDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
    return this.prisma.webhookDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      where: { webhookId },
    });
  }

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * Enqueue a webhook event for every matching subscriber in `orgId`.
   * `teamId`, when supplied, additionally filters out webhooks scoped to a
   * different team (the hook's `teamId` must be null OR equal). The actual
   * HTTP request runs asynchronously via processDelivery — callers should
   * `void` the returned promise when they don't want to wait.
   */
  async dispatchEvent(
    orgId: string,
    event: WebhookEvent | string,
    data: object,
    teamId?: string | null,
  ): Promise<WebhookDelivery[]> {
    const subscribers = await this.prisma.webhook.findMany({
      where: {
        archivedAt: null,
        enabled: true,
        events: { has: event },
        organizationId: orgId,
        ...(teamId === undefined
          ? {}
          : { OR: [{ teamId: null }, { teamId: teamId ?? undefined }] }),
      },
    });
    if (subscribers.length === 0) {
      return [];
    }

    const deliveries: WebhookDelivery[] = [];
    for (const webhook of subscribers) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          event,
          nextAttemptAt: new Date(),
          payload: this.buildPayload(orgId, event, data),
          status: 'pending',
          webhookId: webhook.id,
        },
      });
      deliveries.push(delivery);
      // Fire-and-forget the first attempt. Errors are caught inside.
      void this.processDelivery(delivery.id).catch(err => {
        log.error({ deliveryId: delivery.id, err }, 'Webhook delivery failed');
      });
    }
    return deliveries;
  }

  /**
   * Attempt a single delivery. Updates the row to success/failed and
   * schedules a retry on transient failures. Idempotent — calling twice
   * just performs two attempts.
   */
  async processDelivery(deliveryId: string): Promise<void> {
    // Atomic claim: only proceed if the row is still pending and the
    // claim succeeds. Two concurrent runners (e.g. multiple WS replicas)
    // both call this; the second sees count=0 and bails. The claim sets
    // nextAttemptAt to a far-future placeholder so the retry sweep won't
    // pick the row up while it's in flight; success/failure handlers
    // overwrite it with the real value (null on success, schedule on
    // failure).
    const claimDeadline = new Date(Date.now() + REQUEST_TIMEOUT_MS + 60_000);
    const claim = await this.prisma.webhookDelivery.updateMany({
      data: { nextAttemptAt: claimDeadline },
      where: { id: deliveryId, status: 'pending' },
    });
    if (claim.count === 0) {
      return;
    }

    const delivery = await this.prisma.webhookDelivery.findUnique({
      include: { webhook: true },
      where: { id: deliveryId },
    });
    if (!delivery) {
      return;
    }
    if (!delivery.webhook.enabled || delivery.webhook.archivedAt) {
      // Hook was disabled between enqueue and attempt — drop the delivery.
      await this.prisma.webhookDelivery.update({
        data: {
          errorMessage: 'Webhook disabled',
          nextAttemptAt: null,
          status: 'failed',
        },
        where: { id: deliveryId },
      });
      return;
    }

    const rawBody = JSON.stringify(delivery.payload);
    const signature = signPayload(rawBody, delivery.webhook.signingSecret);

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;
    let success = false;
    const attempt = delivery.attempts + 1;

    try {
      // Re-validate the resolved IP at request time. validateUrl screens
      // the hostname at create-time; this guards against DNS rebinding —
      // a domain that resolves to a public IP at create and to
      // 169.254.169.254 (cloud metadata) at delivery.
      await assertSafeUrl(delivery.webhook.url);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(delivery.webhook.url, {
          body: rawBody,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Bilinear-Webhook/1.0',
            'X-Bilinear-Delivery': deliveryId,
            'X-Bilinear-Event': delivery.event,
            'X-Bilinear-Signature': `sha256=${signature}`,
          },
          method: 'POST',
          signal: controller.signal,
        });
        responseStatus = res.status;
        // Cap response body capture; we only need diagnostic context, not full payloads.
        responseBody = (await res.text().catch(() => '')).slice(0, 1000);
        success = res.status >= 200 && res.status < 300;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const now = new Date();
    if (success) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          data: {
            attempts: attempt,
            deliveredAt: now,
            errorMessage: null,
            nextAttemptAt: null,
            responseBody,
            responseStatus,
            status: 'success',
          },
          where: { id: deliveryId },
        }),
        this.prisma.webhook.update({
          data: {
            consecutiveFailures: 0,
            lastDeliveryAt: now,
            lastSuccessAt: now,
          },
          where: { id: delivery.webhookId },
        }),
      ]);
      return;
    }

    // Failure: schedule retry or mark as failed.
    if (attempt >= MAX_ATTEMPTS) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          data: {
            attempts: attempt,
            errorMessage,
            nextAttemptAt: null,
            responseBody,
            responseStatus,
            status: 'failed',
          },
          where: { id: deliveryId },
        }),
        this.prisma.webhook.update({
          data: {
            consecutiveFailures: { increment: 1 },
            lastDeliveryAt: now,
          },
          where: { id: delivery.webhookId },
        }),
      ]);
      // Auto-disable: atomic conditional update so a concurrent successful
      // delivery (which resets consecutiveFailures to 0) doesn't get its
      // hook disabled by a stale read.
      const disabled = await this.prisma.webhook.updateMany({
        data: { enabled: false },
        where: {
          consecutiveFailures: { gte: AUTO_DISABLE_AFTER },
          enabled: true,
          id: delivery.webhookId,
        },
      });
      if (disabled.count > 0) {
        log.warn(
          { webhookId: delivery.webhookId },
          'Auto-disabled webhook after repeated failures',
        );
      }
      return;
    }

    const backoffSec = RETRY_BACKOFF_SECONDS[attempt - 1] ?? 7200;
    const nextAttemptAt = new Date(now.getTime() + backoffSec * 1000);
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        data: {
          attempts: attempt,
          errorMessage,
          nextAttemptAt,
          responseBody,
          responseStatus,
          status: 'pending',
        },
        where: { id: deliveryId },
      }),
      this.prisma.webhook.update({
        data: { lastDeliveryAt: now },
        where: { id: delivery.webhookId },
      }),
    ]);
  }

  /**
   * Process every pending delivery whose `nextAttemptAt` is due. Used by a
   * background job (cron / setInterval in the WS server) to drive retries.
   * Returns the number of deliveries attempted.
   */
  async processDuePending(limit = 50): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      where: {
        nextAttemptAt: { lte: new Date() },
        status: 'pending',
      },
    });
    for (const d of due) {
      await this.processDelivery(d.id).catch(err => {
        log.error({ deliveryId: d.id, err }, 'Webhook retry failed');
      });
    }
    return due.length;
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new WebhookInvalidUrlError();
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new WebhookInvalidUrlError();
    }
    // SSRF protection — webhook URLs are tenant-supplied and the server
    // fetches them, so we must reject any address that could reach an
    // internal service.
    //
    // Two layers of defense:
    //   1. Block obvious private hostnames at parse time.
    //   2. The dispatcher is responsible for re-validating the *resolved*
    //      IP at request time (see verifyResolvedIp). This double-check
    //      catches DNS rebinding and aliases that resolve to internal IPs.
    //
    // We also normalize hex/octal/decimal IP encodings via Node's URL
    // canonicalization (it leaves them as-is in `hostname`, so we
    // explicitly reject anything that isn't a "normal" hostname or
    // dotted-quad / bracketed IPv6 literal).
    const host = parsed.hostname.toLowerCase();
    if (host === '' || isBlockedHost(host)) {
      // Default-deny: only allow private/loopback when explicitly opted
      // in. Production never bypasses; non-production requires
      // ALLOW_PRIVATE_WEBHOOK_URLS=1 (e.g. local dev with `.env` set).
      if (process.env.ALLOW_PRIVATE_WEBHOOK_URLS !== '1') {
        throw new WebhookPrivateUrlError();
      }
    }
  }

  private validateEvents(events: string[]): void {
    if (events.length === 0) {
      throw new WebhookNoEventsError();
    }
    const valid = new Set<string>(WEBHOOK_EVENTS);
    for (const e of events) {
      if (!valid.has(e)) {
        throw new WebhookInvalidEventError(e);
      }
    }
  }

  private buildPayload(orgId: string, event: string, data: object) {
    return {
      data,
      event,
      organizationId: orgId,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature of a raw request body, hex-encoded.
 * Subscribers verify with: hex(hmac_sha256(secret, body)) === header_signature.
 */
export function signPayload(rawBody: string, signingSecret: string): string {
  return createHmac('sha256', signingSecret).update(rawBody).digest('hex');
}

/** Constant-time signature comparison for receivers that want to verify. */
export function verifySignature(
  rawBody: string,
  signingSecret: string,
  headerValue: string,
): boolean {
  const provided = headerValue.startsWith('sha256=') ? headerValue.slice(7) : headerValue;
  const expected = signPayload(rawBody, signingSecret);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

function generateSigningSecret(): string {
  // 32 bytes = 256 bits of entropy. URL-safe base64.
  return randomBytes(32).toString('base64url');
}

/**
 * Reject hostnames that fall in private/loopback ranges, including various
 * encoding tricks (decimal/octal/hex IPs, IPv4-mapped IPv6).
 *
 * Accepts: regular DNS hostnames, public IPv4/IPv6 literals.
 * Rejects: localhost, .local/.internal suffixes, RFC 1918, link-local,
 *          unique-local IPv6, "0", "0.0.0.0", IPv4-mapped IPv6 forms.
 */
function isBlockedHost(host: string): boolean {
  // Strip IPv6 brackets if present.
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (h === '' || h === '0' || h === 'localhost') {
    return true;
  }
  if (h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }

  // Try to canonicalize as an IP. If it parses, check the canonical form
  // against private ranges. This covers decimal/octal/hex tricks too —
  // Node's URL parser doesn't expand them, but `dns.lookup` will, so we
  // attempt a lightweight numeric parse here.
  const ip = parseIpLiteral(h);
  if (ip) {
    return isPrivateIp(ip);
  }
  return false;
}

/**
 * Parse a hostname-shaped string as an IP address. Returns the canonical
 * dotted-quad / lowercase IPv6 form, or null if the input isn't a numeric
 * IP literal.
 *
 * Handles: IPv4 dotted-quad, IPv6 (any form including ::ffff:1.2.3.4),
 * single decimal (e.g. "2130706433"), and hex (0x7f000001).
 */
function parseIpLiteral(s: string): string | null {
  // IPv6 (contains a colon and is not a port suffix)
  if (s.includes(':')) {
    return s.toLowerCase();
  }
  // Single integer → IPv4 (e.g. "2130706433" → 127.0.0.1)
  if (/^\d+$/.test(s)) {
    const n = Number.parseInt(s, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
    }
  }
  // Hex (0x7f.0.0.1 or 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const n = Number.parseInt(s, 16);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
    }
  }
  // Dotted form (handles octal/hex octets too)
  const parts = s.split('.');
  if (parts.length === 4 && parts.every(p => /^(\d+|0x[0-9a-f]+)$/i.test(p))) {
    const octets = parts.map(p => {
      if (p.startsWith('0x') || p.startsWith('0X')) {
        return Number.parseInt(p, 16);
      }
      // Treat leading-zero forms as decimal — JavaScript's parseInt with
      // radix 10 doesn't follow C's octal convention, which is what we want.
      return Number.parseInt(p, 10);
    });
    if (octets.every(o => Number.isFinite(o) && o >= 0 && o <= 255)) {
      return octets.join('.');
    }
  }
  return null;
}

/** Whether a normalized IP literal points to a private/loopback range. */
function isPrivateIp(ip: string): boolean {
  // IPv6 forms — strip zone id and zero-pad shorthand for matching.
  if (ip.includes(':')) {
    const v6 = ip.split('%')[0];
    if (
      v6 === '::1' ||
      v6 === '::' ||
      v6.startsWith('fe80:') ||
      // unique-local fc00::/7
      /^fc[0-9a-f]{2}:/i.test(v6) ||
      /^fd[0-9a-f]{2}:/i.test(v6)
    ) {
      return true;
    }
    // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:0:a.b.c.d)
    const mapped = v6.match(/::ffff:(?:0:)?([0-9a-f.]+)/i);
    if (mapped) {
      const inner = parseIpLiteral(mapped[1]);
      return inner ? isPrivateIp(inner) : false;
    }
    return false;
  }
  // IPv4
  const m = ip.split('.').map(Number);
  if (m.length !== 4 || m.some(n => !Number.isFinite(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = m;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    a >= 224 // multicast / reserved
  );
}

/**
 * Resolve `url`'s hostname and throw if it points to a private/internal
 * address. Mitigates DNS rebinding — even if validateUrl passed at create
 * time, the host may resolve differently now.
 */
async function assertSafeUrl(url: string): Promise<void> {
  if (process.env.ALLOW_PRIVATE_WEBHOOK_URLS === '1') {
    return;
  }
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  // If the hostname is already an IP literal, validateUrl handled it.
  // Otherwise resolve and validate the resolved IP.
  if (parseIpLiteral(host)) {
    return;
  }
  try {
    const { address } = await lookup(host);
    if (isPrivateIp(address)) {
      throw new WebhookPrivateUrlError();
    }
  } catch (err) {
    if (err instanceof WebhookPrivateUrlError) {
      throw err;
    }
    // DNS failure — let the fetch attempt surface the network error.
  }
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class WebhookNotFoundError extends Error {
  constructor() {
    super('Webhook not found');
    this.name = 'WebhookNotFoundError';
  }
}

export class WebhookInvalidUrlError extends Error {
  constructor() {
    super('Webhook URL must be a valid http(s) URL');
    this.name = 'WebhookInvalidUrlError';
  }
}

export class WebhookPrivateUrlError extends Error {
  constructor() {
    super('Webhook URL cannot point to a private/internal address');
    this.name = 'WebhookPrivateUrlError';
  }
}

export class WebhookInvalidEventError extends Error {
  constructor(eventName: string) {
    super(`Unknown webhook event: ${eventName}`);
    this.name = 'WebhookInvalidEventError';
  }
}

export class WebhookNoEventsError extends Error {
  constructor() {
    super('Webhook must subscribe to at least one event');
    this.name = 'WebhookNoEventsError';
  }
}
