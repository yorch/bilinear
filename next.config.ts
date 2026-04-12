import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  automaticVercelMonitors: true,
  disableLogger: true,
  org: process.env.SENTRY_ORG ?? 'your-org',
  project: process.env.SENTRY_PROJECT ?? 'bilinear',
  silent: true,
  tunnelRoute: '/monitoring',
  widenClientFileUpload: true,
});
