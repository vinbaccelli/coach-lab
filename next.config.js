'use strict';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      /**
       * API routes should not inherit strict COEP from pages — it can interfere with `fetch`/proxies
       * while the Analysis shell still uses credentialless COEP for TF/WebGPU canvas isolation.
       */
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

module.exports = nextConfig;