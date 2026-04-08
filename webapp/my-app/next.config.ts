import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin tracing root to this app so Next.js doesn't walk up to parent lockfiles
  outputFileTracingRoot: __dirname,
};

export default nextConfig;