'use strict';

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      canvas: require.resolve('canvas'),
      ...config.resolve.fallback,
    };
    return config;
  },
  swcMinify: true,
};

module.exports = nextConfig;