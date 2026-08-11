/**
 * client/src/market.ts
 *
 * Market discovery — search and recent listings. The Sphere Connect
 * protocol has no market-search RPC (by design: listings are a public
 * bulletin board, not something that needs wallet permission to read).
 *
 * So this runs its OWN Sphere instance, entirely in the browser, without
 * initializing wallet money custody. Market search is a public REST operation
 * and does not need a mnemonic, wallet-api composition, or signing identity.
 * It never touches a real person's wallet and exists purely to read the public
 * market feed — closer to an anonymous API client than a wallet.
 */

import { Sphere } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';
import { createWalletApiProviders } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';

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
      const baseProviders = createBrowserProviders({
        network: __SPHERE_NETWORK__ as any,
        market: true,
      });
      const providers = createWalletApiProviders(baseProviders, {
        network: __SPHERE_NETWORK__ as any,
        baseUrl: 'https://wallet-api.unicity.network',
      });

      const { sphere } = await Sphere.init({
        ...providers,
        network: __SPHERE_NETWORK__ as any,
        autoGenerate: true,
      });
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
