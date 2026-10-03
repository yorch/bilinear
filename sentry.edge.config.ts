import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentry-data-collection';

Sentry.init({
  dataCollection: SENTRY_DATA_COLLECTION,
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN && process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
