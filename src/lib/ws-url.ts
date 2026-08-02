/**
 * Resolves the URL the browser uses to reach the standalone WebSocket server.
 *
 * The historical resolution was `<proto>//<hostname>:<NEXT_PUBLIC_WS_PORT>`,
 * which only works when the WS port is directly reachable from the public
 * internet AND terminates TLS itself. Behind a reverse proxy (Traefik, nginx,
 * Cloudflare) neither holds: the proxy owns :443 and the certificate, and the
 * WS server sits on an internal port with no TLS at all. `wss://host:3001`
 * then fails at the TLS handshake — the error this module exists to fix.
 *
 * The standard layout for that deployment is same-origin path routing
 * (`wss://host/ws`), which needs no second port and no second certificate.
 * So the URL must be expressible as a *path*, not just a port number.
 *
 * It must also be settable at RUNTIME. `NEXT_PUBLIC_*` is inlined by
 * `next build`, so anyone deploying the published image (rather than building
 * from source) cannot change it at all. The server therefore hands the
 * resolved value down at connect time via `/api/auth/ws-ticket` — see
 * `WS_PUBLIC_URL` in `src/server/lib/env.ts`. The build-time port stays as
 * the fallback so existing setups keep working untouched.
 */

/** The subset of `window.location` this module needs. */
export interface WsOrigin {
  /** Host WITH port when non-default, e.g. `example.com` or `localhost:3000`. */
  host: string;
  /** Host WITHOUT port, e.g. `example.com`. */
  hostname: string;
  /** e.g. `https:` */
  protocol: string;
}

/** Default port of the standalone WS server (`yarn ws:server`). */
export const DEFAULT_WS_PORT = '3001';

function wsScheme(origin: WsOrigin): string {
  return origin.protocol === 'https:' ? 'wss:' : 'ws:';
}

/** Trailing slashes are dropped so callers can append `?token=…` cleanly. */
function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Resolve the WS endpoint.
 *
 * `configured` accepts four shapes, in precedence order:
 *
 * | Value                    | Result                                  |
 * | ------------------------ | --------------------------------------- |
 * | `wss://host/ws`          | used verbatim                           |
 * | `https://host/ws`        | scheme swapped to `wss://`              |
 * | `/ws`                    | same origin as the page, at that path   |
 * | `ws.example.com:3001`    | treated as `host[:port]`, page's scheme |
 *
 * A bare host is NOT silently discarded as invalid: falling back to the
 * default port on a typo would reproduce exactly the failure this resolves,
 * and would do it silently.
 *
 * When `configured` is empty/unset the legacy behavior is preserved exactly:
 * the page's hostname with `NEXT_PUBLIC_WS_PORT` (default 3001) appended.
 */
export function resolveWsUrl(
  configured: string | null | undefined,
  origin: WsOrigin,
  fallbackPort: string = DEFAULT_WS_PORT,
): string {
  const value = configured?.trim();

  if (value) {
    if (value.startsWith('ws://') || value.startsWith('wss://')) {
      return stripTrailingSlash(value);
    }
    if (value.startsWith('http://')) {
      return stripTrailingSlash(`ws://${value.slice('http://'.length)}`);
    }
    if (value.startsWith('https://')) {
      return stripTrailingSlash(`wss://${value.slice('https://'.length)}`);
    }
    if (value.startsWith('/')) {
      // Same origin — `host` (not `hostname`) so a non-default page port
      // is carried over, which is what makes this work in local dev too.
      return stripTrailingSlash(`${wsScheme(origin)}//${origin.host}${value}`);
    }
    return stripTrailingSlash(`${wsScheme(origin)}//${value}`);
  }

  const port = fallbackPort.trim() || DEFAULT_WS_PORT;
  return `${wsScheme(origin)}//${origin.hostname}:${port}`;
}

/**
 * `resolveWsUrl` against the live `window.location`, returning `''` when
 * there is no window (SSR / prerender) so callers can skip connecting.
 *
 * Shared by the sync socket (`ws-client.ts`) and the collaborative-editing
 * socket (`tiptap-editor.tsx`) — both face the same reverse-proxy problem and
 * must not resolve it two different ways.
 */
export function resolveBrowserWsUrl(
  configured: string | null | undefined,
  fallbackPort?: string,
): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return resolveWsUrl(configured, window.location, fallbackPort);
}
