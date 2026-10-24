import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEuDsn, scrubBreadcrumb, scrubEvent, scrubString, scrubUrl, sentryBaseOptions, sentryEnabled,
} from '@/lib/sentryConfig';

const EU = 'https://abc123@o4500.ingest.de.sentry.io/4509';
const US = 'https://abc123@o4500.ingest.us.sentry.io/4509';

test('Sentry is off with an empty DSN and with a non-EU DSN, on only for an EU one', () => {
  for (const d of [undefined, null, '', '   ']) assert.equal(sentryEnabled(d as string | null | undefined), false);
  assert.equal(isEuDsn(EU), true);
  assert.equal(isEuDsn('https://abc@o1.ingest.sentry.io/1'), false);
  assert.equal(isEuDsn(US), false);
  assert.equal(isEuDsn('not a url'), false);
  assert.equal(sentryEnabled(EU), true);
  assert.equal(sentryEnabled(US), false);
});

test('base options: disabled without DSN, release and environment passed through, no PII, no tracing, no replay', () => {
  const off = sentryBaseOptions({ dsn: '', release: 'abc', environment: 'preview' });
  assert.equal(off.enabled, false);
  assert.equal(off.dsn, undefined);
  const on = sentryBaseOptions({ dsn: EU, release: '49f925db', environment: 'production' });
  assert.equal(on.enabled, true);
  assert.equal(on.dsn, EU);
  assert.equal(on.release, '49f925db');
  assert.equal(on.environment, 'production');
  assert.equal(on.sendDefaultPii, false);
  const keys = Object.keys(on);
  for (const k of ['tracesSampleRate', 'tracesSampler', 'replaysSessionSampleRate', 'replaysOnErrorSampleRate', 'integrations']) {
    assert.equal(keys.includes(k), false, `${k} must not be set here`);
  }
  assert.equal(sentryBaseOptions({}).environment, 'development');
});

test('URLs lose their query string and fragment; blob: and data: URLs are removed', () => {
  assert.equal(scrubUrl('https://app.example.com/analysis?vdebug=1&token=secret#x'), 'https://app.example.com/analysis');
  assert.equal(scrubUrl('/analysis?clip=my-video.mp4'), '/analysis');
  assert.equal(scrubUrl('blob:https://app.example.com/1b2c-3d4e'), 'blob:[removed]');
  assert.equal(scrubUrl('data:video/mp4;base64,AAAA'), 'data:[removed]');
});

test('free text: blob and data URLs, media file names, emails and query strings never survive', () => {
  assert.equal(scrubString('Failed to load blob:https://app.example.com/1b2c-3d4e-5f'), 'Failed to load blob:[removed]');
  assert.equal(scrubString('src=data:video/mp4;base64,AAAA'), 'src=data:[removed]');
  assert.equal(scrubString('could not decode My Player Serve.MOV'), 'could not decode My Player [file]');
  assert.equal(scrubString('IMG_2041.jpeg and clip-final.webm'), '[file] and [file]');
  assert.equal(scrubString('mail coach@club.example.org about it'), 'mail [email] about it');
  assert.equal(scrubString('GET https://api.example.com/v1/x?email=a@b.co&k=1 failed'), 'GET https://api.example.com/v1/x failed');
  assert.equal(scrubString('plain text stays'), 'plain text stays');
});

test('events: user, cookies, headers, body and query string are dropped; strings are scrubbed deeply', () => {
  const out = scrubEvent({
    message: 'bad file serve.mp4 for coach@club.example.org',
    user: { id: '1', email: 'coach@club.example.org', ip_address: '1.2.3.4' },
    server_name: 'host',
    request: {
      url: 'https://app.example.com/analysis?clip=serve.mp4',
      query_string: 'clip=serve.mp4',
      cookies: { a: 'b' },
      headers: { cookie: 'x', 'user-agent': 'ua' },
      data: { video: 'blob:https://app.example.com/9' },
    },
    exception: { values: [{ type: 'Error', value: 'cannot play blob:https://app.example.com/9' }] },
    breadcrumbs: [{ category: 'navigation', data: { from: '/a?x=1', to: '/analysis?vdebug=1' } }],
    extra: { name: 'Match 3 forehand.mov' },
  }) as Record<string, any>;
  assert.equal(out.message, 'bad file [file] for [email]');
  assert.equal(out.user, undefined);
  assert.equal(out.server_name, undefined);
  assert.equal(out.request.url, 'https://app.example.com/analysis');
  for (const k of ['query_string', 'cookies', 'headers', 'data']) assert.equal(out.request[k], undefined, k);
  assert.equal(out.exception.values[0].value, 'cannot play blob:[removed]');
  assert.deepEqual(out.breadcrumbs[0].data, { from: '/a', to: '/analysis' });
  assert.equal(out.extra.name, 'Match 3 [file]');
  assert.equal(JSON.stringify(out).includes('serve.mp4'), false);
  assert.equal(JSON.stringify(out).includes('@club'), false);
});

test('breadcrumbs: fetch/xhr/navigation urls lose their query string, console text is scrubbed', () => {
  const f = scrubBreadcrumb({ category: 'fetch', data: { url: 'https://api.example.com/x?token=1', method: 'GET' } }) as Record<string, any>;
  assert.equal(f.data.url, 'https://api.example.com/x');
  assert.equal(f.data.method, 'GET');
  const c = scrubBreadcrumb({ category: 'console', message: 'loaded blob:https://app.example.com/7 for a@b.co' }) as Record<string, any>;
  assert.equal(c.message, 'loaded blob:[removed] for [email]');
});
