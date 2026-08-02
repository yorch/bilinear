/**
 * Collaborative-editing (YJS) configuration as the browser sees it.
 *
 * Both fields were previously `NEXT_PUBLIC_*` constants read at module scope
 * in `tiptap-editor.tsx`. `next build` inlines those, so a deployment running
 * the published image could neither enable collab nor point it anywhere
 * reachable — the feature was unreachable for image users regardless of how
 * they configured it. They are now resolved server-side per request and
 * handed down through `CollabProvider`, with the build-time values kept as
 * fallbacks so build-from-source setups are unaffected.
 */

/** Default port of the standalone YJS server (`yarn yjs:server`). */
export const DEFAULT_YJS_PORT = '1234';

export interface CollabConfig {
  /** Whether multi-cursor collaborative editing is active. */
  enabled: boolean;
  /**
   * Endpoint the browser should connect to — a path (`/collab`), an absolute
   * URL, or a bare host. `null` means unconfigured, in which case the client
   * falls back to its build-time value. Resolved by `resolveBrowserWsUrl`.
   */
  serverUrl: string | null;
}

/**
 * Collab off, nothing configured. Used as the context default so a tree
 * rendered without `CollabProvider` (tests, isolated stories) degrades to a
 * plain non-collaborative editor rather than dialing a wrong endpoint.
 */
export const DISABLED_COLLAB_CONFIG: CollabConfig = Object.freeze({
  enabled: false,
  serverUrl: null,
});
