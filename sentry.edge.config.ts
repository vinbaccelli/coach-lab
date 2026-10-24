import * as Sentry from '@sentry/nextjs';
import { sentryBaseOptions, sentryEnvFromProcess } from '@/lib/sentryConfig';

// Edge (middleware) Sentry: same switches and scrubbing as the browser; no tracing.
Sentry.init(sentryBaseOptions(sentryEnvFromProcess()));
