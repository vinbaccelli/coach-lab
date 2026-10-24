import * as Sentry from '@sentry/nextjs';
import { sentryBaseOptions, sentryEnvFromProcess } from '@/lib/sentryConfig';

/**
 * Browser Sentry (docs/SENTRY.md). Off unless NEXT_PUBLIC_SENTRY_DSN is a
 * non-empty EU DSN. No session replay and no performance tracing: the replay
 * integration is never added and the default BrowserTracing integration is
 * filtered out. The "Report a problem" button is components/ReportProblemButton.tsx
 * (the feedback widget's own floating trigger is off: autoInject false).
 */
const base = sentryBaseOptions(sentryEnvFromProcess());

Sentry.init({
  ...base,
  integrations: (defaults) => {
    const kept = defaults.filter((i) => i.name !== 'BrowserTracing');
    if (!base.enabled) return kept;
    return [
      ...kept,
      Sentry.feedbackIntegration({
        autoInject: false,
        colorScheme: 'system',
        showBranding: false,
        showName: false,
        showEmail: false,
        isEmailRequired: false,
        enableScreenshot: false,
        triggerLabel: 'Report a problem',
        formTitle: 'Report a problem',
        submitButtonLabel: 'Send',
        messageLabel: 'What went wrong?',
        messagePlaceholder: 'What went wrong? Please do not include emails or personal details.',
        successMessageText: 'Thank you, your report was sent.',
      }),
    ];
  },
});
