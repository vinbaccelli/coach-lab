import { scrubString } from '@/lib/sentryConfig';

/**
 * What the Stripe webhook sends to Sentry when it answers 5xx. Pure, so the
 * privacy rule is unit-tested (tests/webhookSync.test.ts).
 *
 * No personal data: the failure text can carry a coach's user id (UUID), a
 * Stripe customer id, an email or a name from a database error, so the message
 * keeps only the shape of the failure. The tags are the event type, the Stripe
 * event id (the key to find it in the Stripe dashboard and in
 * billing_event_errors) and livemode: none of them identifies a person.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CUSTOMER_ID = /\bcus_[A-Za-z0-9]+/g;
// A Postgres detail such as `Key (user_id)=(…)` echoes the row's values.
const KEY_DETAIL = /\(([a-z_]+)\)=\([^)]*\)/gi;

export function scrubWebhookError(text: string): string {
  return scrubString(text)
    .replace(UUID, '[id]')
    .replace(CUSTOMER_ID, 'cus_[id]')
    .replace(KEY_DETAIL, '($1)=([removed])')
    .slice(0, 500);
}

export type WebhookFailureReport = {
  message: string;
  tags: { area: 'stripe_webhook'; stage: 'config' | 'sync'; event_type: string; event_id: string; livemode: string };
};

export function webhookFailureReport(
  event: { id: string; type: string; livemode: boolean },
  stage: 'config' | 'sync',
  error: string,
): WebhookFailureReport {
  return {
    message: `[stripe/webhook] ${event.type} failed (${stage}), answered 500: ${scrubWebhookError(error)}`,
    tags: { area: 'stripe_webhook', stage, event_type: event.type, event_id: event.id, livemode: String(event.livemode) },
  };
}
