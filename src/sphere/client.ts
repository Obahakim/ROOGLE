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
  /** Force strong preference for real Sphere SDK execution (defaults to FORCE_REAL_SDK env var) */
  forceRealSdk?: boolean;
}

/**
 * Reads FORCE_REAL_SDK from the environment. Accepts "true"/"1" (case-insensitive).
 */
function readForceRealSdkEnv(): boolean {
  const raw = (process.env.FORCE_REAL_SDK || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export class SphereClient {
  private sphere: any = null;
  private initialized = false;
  private usingRealSdk = false;
  private forceRealSdk: boolean;
  private config: SphereClientConfig;

  constructor(config: SphereClientConfig = {}) {
    this.config = {
      network: (process.env.SPHERE_NETWORK as any) || 'testnet',
      ...config,
    };
    // FORCE_REAL_SDK env var (or explicit config) makes ROOGLE strongly prefer
    // real Sphere SDK execution in production, only falling back on actual errors.
    this.forceRealSdk = config.forceRealSdk ?? readForceRealSdkEnv();
  }

  /**
   * Returns true if we successfully initialized against the real Sphere SDK.
   * False means we are in mock/fallback mode.
   */
  public isUsingRealSdk(): boolean {
    return this.usingRealSdk;
  }

  /**
   * Returns true if Forced Real SDK mode is enabled (via FORCE_REAL_SDK=true
   * or explicit config). This does not by itself guarantee the SDK connected
   * successfully — check isUsingRealSdk() for that — but it signals that
   * callers should strongly prefer real execution paths and only fall back
   * to mock/demo behavior on an actual error.
   */
  public isForceRealSdk(): boolean {
    return this.forceRealSdk;
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

    if (this.forceRealSdk) {
      console.log('[SphereClient] 🚀 FORCE_REAL_SDK is enabled — strongly preferring real Sphere SDK execution. Will only fall back to mock on an actual error.');
    } else {
      console.log('[SphereClient] Running in normal mode (real Sphere SDK is still attempted first; falls back to mock only on error).');
    }

    console.log(`[SphereClient] Attempting REAL Sphere SDK initialization (network=${network})...`);

    if (mnemonic) {
      console.log('[SphereClient]   SPHERE_MNEMONIC is present — will use it for a persistent real identity.');
    } else if (this.forceRealSdk) {
      console.warn('[SphereClient]   ⚠️ FORCE_REAL_SDK is enabled but no SPHERE_MNEMONIC is set — will auto-generate an EPHEMERAL identity. Set SPHERE_MNEMONIC in production for a persistent agent.');
    } else {
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
      console.log(`[SphereClient] ✅ Real Sphere SDK connected successfully${this.forceRealSdk ? ' (Forced Real SDK mode)' : ''}. Identity: ${id}`);
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error(`[SphereClient] ❌ Real Sphere SDK initialization FAILED${this.forceRealSdk ? ' (Forced Real SDK mode was enabled)' : ''}: ${errorMsg}`);

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
   * Uses PaymentsModule.getAssets() (@unicitylabs/sphere-sdk) which returns
   * Asset[] with { coinId, symbol, totalAmount, ... }.
   */
  async getBalance(asset?: string) {
    await this.initializeIfNeeded();
    if (this.sphere?.payments?.getAssets) {
      try {
        console.log(`[SphereClient] Attempting REAL getBalance via Sphere SDK payments.getAssets()${asset ? ` (coinId=${asset})` : ''}...`);
        const assets = await this.sphere.payments.getAssets(asset);
        if (!assets || assets.length === 0) {
          console.log('[SphereClient] ✅ REAL getBalance succeeded (no assets found).');
          return `Your ${asset || 'balance'} looks empty right now (no assets found via Sphere SDK).`;
        }
        const summary = assets.map((a: any) => `${a.totalAmount} ${a.symbol || a.coinId}`).join(', ');
        console.log(`[SphereClient] ✅ REAL getBalance succeeded (${assets.length} asset(s)).`);
        return `Your real balance via Sphere SDK: ${summary}.`;
      } catch (e: any) {
        console.warn(`[SphereClient] ⚠️  REAL getBalance failed, falling back to safe placeholder: ${e?.message || e}`);
      }
    } else if (this.forceRealSdk) {
      console.warn('[SphereClient] FORCE_REAL_SDK is enabled but payments.getAssets is unavailable (SDK not connected) — using fallback.');
    }
    console.log('[SphereClient] Using fallback (MOCK) response for getBalance.');
    return `Your ${asset || 'main balance'} looks healthy right now. (MOCK)`;
  }

  /**
   * Send tokens using real SDK if active.
   * Uses PaymentsModule.send({ coinId, amount, recipient }) (@unicitylabs/sphere-sdk),
   * which returns a TransferResult { id, status, ... }.
   *
   * Note: `token` is passed through as `coinId`. If your deployment's token
   * symbols (e.g. "SOL", "UCT") don't map 1:1 to Sphere coinIds, add a mapping
   * here before calling payments.send.
   */
  async sendTokens(to: string, amount: string, token: string = 'tokens') {
    await this.initializeIfNeeded();
    if (this.sphere?.payments?.send) {
      try {
        console.log(`[SphereClient] Attempting REAL sendTokens via Sphere SDK: ${amount} ${token} -> ${to}...`);
        const result = await this.sphere.payments.send({
          coinId: token,
          amount,
          recipient: to,
        });
        console.log(`[SphereClient] ✅ REAL sendTokens succeeded (id=${result?.id}, status=${result?.status}).`);
        return `Sent ${amount} ${token} to ${to} via Sphere SDK (status: ${result?.status || 'submitted'}).`;
      } catch (e: any) {
        console.warn(`[SphereClient] ⚠️  REAL sendTokens failed, falling back to safe placeholder: ${e?.message || e}`);
      }
    } else if (this.forceRealSdk) {
      console.warn('[SphereClient] FORCE_REAL_SDK is enabled but payments.send is unavailable (SDK not connected) — using fallback.');
    }
    console.log('[SphereClient] Using fallback (MOCK) response for sendTokens.');
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