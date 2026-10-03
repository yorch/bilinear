import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = { '@': resolve(__dirname, './src') };

export default defineConfig({
  // vite 8's oxc transformer handles the JSX in the jsdom project's .test.tsx
  // files with React 19's automatic runtime by default (no @vitejs/plugin-react
  // and no explicit jsx config needed).
  resolve: {
    alias,
  },
  test: {
    coverage: {
      exclude: ['node_modules/**', 'src/generated/**', '.next/**', '*.config.*'],
      // Cover the whole app, not just the server — the client sync engine and
      // hooks are the app's defining risk surface and were previously excluded.
      include: ['src/server/**', 'src/lib/**', 'src/hooks/**', 'src/stores/**'],
      provider: 'v8',
      reporter: ['text', 'text-summary'],
    },
    globals: true,
    // Two projects: node-environment unit tests (*.test.ts, mostly server) and
    // a jsdom environment for component/hook tests (*.test.tsx).
    projects: [
      {
        extends: true,
        test: {
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.ts'],
          name: 'node',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        extends: true,
        // jsdom tests are browser code, so isomorphic packages must resolve to
        // their browser build. Vitest transforms through Vite's SSR pipeline,
        // whose default conditions are node-first, so `@sentry/nextjs` would
        // otherwise resolve to `index.server.js` — these tests would exercise a
        // different Sentry than the browser loads.
        //
        // This started as a crash fix: Sentry 10.73's server build reached a
        // vendored webpack plugin that picked its browser branch on `typeof
        // document !== 'undefined'` and then called `fileURLToPath` on a
        // non-file URL, so importing it under jsdom threw outright. Sentry 11
        // no longer does that — verified by removing this block, after which the
        // dom project passes. It stays for the reason above, which does not
        // depend on the bug: a browser test should load the browser build.
        resolve: {
          alias,
          conditions: ['browser', 'module', 'development|production'],
        },
        test: {
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.tsx'],
          name: 'dom',
          // Transform `@sentry/nextjs` rather than externalising it: its browser
          // build still imports `next/router` extensionlessly, which Node's ESM
          // resolver rejects but Vite's resolves. Still load-bearing under
          // Sentry 11 — without it the dom project fails to resolve
          // `next/router` from `pagesRouterNavigationInstrumentation`.
          server: { deps: { inline: ['@sentry/nextjs'] } },
          setupFiles: ['./src/test/setup.ts', './src/test/setup-dom.ts'],
        },
      },
    ],
  },
});
