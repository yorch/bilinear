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
        test: {
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.tsx'],
          name: 'dom',
          setupFiles: ['./src/test/setup.ts', './src/test/setup-dom.ts'],
        },
      },
    ],
  },
});
