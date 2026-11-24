import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import {
  Agent,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
  fetch as undiciFetch,
} from 'undici';
import type { PrismaClient, Webhook, WebhookDelivery } from '../../generated/prisma';
import { type ConfigReader, DEFAULTS_ONLY_CONFIG } from '../config/reader';
import { env } from '../lib/env';
import { MAX_WEBHOOK_NAME_LENGTH } from '../lib/limits';
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

/** Synthetic event used by `sendTest`; not subscribable, never fan-out dispatched. */
export const WEBHOOK_PING_EVENT = 'ping';

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

// Deliveries are retried up to `webhook.maxAttempts` times (default 5).
// Backoff schedule (s): 30, 120, 600, 1800, 7200 — ~2.5h before giving up.
// The schedule is NOT configurable: a caller raising maxAttempts past its
// length reuses the last entry, which keeps a large cap from turning into a
// tight retry loop.
const RETRY_BACKOFF_SECONDS = [30, 120, 600, 1800, 7200];

const MAX_ATTEMPTS_KEY = 'webhook.maxAttempts';
const AUTO_DISABLE_AFTER_KEY = 'webhook.autoDisableAfter';
const REQUEST_TIMEOUT_MS_KEY = 'webhook.requestTimeoutMs';

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
export type HostResolver = (host: string) => Promise<Array<{ address: string }>>;

const defaultResolveHost: HostResolver = host => lookup(host, { all: true });

/** How long create/update waits for DNS before leaving the verdict to delivery time. */
const CREATE_TIME_DNS_TIMEOUT_MS = 2000;

/** Bytes of a response body read for diagnostics; the rest is never downloaded. */
const RESPONSE_BODY_READ_BYTES = 4096;
const RESPONSE_BODY_STORED_CHARS = 1000;

export class WebhookService {
  constructor(
    private prisma: PrismaClient,
    private config: ConfigReader = DEFAULTS_ONLY_CONFIG,
    private resolveHost: HostResolver = defaultResolveHost,
    // The pinned dispatcher is an npm-`undici` Agent. It must be driven by that
    // same package's fetch: Node's bundled fetch speaks an older handler
    // protocol and fails every request with "invalid onRequestStart method"
    // when handed a newer Agent (verified on Node 22 + undici 8).
    private fetchImpl: typeof undiciFetch = undiciFetch,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(orgId: string, creatorId: string, input: WebhookCreateInput): Promise<Webhook> {
    this.validateUrl(input.url);
    await this.assertResolvesPublic(input.url);
    this.validateEvents(input.events);
    this.validateName(input.name);

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

  async update(orgId: string, id: string, input: WebhookUpdateInput): Promise<Webhook> {
    if (input.url !== undefined) {
      this.validateUrl(input.url);
      await this.assertResolvesPublic(input.url);
    }
    if (input.events !== undefined) {
      this.validateEvents(input.events);
    }
    if (input.name !== undefined) {
      this.validateName(input.name);
    }
    // Re-validate the stored URL when (re-)enabling a hook. A row created
    // when ALLOW_PRIVATE_WEBHOOK_URLS=1 was set could otherwise silently
    // re-enable in production with a private URL. The runtime
    // assertSafeUrl check would still catch it at delivery, but failing
    // fast at the admin UI is friendlier.
    if (input.enabled === true && input.url === undefined) {
      const existing = await this.prisma.webhook.findFirst({
        select: { url: true },
        where: { id, organizationId: orgId },
      });
      if (existing) {
        this.validateUrl(existing.url);
      }
    }
    // updateMany scoped by orgId so an admin from another org can't mutate
    // a webhook by guessing its UUID. updateMany returns count rather than
    // throwing on miss — promote a zero match to NotFound for the caller.
    const claim = await this.prisma.webhook.updateMany({
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
      where: { id, organizationId: orgId },
    });
    if (claim.count !== 1) {
      throw new WebhookNotFoundError();
    }
    const updated = await this.prisma.webhook.findUnique({ where: { id } });
    if (!updated) {
      throw new WebhookNotFoundError();
    }
    return updated;
  }

  async archive(orgId: string, id: string): Promise<Webhook> {
    const claim = await this.prisma.webhook.updateMany({
      data: { archivedAt: new Date(), enabled: false },
      where: { id, organizationId: orgId },
    });
    if (claim.count !== 1) {
      throw new WebhookNotFoundError();
    }
    const updated = await this.prisma.webhook.findUnique({ where: { id } });
    if (!updated) {
      throw new WebhookNotFoundError();
    }
    return updated;
  }

  async delete(orgId: string, id: string): Promise<Webhook> {
    const existing = await this.findById(orgId, id);
    if (!existing) {
      throw new WebhookNotFoundError();
    }
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
  async rotateSecret(orgId: string, id: string): Promise<Webhook> {
    const claim = await this.prisma.webhook.updateMany({
      data: { signingSecret: generateSigningSecret() },
      where: { id, organizationId: orgId },
    });
    if (claim.count !== 1) {
      throw new WebhookNotFoundError();
    }
    const updated = await this.prisma.webhook.findUnique({ where: { id } });
    if (!updated) {
      throw new WebhookNotFoundError();
    }
    return updated;
  }

  /**
   * Send a signed `ping` event to one webhook and wait for the first attempt,
   * so the admin sees the HTTP status (or the failure) immediately. The ping
   * goes through the normal signing/SSRF-pinned delivery path, but a failed
   * test is closed out as `failed` rather than left on the retry schedule —
   * nobody wants a "test" that keeps firing in the background.
   */
  async sendTest(orgId: string, id: string): Promise<WebhookDelivery> {
    const webhook = await this.findById(orgId, id);
    if (!webhook) {
      throw new WebhookNotFoundError();
    }
    if (webhook.archivedAt || !webhook.enabled) {
      throw new WebhookTestUnavailableError();
    }
    this.validateUrl(webhook.url);

    const deliveryId = randomUUID();
    await this.prisma.webhookDelivery.create({
      data: {
        event: WEBHOOK_PING_EVENT,
        id: deliveryId,
        nextAttemptAt: new Date(),
        payload: this.buildPayload(deliveryId, orgId, WEBHOOK_PING_EVENT, {
          message: 'Test event from Bilinear',
          webhookId: webhook.id,
        }),
        status: 'pending',
        webhookId: webhook.id,
      },
    });
    await this.processDelivery(deliveryId);

    const delivery = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new WebhookNotFoundError();
    }
    if (delivery.status === 'pending' || delivery.status === 'in_flight') {
      return this.prisma.webhookDelivery.update({
        data: { nextAttemptAt: null, status: 'failed' },
        where: { id: deliveryId },
      });
    }
    return delivery;
  }

  async findById(orgId: string, id: string): Promise<Webhook | null> {
    return this.prisma.webhook.findFirst({
      where: { id, organizationId: orgId },
    });
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

  async listDeliveries(orgId: string, webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
    return this.prisma.webhookDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      where: { webhook: { organizationId: orgId }, webhookId },
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
    opts: { teamScopedOnly?: boolean } = {},
  ): Promise<WebhookDelivery[]> {
    // Team-scoped filter:
    //  - Team-level event (teamId passed): include org-wide hooks AND
    //    hooks scoped to that specific team.
    //  - Org-level event (teamId omitted): include only org-wide hooks.
    //    A team-scoped hook must NOT receive cross-team org events — that
    //    would leak data from teams the subscriber wasn't authorized for.
    const subscribers = await this.prisma.webhook.findMany({
      where: {
        archivedAt: null,
        enabled: true,
        events: { has: event },
        organizationId: orgId,
        ...(teamId == null
          ? { teamId: null }
          : opts.teamScopedOnly
            ? { teamId }
            : { OR: [{ teamId: null }, { teamId }] }),
      },
    });
    if (subscribers.length === 0) {
      return [];
    }

    // Pre-generate ids so the payload's `deliveryId` field matches the
    // row id and the X-Bilinear-Delivery header. createMany is one
    // round-trip vs. N for a per-subscriber `create` loop — meaningful
    // when the call sits on every issue/comment mutation hot path.
    const now = new Date();
    const rows = subscribers.map(webhook => {
      const id = randomUUID();
      return {
        event,
        id,
        nextAttemptAt: now,
        payload: this.buildPayload(id, orgId, event, data),
        status: 'pending',
        webhookId: webhook.id,
      };
    });
    await this.prisma.webhookDelivery.createMany({ data: rows });

    // Fire the first attempt for each delivery in parallel. Errors are
    // caught inside processDelivery; the catch here is belt-and-braces.
    for (const r of rows) {
      void this.processDelivery(r.id).catch(err => {
        log.error({ deliveryId: r.id, err }, 'Webhook delivery failed');
      });
    }

    // Return the freshly-inserted rows so callers can observe the
    // dispatch (used by tests). createMany doesn't return rows, so we
    // shape them from the inputs.
    return rows.map(r => ({
      attempts: 0,
      createdAt: now,
      deliveredAt: null,
      errorMessage: null,
      event: r.event,
      id: r.id,
      nextAttemptAt: r.nextAttemptAt,
      payload: r.payload,
      responseBody: null,
      responseStatus: null,
      status: r.status,
      updatedAt: now,
      webhookId: r.webhookId,
    })) as WebhookDelivery[];
  }

  /**
   * Attempt a single delivery. Updates the row to success/failed and
   * schedules a retry on transient failures. Idempotent — calling twice
   * just performs two attempts.
   */
  async processDelivery(deliveryId: string): Promise<void> {
    // Platform-scoped, so it resolves without an org — which matters because
    // the claim below runs before the delivery row (and therefore its org) has
    // been read.
    const requestTimeoutMs = await this.config.getInt(REQUEST_TIMEOUT_MS_KEY);

    // Atomic claim: transition status from `pending` to `in_flight`. Two
    // concurrent runners (e.g. multiple WS replicas) both call this; the
    // second sees the row already moved to `in_flight` and updateMany
    // returns count=0, so only one delivery fires. The previous design
    // only touched `nextAttemptAt` while leaving status='pending', so two
    // calls could both pass the where-clause and double-deliver.
    //
    // We also stamp `nextAttemptAt` to a far-future placeholder as a
    // failsafe — if the worker crashes mid-flight, the retry sweep won't
    // re-pick the row until the claim expires (success/failure handlers
    // overwrite it with the real value below).
    // The claim has two timestamps:
    //   claimDeadline   = +REQUEST_TIMEOUT_MS + 60s in the future.
    //                     Written into nextAttemptAt so the retry sweep
    //                     won't re-pick the row while it's still being
    //                     sent. Inflated past REQUEST_TIMEOUT_MS so a
    //                     slow fetch (network jitter past the abort) is
    //                     still treated as live, not stale.
    //   claimableBefore = the same window in the past. A row whose
    //                     nextAttemptAt is older than this is "stale
    //                     in_flight" — its worker has crashed or hung
    //                     past the entire window, so the sweep can
    //                     reclaim it. Symmetric with claimDeadline so
    //                     the reclaim window matches the protection
    //                     window the writer originally granted itself.
    const claimDeadline = new Date(Date.now() + requestTimeoutMs + 60_000);
    const claimableBefore = new Date(Date.now() - requestTimeoutMs - 60_000);
    const claim = await this.prisma.webhookDelivery.updateMany({
      data: { nextAttemptAt: claimDeadline, status: 'in_flight' },
      where: {
        id: deliveryId,
        // Claim if currently pending, OR if an earlier worker's claim
        // window has elapsed (handles a crashed worker that never wrote
        // success/failure).
        OR: [
          { status: 'pending' },
          { nextAttemptAt: { lte: claimableBefore }, status: 'in_flight' },
        ],
      },
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
    // Both are org-scoped, so they resolve only once the delivery's webhook —
    // and therefore its organization — is known.
    const orgId = delivery.webhook.organizationId;
    const maxAttempts = await this.config.getInt(MAX_ATTEMPTS_KEY, { orgId });
    const autoDisableAfter = await this.config.getInt(AUTO_DISABLE_AFTER_KEY, { orgId });

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

    // Rows created before a range was blocked (or before the check existed) are
    // never grandfathered: every delivery re-runs the create-time URL screen, so
    // a stale IP-literal row cannot reach a now-forbidden address. (Hostnames
    // are additionally pinned at connect time.)
    try {
      this.validateUrl(delivery.webhook.url);
    } catch {
      await this.prisma.webhookDelivery.update({
        data: {
          errorMessage: 'Webhook URL is no longer allowed',
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        // `validateUrl` screened the hostname at create time. At delivery the
        // guard has to hold against DNS rebinding — a name that resolved to a
        // public address then and to 169.254.169.254 (cloud metadata) now.
        // A separate pre-resolve-and-check followed by `fetch` resolving
        // again was a time-of-check/time-of-use gap a rebinding resolver
        // could answer differently; the pinned dispatcher resolves once,
        // inside the connect step, and only the addresses it validated are
        // ever connected to.
        const init: UndiciRequestInit & { dispatcher: Dispatcher } = {
          body: rawBody,
          dispatcher: pinnedDispatcher,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Bilinear-Webhook/1.0',
            'X-Bilinear-Delivery': deliveryId,
            'X-Bilinear-Event': delivery.event,
            'X-Bilinear-Signature': `sha256=${signature}`,
          },
          method: 'POST',
          // Do NOT follow redirects: assertSafeUrl() only validated the
          // original host's resolved IP. A 3xx to http://169.254.169.254/...
          // (cloud metadata) or an internal host would otherwise be followed
          // unchecked, defeating the SSRF guard. A redirecting target is
          // treated as a failed (non-2xx) delivery.
          redirect: 'manual',
          signal: controller.signal,
        };
        const res = await this.fetchImpl(delivery.webhook.url, init);
        responseStatus = res.status;
        // Cap response body capture; we only need diagnostic context, not full payloads.
        responseBody = await readBodyCapped(res);
        success = res.status >= 200 && res.status < 300;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      errorMessage = describeDeliveryError(err, requestTimeoutMs);
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
    if (attempt >= maxAttempts) {
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
          consecutiveFailures: { gte: autoDisableAfter },
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
   *
   * The query also picks up rows whose claim deadline elapsed without a
   * worker completing — `processDelivery` writes a future `nextAttemptAt`
   * when it claims a row, so a crashed worker's row becomes due again
   * naturally after that window. The atomic claim inside processDelivery
   * still prevents double-sends if two sweeps overlap on the same row.
   *
   * Deliveries run with bounded concurrency so a single slow endpoint
   * (10s timeout) doesn't sequentially throttle the whole sweep.
   */
  async processDuePending(limit = 50, concurrency = 5): Promise<number> {
    const now = new Date();
    const due = await this.prisma.webhookDelivery.findMany({
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      where: {
        nextAttemptAt: { lte: now },
        // Pick up `pending` rows that are due, and `in_flight` rows whose
        // claim deadline has elapsed (crashed worker). processDelivery's
        // atomic claim ensures we don't double-send if a stalled-but-still-
        // running worker eventually wakes up.
        OR: [{ status: 'pending' }, { status: 'in_flight' }],
      },
    });

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, due.length) },
      async (): Promise<void> => {
        while (cursor < due.length) {
          const idx = cursor++;
          const d = due[idx];
          if (!d) {
            return;
          }
          try {
            await this.processDelivery(d.id);
          } catch (err) {
            log.error({ deliveryId: d.id, err }, 'Webhook retry failed');
          }
        }
      },
    );
    await Promise.all(workers);
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
    // SSRF: validateUrl rejects obvious private/loopback hostnames at
    // parse time; the delivery path (assertSafeUrl) re-validates the
    // *resolved* IP to defeat DNS rebinding.
    const host = parsed.hostname.toLowerCase();
    if (host === '') {
      // Empty host is never a valid webhook target, and the
      // ALLOW_PRIVATE_WEBHOOK_URLS escape hatch shouldn't apply to it.
      throw new WebhookInvalidUrlError();
    }
    if (isBlockedHost(host)) {
      // Default-deny: only allow private/loopback when explicitly opted
      // in (e.g. local dev with `.env` set).
      if (!env.ALLOW_PRIVATE_WEBHOOK_URLS) {
        throw new WebhookPrivateUrlError();
      }
    }
  }

  /**
   * Create/update-time DNS screen: a hostname that already resolves to a
   * private address (`http://vm:3000/` via /etc/hosts, an internal zone) is
   * refused up front instead of being accepted and then failing every delivery.
   * It is a courtesy, not the guard: a lookup that fails or is slow is waved
   * through, and a name can change answers later, so the pinned dispatcher's
   * connect-time check (which resolves once and connects only to what it
   * validated) remains the actual SSRF defence.
   */
  private async assertResolvesPublic(url: string): Promise<void> {
    if (env.ALLOW_PRIVATE_WEBHOOK_URLS) {
      return;
    }
    const raw = new URL(url).hostname;
    const host = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
    if (isIP(host) || parseIpLiteral(host)) {
      return; // literals were screened synchronously by validateUrl
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([
        this.resolveHost(host),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('dns timeout')), CREATE_TIME_DNS_TIMEOUT_MS);
        }),
      ]);
      if (addresses.some(a => isPrivateIp(a.address))) {
        throw new WebhookPrivateUrlError();
      }
    } catch (err) {
      if (err instanceof WebhookPrivateUrlError) {
        throw err;
      }
      // unresolvable right now: not evidence of anything; delivery re-checks.
    } finally {
      clearTimeout(timer);
    }
  }

  private validateName(name: string): void {
    if (name.length > MAX_WEBHOOK_NAME_LENGTH) {
      throw new WebhookInvalidNameError();
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

  private buildPayload(deliveryId: string, orgId: string, event: string, data: object) {
    return {
      data,
      // Stable id matching the X-Bilinear-Delivery header. Receivers can
      // use it for at-least-once delivery deduplication (we may retry).
      deliveryId,
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
  // Reject malformed input upfront. `Buffer.from(s, 'hex')` silently
  // truncates on the first non-hex character, so without this guard a
  // header like "g".repeat(64) parses to an empty buffer and
  // timingSafeEqual throws on length mismatch (turning an attacker-
  // controlled value into a server error).
  if (provided.length !== expected.length || !/^[0-9a-fA-F]+$/.test(provided)) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
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
 *
 * Exported for tests.
 */
export function isBlockedHost(host: string): boolean {
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
  // IPv6 — verified by net.isIPv6 to avoid treating colon-bearing
  // hostnames (e.g. user-supplied "foo:bar") as IP literals and slipping
  // them past the SSRF gate.
  if (isIP(s) === 6) {
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

/**
 * IANA special-purpose / non-global ranges a webhook must never reach. Built on
 * `node:net` BlockList (CIDR-aware, handles IPv4-mapped IPv6 natively) rather
 * than hand-rolled prefix tests, which previously missed CGNAT (100.64/10 —
 * 100.100.100.200 is a cloud metadata address), benchmarking (198.18/15),
 * fe80::/10 beyond the literal `fe80:` prefix, site-local fec0::/10, the
 * IPv4-compatible/translated forms (::7f00:1, ::ffff:0:7f00:1), NAT64 and 6to4.
 */
const PRIVATE_V4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT / shared address space
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local + cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 3], // multicast + reserved + broadcast (224/4 and 240/4)
];
const PRIVATE_V6_CIDRS: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback, IPv4-compatible (::7f00:1)
  ['::ffff:0:0:0', 96], // IPv4-translated (::ffff:0:7f00:1)
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (Teredo etc.)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];
const privateRanges = new BlockList();
for (const [net, prefix] of PRIVATE_V4_CIDRS) {
  privateRanges.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of PRIVATE_V6_CIDRS) {
  privateRanges.addSubnet(net, prefix, 'ipv6');
}

/** Whether a normalized IP literal points to a private/loopback/special-purpose range. */
function isPrivateIp(ip: string): boolean {
  // Node's URL parser keeps brackets in `hostname`, but this is also called on
  // already-stripped values, so accept both; drop any IPv6 zone id.
  let addr = ip.split('%')[0] ?? '';
  if (addr.startsWith('[') && addr.endsWith(']')) {
    addr = addr.slice(1, -1);
  }
  const family = isIP(addr);
  if (family === 0) {
    return false;
  }
  return privateRanges.check(addr, family === 4 ? 'ipv4' : 'ipv6');
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * The one dispatcher every webhook delivery goes through. Its connect step
 * resolves the hostname itself, rejects the connection if ANY resolved
 * address is private (a host with mixed public and private records is not
 * given the benefit of the doubt), and hands the socket only the validated
 * addresses — so the address that was checked is the address connected to.
 * A resolver failure fails the delivery closed instead of letting the request
 * proceed on a second, unchecked resolution.
 *
 * IP-literal hosts never reach a lookup; `validateUrl` screened those at
 * create time and a literal cannot rebind. `ALLOW_PRIVATE_WEBHOOK_URLS` keeps
 * its local-testing escape hatch.
 */
const pinnedDispatcher: Dispatcher = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      const cb = callback as unknown as LookupCallback;
      const family =
        options.family === 4 || options.family === 'IPv4'
          ? 4
          : options.family === 6 || options.family === 'IPv6'
            ? 6
            : undefined;
      lookup(hostname, { all: true, ...(family ? { family } : {}) })
        .then(addresses => {
          if (addresses.length === 0) {
            cb(Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' }), []);
            return;
          }
          if (!env.ALLOW_PRIVATE_WEBHOOK_URLS && addresses.some(a => isPrivateIp(a.address))) {
            cb(new WebhookPrivateUrlError(), []);
            return;
          }
          if (options.all) {
            cb(null, addresses);
          } else {
            const [first] = addresses as [{ address: string; family: number }];
            cb(null, first.address, first.family);
          }
        })
        .catch((err: NodeJS.ErrnoException) => {
          log.warn({ err, host: hostname }, 'Webhook DNS lookup failed — delivery refused');
          cb(err, []);
        });
    },
  },
});

/**
 * Read at most RESPONSE_BODY_READ_BYTES of a response and keep the first
 * RESPONSE_BODY_STORED_CHARS characters. `res.text()` would download the whole
 * body (a hostile endpoint can stream gigabytes) before the slice; this stops
 * pulling and cancels the stream once the cap is reached.
 */
export async function readBodyCapped(res: {
  body: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null;
  text(): Promise<string>;
}): Promise<string> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await res.text().catch(() => '');
    return text.slice(0, RESPONSE_BODY_STORED_CHARS);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < RESPONSE_BODY_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // a broken stream still leaves whatever was read
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder()
    .decode(Buffer.concat(chunks).subarray(0, RESPONSE_BODY_READ_BYTES))
    .slice(0, RESPONSE_BODY_STORED_CHARS);
}

/**
 * Human-readable reason for a failed attempt. undici reports nearly every
 * network failure as `TypeError: fetch failed` with the real reason in
 * `cause`, so the bare message hides whether the SSRF guard refused the
 * address, DNS failed, TLS failed or the socket was refused. Credentials in
 * URLs and anything long are stripped before it is stored.
 */
export function describeDeliveryError(err: unknown, timeoutMs?: number): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return timeoutMs ? `Request timed out after ${timeoutMs} ms` : 'Request timed out';
  }
  const base = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
  let detail = '';
  if (cause instanceof WebhookPrivateUrlError) {
    detail = cause.message;
  } else if (cause && typeof cause === 'object') {
    const { code, message } = cause as { code?: unknown; message?: unknown };
    detail = [typeof code === 'string' ? code : '', typeof message === 'string' ? message : '']
      .filter(Boolean)
      .join(': ');
  }
  const full = detail && !base.includes(detail) ? `${base} (${detail})` : base;
  return full
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
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

export class WebhookTestUnavailableError extends Error {
  constructor() {
    super('Enable the webhook before sending a test event');
    this.name = 'WebhookTestUnavailableError';
  }
}

export class WebhookNoEventsError extends Error {
  constructor() {
    super('Webhook must subscribe to at least one event');
    this.name = 'WebhookNoEventsError';
  }
}

export class WebhookInvalidNameError extends Error {
  constructor() {
    super(`Webhook name must be ${MAX_WEBHOOK_NAME_LENGTH} characters or fewer`);
    this.name = 'WebhookInvalidNameError';
  }
}
