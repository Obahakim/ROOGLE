/**
 * config/index.ts
 *
 * Loads environment configuration and provides safe defaults.
 * All code should import from here instead of process.env directly.
 *
 * There is no server-side wallet and no LLM in this architecture — every
 * balance/send/swap action happens in the browser, against the user's own
 * wallet, via Sphere Connect. This file is intentionally small.
 */

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // Network the client-side Sphere instances (wallet connect + market
  // discovery) should target. Must match whatever network the user's
  // wallet is actually on.
  sphereNetwork: (process.env.SPHERE_NETWORK as 'testnet' | 'mainnet' | 'devnet') || 'testnet',
};