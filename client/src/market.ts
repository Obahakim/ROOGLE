/**
 * client/src/market.ts
 *
 * Market discovery — search and recent listings. The Sphere Connect
 * protocol has no market-search RPC (by design: listings are a public
 * bulletin board, not something that needs wallet permission to read).
 *
 * So this runs its OWN Sphere instance, entirely in the browser, with an
 * auto-generated throwaway identity. It never touches a mnemonic that
 * belongs to a real person, never persists anything, never signs a
 * transaction, and never appears in the wallet's UI. It exists purely to
 * read the public market feed — closer to an anonymous API client than a
 * wallet.
 */

import { Sphere } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';

export interface MarketIntent {
  id: string;
  score?: number;
  agentNametag?: string;
  agentPublicKey: string;
  description: string;
  intentType: string;
  category?: string;
  price?: number;
  currency: string;
}

let sphereInstance: any = null;
let initPromise: Promise<any> | null = null;

async function getMarketSphere() {
  if (sphereInstance) return sphereInstance;
  if (!initPromise) {
    initPromise = (async () => {
      const providers = createBrowserProviders({
        network: __SPHERE_NETWORK__ as any,
        market: true,
      });
      // Ephemeral, throwaway identity — read-only discovery, never a
      // persistent or funded wallet.
      const { sphere } = await Sphere.init({ ...providers, autoGenerate: true });
      sphereInstance = sphere;
      return sphere;
    })();
  }
  return initPromise;
}

export async function searchMarket(query: string): Promise<MarketIntent[]> {
  const sphere = await getMarketSphere();
  const result = await sphere.market.search(query);
  return result.intents || [];
}

export async function getRecentListings(): Promise<MarketIntent[]> {
  const sphere = await getMarketSphere();
  if (typeof sphere.market.getRecentListings === 'function') {
    return sphere.market.getRecentListings();
  }
  // Fall back to an empty-query search if this SDK build doesn't expose
  // getRecentListings — still real data, just less targeted.
  const result = await sphere.market.search('');
  return result.intents || [];
}

/** A resolvable address for messaging: prefer @nametag, else the raw pubkey. */
export function addressableTarget(intent: MarketIntent): string {
  return intent.agentNametag ? `@${intent.agentNametag}` : intent.agentPublicKey;
}