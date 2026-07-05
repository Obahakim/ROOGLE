/**
 * scripts/check-sphere-connection.ts
 *
 * Helper script to verify Sphere SDK connectivity.
 *
 * Usage:
 *   npx tsx scripts/check-sphere-connection.ts
 *
 * This will attempt to initialize the real SphereClient and report:
 * - Whether the REAL SDK connected successfully, or
 * - Whether it fell back to mock mode (with reasons).
 *
 * Make sure your .env contains the necessary SPHERE_* variables.
 */

import { getSphereClient } from '../src/sphere/client';

async function main() {
  console.log('=== ROOGLE Sphere SDK Connection Check ===\n');

  const client = getSphereClient();

  // This will log detailed info inside the client
  await client.initialize();

  if (client.isUsingRealSdk()) {
    console.log('\n✅ SUCCESS: Connected to REAL Unicity Sphere SDK');
    try {
      const identity = await client.getIdentity();
      console.log('   Agent Identity:', identity);
    } catch (e) {
      console.log('   (Could not retrieve identity details)');
    }
    console.log('\nYou are operating in real-network mode.');
    console.log('Discovery tools and handoffs will attempt live Sphere calls.');
  } else {
    console.log('\n⚠️  FALLBACK MODE: Using MOCK data for discovery & handoff');
    console.log('\nTo enable the real SDK:');
    console.log('  1. Ensure .env exists (copy from .env.example)');
    console.log('  2. Set SPHERE_NETWORK=testnet (or mainnet)');
    console.log('  3. Set SPHERE_MNEMONIC=... (12 or 24 words) for persistent identity');
    console.log('  4. Optionally set SPHERE_DATA_DIR, SPHERE_TOKENS_DIR, SPHERE_ORACLE_API_KEY');
    console.log('\nRe-run this script after updating .env to verify.');
  }

  console.log('\n=== Check complete ===');
}

main().catch((err) => {
  console.error('Unexpected error during Sphere check:', err);
  process.exit(1);
});
