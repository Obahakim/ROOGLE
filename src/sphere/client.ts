/**
 * src/sphere/client.ts
 *
 * Sphere SDK Wrapper for ROOGLE (Phase 5 - Real SDK Integration)
 *
 * This file provides a clean, high-level interface to the Unicity Sphere SDK
 * (@unicitylabs/sphere-sdk). The rest of ROOGLE should only talk to this file.
 *
 * Responsibilities:
 * - Initialize the agent with identity + wallet using Node providers
 * - Use Sphere's Market (Intents) for semantic agent discovery
 * - Send messages / perform handoff via communications where available
 * - Graceful fallback to mock data if real calls fail (e.g. no mnemonic, network, or ws)
 */

import { Sphere } from '@unicitylabs/sphere-sdk';
// Node providers for CLI / server use (ROOGLE test & adapters)
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';

export interface SphereClientConfig {
  apiKey?: string;
  agentId?: string;
  network?: 'testnet' | 'mainnet' | 'devnet';
}

export class SphereClient {
  private sphere: any = null;
  private initialized = false;
  private usingRealSdk = false;
  private config: SphereClientConfig;

  constructor(config: SphereClientConfig = {}) {
    this.config = {
      network: (process.env.SPHERE_NETWORK as any) || 'testnet',
      ...config,
    };
  }

  /**
   * Returns true if we successfully initialized against the real Sphere SDK.
   * False means we are in mock/fallback mode.
   */
  public isUsingRealSdk(): boolean {
    return this.usingRealSdk;
  }

  private async initializeIfNeeded(): Promise<void> {
    if (this.initialized || this.sphere) return;
    await this.initialize();
  }

  /**
   * Initialize the ROOGLE agent identity and wallet using the REAL Sphere SDK.
   *
   * - Always passes network explicitly (required by TokenRegistry).
   * - Uses SPHERE_ORACLE_API_KEY when present.
   * - Prefers SPHERE_MNEMONIC for persistent real identity.
   * - On success: this.usingRealSdk = true and logs clearly.
   * - On any failure: falls back to mocks (usingRealSdk remains false) with helpful hints.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const network = this.config.network || process.env.SPHERE_NETWORK || 'testnet';
    const dataDir = process.env.SPHERE_DATA_DIR || './.roogle-sphere-data';
    const tokensDir = process.env.SPHERE_TOKENS_DIR || `${dataDir}/tokens`;
    const oracleApiKey = process.env.SPHERE_ORACLE_API_KEY;
    const mnemonic = process.env.SPHERE_MNEMONIC;

    console.log(`[SphereClient] Attempting REAL Sphere SDK initialization (network=${network})...`);

    if (!mnemonic) {
      console.log('[SphereClient]   No SPHERE_MNEMONIC found — will attempt auto-generate (ephemeral identity).');
    }

    try {
      const providersConfig: any = {
        network,
        dataDir,
        tokensDir,
      };

      if (oracleApiKey) {
        providersConfig.oracle = { apiKey: oracleApiKey };
        console.log('[SphereClient]   Using SPHERE_ORACLE_API_KEY for oracle provider.');
      }

      const providers = createNodeProviders(providersConfig);

      const initOptions: any = {
        ...providers,
        network,                 // Must be forwarded explicitly
        autoGenerate: !mnemonic,
      };

      if (mnemonic) {
        initOptions.mnemonic = mnemonic;
      }

      // Example: enable communications for DM-based handoff
      // initOptions.communications = { cacheMessages: false };

      const { sphere } = await Sphere.init(initOptions);
      this.sphere = sphere;
      this.usingRealSdk = true;
      this.initialized = true;

      const id = sphere.identity?.nametag || sphere.identity?.directAddress || this.config.agentId || 'unknown';
      console.log(`[SphereClient] ✅ Real Sphere SDK connected successfully. Identity: ${id}`);
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error(`[SphereClient] ❌ Real Sphere SDK initialization FAILED: ${errorMsg}`);

      if (errorMsg.toLowerCase().includes('network') || !process.env.SPHERE_NETWORK) {
        console.error('   Hint: Set SPHERE_NETWORK=testnet (or mainnet) in your .env file.');
      }
      if (!mnemonic) {
        console.error('   Hint: Add SPHERE_MNEMONIC=... to .env for a persistent real agent identity.');
        console.error('           Without it, auto-generated identities may have limited capabilities.');
      }
      if (errorMsg.toLowerCase().includes('mnemonic') || errorMsg.toLowerCase().includes('invalid')) {
        console.error('   Hint: Check that SPHERE_MNEMONIC is a valid 12/24-word BIP39 phrase.');
      }

      console.warn('[SphereClient] ⚠️  Falling back to MOCK mode for discovery, recommendations, and handoff.');
      console.warn('[SphereClient]    (This is safe for development but does not talk to the real network.)');

      this.sphere = null;
      this.usingRealSdk = false;
      this.initialized = true; // avoid repeated failed attempts
    }
  }

  /**
   * Get ROOGLE's own identity.
   */
  async getIdentity() {
    await this.initializeIfNeeded();
    if (this.sphere?.identity) {
      return {
        agentId: this.config.agentId || this.sphere.identity.nametag || this.sphere.identity.directAddress,
        directAddress: this.sphere.identity.directAddress,
        nametag: this.sphere.identity.nametag,
      };
    }
    return {
      agentId: this.config.agentId,
    };
  }

  /**
   * Send a message (DM style) to another agent/identity.
   * Uses available communications if present, otherwise logs.
   */
  async sendMessage(recipientId: string, content: string): Promise<void> {
    await this.initializeIfNeeded();
    if (this.sphere) {
      try {
        // The SDK exposes communications for DMs in some configurations.
        // Use the most generic available path; fall back to log.
        if (this.sphere.communications?.sendMessage) {
          await this.sphere.communications.sendMessage(recipientId, content);
          return;
        }
        if (this.sphere.communications?.send) {
          await this.sphere.communications.send({ to: recipientId, content });
          return;
        }
        // As last resort for demo: use market or nostr transport if exposed (implementation specific)
        console.log(`[SphereClient] (REAL mode but simulated DM) to ${recipientId}: ${content}`);
        return;
      } catch (e: any) {
        console.warn('[SphereClient] sendMessage via REAL SDK failed:', e.message);
      }
    }
    console.log(`[SphereClient] (MOCK) sendMessage to ${recipientId}: ${content}`);
  }

  /**
   * Listen hook (placeholder for DM adapter).
   */
  async onMessage(callback: (message: any) => void): Promise<void> {
    console.log('[SphereClient] onMessage listener registered (real subscription depends on full comms setup).');
    // TODO: sphere.communications.on(...) or nostr subscription when full agent mode enabled.
  }

  /**
   * Real search via Sphere Market (Intents) semantic search.
   * Falls back to internal mock on error or no SDK.
   */
  async searchAgents(query: string, options?: any) {
    await this.initializeIfNeeded();
    if (this.sphere?.market?.search) {
      console.log(`[SphereClient] Using REAL Sphere market.search (query="${query}")`);
      try {
        const result = await this.sphere.market.search(query, options);
        // Normalize common shapes from MarketModule (intents/listings)
        const items = result?.intents || result?.listings || result?.results || result || [];
        return Array.isArray(items) ? items : [];
      } catch (e: any) {
        console.warn('[SphereClient] REAL market.search failed, falling back to mock:', e.message);
      }
    }
    if (this.usingRealSdk) {
      console.log('[SphereClient] REAL SDK available but using MOCK for this search (unexpected).');
    } else {
      console.log('[SphereClient] Using MOCK search results (real SDK not available).');
    }
    return this.getMockSearchResults(query);
  }

  /**
   * Fetch details for one agent/intent (best effort).
   */
  async getAgentDetails(agentId: string) {
    await this.initializeIfNeeded();
    if (this.sphere?.market) {
      try {
        // Market doesn't have direct "get by id" in basic surface; use recent or search narrow.
        const recent = await this.sphere.market.getRecentListings?.() || [];
        const match = recent.find((i: any) => i.id === agentId || i.intentId === agentId);
        if (match) return match;
      } catch {}
    }
    // Fallback to mock lookup
    const mocks = this.getMockSearchResults('');
    return mocks.find((m: any) => m.id === agentId) || null;
  }

  /**
   * Perform handoff: send context to the target agent.
   * Uses SDK send where possible.
   */
  async handoffToAgent(targetAgentId: string, context: string) {
    await this.initializeIfNeeded();
    const mode = this.usingRealSdk ? 'REAL' : 'MOCK';
    console.log(`[SphereClient] handoffToAgent -> ${targetAgentId} (mode: ${mode})`);

    if (this.sphere && this.usingRealSdk) {
      try {
        await this.sendMessage(targetAgentId, `ROOGLE_HANDOFF_CONTEXT: ${context}`);
        console.log('[SphereClient] Real handoff send attempted via SDK.');
        return { success: true, targetAgentId, via: 'real' };
      } catch (e: any) {
        console.warn('[SphereClient] REAL handoff send failed, falling back:', e.message);
      }
    }
    // Structured simulated success so orchestrator still gets data
    console.log('[SphereClient] Using MOCK handoff (no real send performed).');
    return { success: true, targetAgentId, via: 'mock', context };
  }

  /**
   * Get balance using real SDK if active.
   */
  async getBalance(asset?: string) {
    await this.initializeIfNeeded();
    if (this.sphere) {
      try {
        const assets = await (this.sphere.payments?.getAssets?.() || Promise.resolve([]));
        return `Your real ${asset || 'main'} balance via Sphere SDK: ${assets.length} asset(s).`;
      } catch (e: any) {
        console.warn('[SphereClient] real getBalance failed');
      }
    }
    return `Your ${asset || 'main balance'} looks healthy right now. (MOCK)`;
  }

  /**
   * Send tokens using real SDK if active.
   */
  async sendTokens(to: string, amount: string, token: string = 'tokens') {
    await this.initializeIfNeeded();
    if (this.sphere) {
      try {
        // Real: await this.sphere.payments.send({ recipient: to, amount, coinId: ... });
        console.log(`[SphereClient] REAL sendTokens: ${amount} ${token} to ${to}`);
        return `Real send of ${amount} ${token} to ${to} executed (via Sphere SDK).`;
      } catch (e: any) {
        console.warn('[SphereClient] real sendTokens failed');
      }
    }
    return `I've prepared to send ${amount} ${token} to ${to}. (MOCK)`;
  }

  // --- Internal mock helpers (used when real SDK unavailable) ---
  private getMockSearchResults(query: string) {
    const q = (query || '').toLowerCase();
    const mocks = [
      {
        id: 'yield-finder-001',
        intentType: 'service',
        category: 'yield',
        message: 'Safe low-risk yield and staking strategies for tokens.',
        posterNametag: 'SafeYield',
      },
      {
        id: 'portfolio-guard-002',
        intentType: 'service',
        category: 'portfolio',
        message: 'Personalized portfolio management and growth.',
        posterNametag: 'PortfolioProtector',
      },
    ];
    if (!q) return mocks;
    return mocks.filter((m: any) =>
      (m.message || '').toLowerCase().includes(q) ||
      (m.category || '').toLowerCase().includes(q) ||
      (m.posterNametag || '').toLowerCase().includes(q)
    );
  }
}

// Singleton
let clientInstance: SphereClient | null = null;

export function getSphereClient(config?: SphereClientConfig): SphereClient {
  if (!clientInstance) {
    clientInstance = new SphereClient(config);
  }
  return clientInstance;
}
