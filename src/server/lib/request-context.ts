import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { requestContext, runWithRequestContext } from './logger';

type RouteHandler<Args extends unknown[]> = (
  req: NextRequest,
  ...args: Args
) => Response | Promise<Response>;

/**
 * Wrap a Next.js route handler so every log line it emits — directly or deep
 * in the services it calls — carries a fresh `requestId` and the `route` name,
 * via the pino `mixin` (see logger.ts). This is the generic counterpart to the
 * inline `runWithRequestContext` wrapping in `/api/graphql`.
 *
 * Auth identifiers aren't known at wrap time (the handler resolves them from
 * the cookie/token). Call {@link bindRequestContext} once they're available to
 * add `orgId`/`userId` to the same scope.
 *
 *   async function handleGet(req: NextRequest) { … }
 *   export const GET = withRequestContext('sync/delta', handleGet);
 */
export function withRequestContext<Args extends unknown[]>(
  route: string,
  handler: RouteHandler<Args>,
): (req: NextRequest, ...args: Args) => Promise<Response> {
  return (req, ...args) =>
    runWithRequestContext({ requestId: randomUUID(), route }, async () => handler(req, ...args));
}

/**
 * Merge additional bindings (e.g. `orgId`/`userId`) into the active request
 * context so subsequent log lines include them. No-op when called outside a
 * `withRequestContext`/`runWithRequestContext` scope.
 */
export function bindRequestContext(bindings: Record<string, unknown>): void {
  const store = requestContext.getStore();
  if (store) {
    Object.assign(store, bindings);
  }
}
