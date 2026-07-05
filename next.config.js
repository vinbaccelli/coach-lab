'use strict';

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
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

module.exports = withBundleAnalyzer(nextConfig);
