import type { NextConfig } from 'next';

/**
 * BOS_DEMO_EXPORT=1 builds a static demo of the UI with the in-memory data gateway (no Firebase).
 * Server-only entry points use the `.server.ts` extension (route.server.ts, middleware.server.ts),
 * so the demo simply leaves that extension out of pageExtensions.
 */
const demo = process.env.BOS_DEMO_EXPORT === '1';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@bos/domain', '@bos/schemas'],
  ...(demo
    ? { output: 'export', pageExtensions: ['tsx', 'ts'], images: { unoptimized: true }, assetPrefix: './a' }
    : { output: 'standalone', pageExtensions: ['tsx', 'ts', 'server.ts'] }),
};

export default config;
