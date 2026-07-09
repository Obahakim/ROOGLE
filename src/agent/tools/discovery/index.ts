/**
 * src/agent/tools/discovery/index.ts
 *
 * Discovery Tools for ROOGLE
 *
 * Tools delegate to SphereClient. The decision to use real SDK vs mock
 * is centralized in roogle.ts via getSphereClient().isUsingRealSdk().
 * No per-tool real/mock branching here.
 *
 * User NEVER sees raw agent names/IDs in the final message; only in thoughts.
 */

import type { Tool } from '../../../interfaces/message';
import { getSphereClient } from '../../../sphere/client';

// ============================================
// (Minimal) local fallback mock data if SDK completely unavailable
// ============================================

const FALLBACK_SPECIALISTS = [
  {
    id: 'yield-finder-001',
    name: 'SafeYield Agent',
    description: 'Specializes in finding safe, low-risk yield and staking opportunities for tokens in the Unicity ecosystem.',
    specialties: ['yield', 'earn', 'staking', 'safe investment', 'tokens'],
  },
  {
    id: 'portfolio-guard-002',
    name: 'Portfolio Protector',
    description: 'Helps users manage, grow, and protect their token holdings with personalized strategies.',
    specialties: ['portfolio', 'manage', 'balance', 'growth'],
  },
];

function mapToAgentShape(raw: any) {
  // Normalize whatever the real SDK or mock returns into the shape the orchestrator expects.
  // Real SDK results (SearchIntentResult) use `agentNametag`, not `posterNametag`/`nametag`.
  return {
    id: raw.id || raw.intentId || raw.targetAgentId || 'unknown',
    name: raw.name || raw.agentNametag || raw.posterNametag || raw.nametag || raw.id || 'Specialist',
    description: raw.description || raw.message || raw.content || 'Sphere specialist agent',
  };
}

// ============================================
// search_agents
// ============================================

export const searchAgentsTool: Tool = {
  name: 'search_agents',
  description: 'Search for specialist agents in the Unicity Sphere ecosystem that match the user\'s request. (Mock data unless orchestrator routes to real SDK.)',
  parameters: {
    query: { type: 'string', description: 'The user request in plain everyday language' },
  },
  execute: async (args: { query?: string }) => {
    const query = args.query || '';

    // Defensive real-SDK-first check: roogle.ts normally routes search_agents
    // through sphereClient.searchAgents() directly when real mode is active.
    // This tool attempts the same if ever invoked on its own, falling back
    // to the local mock list below if the SDK isn't available or errors.
    const sphereClient = getSphereClient();
    if (sphereClient.isUsingRealSdk() || sphereClient.isForceRealSdk()) {
      try {
        console.log(`[Tool:search_agents] Real SDK mode active — attempting real search for "${query}".`);
        const raw = await sphereClient.searchAgents(query);
        if (raw && raw.length > 0) {
          const matches = raw.map(mapToAgentShape);
          return { query, matches, count: matches.length };
        }
      } catch (e: any) {
        console.warn(`[Tool:search_agents] Real search failed, falling back to local mock: ${e?.message || e}`);
      }
    }
    console.log('[Tool:search_agents] Using local demo fallback data.');

    // Pure mock implementation. Real path is handled centrally in roogle.ts
    const matches = FALLBACK_SPECIALISTS
      .filter((agent) =>
        agent.specialties.some((spec) => query.toLowerCase().includes(spec)) ||
        agent.description.toLowerCase().includes(query.toLowerCase().slice(0, 30))
      )
      .map(mapToAgentShape);

    return {
      query,
      matches: matches.length > 0 ? matches : FALLBACK_SPECIALISTS.slice(0, 2).map(mapToAgentShape),
      count: matches.length || 2,
    };
  },
};

// ============================================
// recommend_best_agent
// ============================================

export const recommendBestAgentTool: Tool = {
  name: 'recommend_best_agent',
  description: 'Score search results (or mock) and recommend the best specialist agent. (Mock unless routed to real SDK by orchestrator.)',
  parameters: {
    query: { type: 'string', description: 'User request or context' },
  },
  execute: async (args: { query?: string }) => {
    const query = args.query || '';
    // Pure mock. Central decision in roogle.ts
    const candidates = FALLBACK_SPECIALISTS
      .filter((agent) =>
        agent.specialties.some((spec) => query.toLowerCase().includes(spec))
      )
      .map(mapToAgentShape);

    const best = candidates[0] || mapToAgentShape(FALLBACK_SPECIALISTS[0]);

    return {
      bestAgent: best,
      score: 0.91,
      reason: `Best mock match for "${query}".`,
    };
  },
};

// ============================================
// hand_off_to_agent
// ============================================

export const handOffToAgentTool: Tool = {
  name: 'hand_off_to_agent',
  description: 'Prepare handoff payload for the chosen specialist. (Mock data; real handoff decided centrally in roogle.ts when SDK is active.)',
  parameters: {
    targetAgentId: { type: 'string', description: 'Specialist ID/nametag' },
    query: { type: 'string', description: 'Original request' },
    reason: { type: 'string', description: 'Selection reason' },
    context: { type: 'string', description: 'Handoff context' },
  },
  execute: async (args: { targetAgentId?: string; query?: string; reason?: string; context?: string }) => {
    // Pure mock implementation. Orchestrator decides real path.
    const targetId = args.targetAgentId || 'yield-finder-001';
    const context = args.context || args.query || 'User requested specialist help.';
    const reasonText = args.reason || `Specialist selected for: ${args.query || 'request'}`;

    return {
      targetAgentId: targetId,
      targetAgentName: 'MockSpecialist',
      reason: reasonText,
      context,
      success: true,
    };
  },
};

// Export as array for registration
export const discoveryTools: Tool[] = [
  searchAgentsTool,
  recommendBestAgentTool,
  handOffToAgentTool,
];