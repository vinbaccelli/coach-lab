/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    esmExternals: 'loose',
  },
};

module.exports = nextConfig;
