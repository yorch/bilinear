import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    coverage: {
      exclude: [
        'node_modules/**',
        'src/generated/**',
        '.next/**',
        '*.config.*',
        'src/app/**',
        'src/components/**',
        'src/hooks/**',
        'src/lib/**',
      ],
      include: ['src/server/**'],
      provider: 'v8',
      reporter: ['text', 'text-summary'],
    },
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
