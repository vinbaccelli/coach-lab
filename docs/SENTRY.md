# Sentry (error reports)

Errors from the browser, the server and the middleware go to Sentry, plus a
small "Report a problem" button. It is **off** unless `NEXT_PUBLIC_SENTRY_DSN`
is a non-empty **EU** DSN.

## Switches
- `NEXT_PUBLIC_SENTRY_DSN`: from the Sentry project (EU region: the DSN host
  ends in `.de.sentry.io`). Empty, or a non-EU host: Sentry and the button are
  off (`lib/sentryConfig.ts sentryEnabled`).
- Release = the git commit SHA (`VERCEL_GIT_COMMIT_SHA`, read at build time in
  `next.config.js` into `NEXT_PUBLIC_SENTRY_RELEASE`). Environment = Vercel's
  (`VERCEL_ENV`: production / preview / development; `development` locally).
- Source maps upload only if `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
  `SENTRY_PROJECT` are set in the build environment (EU: also
  `SENTRY_URL=https://de.sentry.io`). Without them, stack traces are minified.

## What it does not do
- No session replay (the integration is never added).
- No performance tracing (no sample rate is set and the default BrowserTracing
  integration is removed in `instrumentation-client.ts`).
- No tunnel route (the middleware would gate it behind login).

## What is removed before anything leaves the device or server
`lib/sentryConfig.ts` (unit-tested in `tests/sentryConfig.test.ts`):
- the user object, server name, cookies, headers, request bodies and query
  string are dropped; `sendDefaultPii` is false;
- every URL loses its query string and fragment;
- `blob:` and `data:` URLs become `blob:[removed]` / `data:[removed]`;
- media and image file names (mp4, mov, webm, jpg, png, …) become `[file]`;
- e-mail addresses become `[email]`;
- the same applies to breadcrumbs (navigation, fetch, console).
Not covered: text a person types into the feedback box (the form has no name,
e-mail or screenshot field and asks not to include personal details).

## Files
`instrumentation-client.ts` (browser init + feedback integration),
`sentry.server.config.ts`, `sentry.edge.config.ts`, `instrumentation.ts`,
`components/ReportProblemButton.tsx` (mounted in `app/layout.tsx`),
`lib/sentryConfig.ts`, `next.config.js` (`withSentryConfig`).

## Open
- The privacy policy (`app/privacy/page.tsx`) does not mention Sentry as a
  processor yet; it should before the DSN is set in production.
- The button is a small round icon-only speech bubble (34 px, aria-label
  "Report a problem"). It sits on the right edge, below the top-right
  +B/trash row (`[data-tour-id="tour-video-ab"]`) and above the zoom stack
  (`[data-tour-id="tour-zoom"]`), measured every 0.5 s and on resize /
  visualViewport changes, inside the safe-area insets; if there is no room it
  moves to the left of the zoom stack (`lib/reportButtonPlacement.ts`). It was
  first a text pill bottom-left (hidden behind the toolbar), then bottom-right
  (on the video in portrait, not visible in landscape). In landscape (width > height) it is placed from the measured
  `getBoundingClientRect` of every element in the +B/trash row and the zoom stack,
  ≥ 12 px from each: left of the row's leftmost button, else on the right edge
  below the home button. Portrait is unchanged. Not checked in a browser or on a
  phone.
