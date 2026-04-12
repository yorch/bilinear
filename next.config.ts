import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  output: 'standalone',
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
