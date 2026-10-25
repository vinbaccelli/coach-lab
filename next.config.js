'use strict';

const { withSentryConfig } = require('@sentry/nextjs/config');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Sentry (docs/SENTRY.md): the release is the git commit SHA and the
  // environment is Vercel's, both read at build time (Vercel sets them for every
  // build). Inlined into the bundles; empty / 'development' locally.
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA || '',
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV || 'development',
  },
  // Verification builds set NEXT_DIST_DIR so they never clobber the dev
  // server's .next (which caused recurring "Internal Server Error" locally).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Keep jsdom (and its dependents) OUT of the server bundle. When webpack
  // inlines jsdom, its xhr-sync-worker script self-executes with a
  // process.stdin listener — on serverless (Vercel) stdin is empty/closed,
  // JSON.parse('') throws an uncaughtException, and every API route grouped
  // into that lambda returns an empty 500. Externalized, jsdom loads from
  // node_modules and spawns its worker as a real child process only if used.
  serverExternalPackages: ['jsdom', '@ybd-project/ytdl-core', 'fabric'],
  // Keep onnxruntime-node's NATIVE BINARIES out of the serverless function.
  //
  // Nothing server-side ever runs ONNX: the models are loaded in the BROWSER by
  // onnxruntime-web (wasm from /ort/, weights from /models/), and
  // @huggingface/transformers is only ever reached through `await import()`
  // inside async, browser-only code paths (lib/stroMotionDraft/samRacket.ts,
  // racketDetect.ts). Webpack still TRACES the dependency it can see
  // statically, so the binaries get packed into the function even though they
  // are never executed there.
  //
  // That is harmless locally and fatal on Vercel. onnxruntime-node's install
  // metadata lists `'win32/x64': []` but `'linux/x64': ['cuda12']`, so a Linux
  // build additionally downloads libonnxruntime_providers_cuda.so /
  // _tensorrt.so — ~370MB of GPU inference libraries that do not exist on a
  // Windows install. Hence 44MB traced locally vs 412.91MB on Vercel, over the
  // 250MB function limit. Vercel has no GPU; these can never be used.
  // Keyed '**' (every route), not just '/analysis': nothing server-side in this
  // app ever runs ONNX, so these binaries are dead weight in any function they
  // get traced into.
  outputFileTracingExcludes: {
    '**': ['./node_modules/onnxruntime-node/bin/**'],
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      canvas: false,
      fs: false,
    };
    return config;
  },
};

module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
  // Source maps are uploaded only when SENTRY_AUTH_TOKEN (with SENTRY_ORG and
  // SENTRY_PROJECT) is set in the build environment; without them the plugin
  // does nothing. EU region: set SENTRY_URL=https://de.sentry.io for uploads.
  silent: true,
  telemetry: false,
  disableLogger: true,
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA || undefined },
});
