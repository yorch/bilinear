import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  output: 'standalone',
  // Keep pino and its pretty-print transport out of the webpack/turbopack
  // server bundle. pino-pretty runs in a worker thread (via thread-stream);
  // when bundled, the worker's transport target can't be resolved at runtime
  // ("unable to determine transport target"), so logs silently vanish or the
  // logger throws on init. Externalizing loads them from node_modules instead,
  // and ensures `output: 'standalone'` traces them into the deploy bundle.
  serverExternalPackages: ['pino', 'pino-pretty', 'thread-stream'],
};

const baseConfig = withBundleAnalyzer(nextConfig);

// Only inject the Sentry webpack plugin when a DSN is configured.
// Without a DSN the plugin adds build overhead but sends nothing, so skip it.
const sentryDsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

export default sentryDsn
  ? withSentryConfig(baseConfig, {
      automaticVercelMonitors: true,
      disableLogger: true,
      org: process.env.SENTRY_ORG ?? 'your-org',
      project: process.env.SENTRY_PROJECT ?? 'bilinear',
      silent: true,
      tunnelRoute: '/monitoring',
      widenClientFileUpload: true,
    })
  : baseConfig;
