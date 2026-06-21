// Sentry server-side error monitoring (errors only — no perf tracing). Imported FIRST in server.js so
// init runs before the app and other modules load. No-op when SENTRY_DSN_SERVER is unset (local dev /
// tests), so nothing changes there. See docs/plans/monitoring.md.
import * as Sentry from '@sentry/node';

export const sentryEnabled = !!process.env.SENTRY_DSN_SERVER;

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_SERVER,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    release: process.env.SENTRY_RELEASE, // CI can pass the git SHA (image is already tagged by SHA)
    tracesSampleRate: 0, // errors only — stay within the free tier
  });
}
