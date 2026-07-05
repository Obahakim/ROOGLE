/**
 * src/agent/tools/index.ts
 *
 * Tool Registry for ROOGLE
 *
 * This is the central place where we register all tools that ROOGLE can use.
 * Tools are grouped into two categories:
 *
 * - Self Tools: ROOGLE can perform these directly (simple actions, answers, utilities)
 * - Discovery Tools: Help ROOGLE find and connect to the best specialist agents
 *
 * The orchestrator (roogle.ts) will use this registry to decide what to call.
 */

import type { Tool } from '../../interfaces/message';
import { selfTools as importedSelfTools } from './self';
import { discoveryTools as importedDiscoveryTools } from './discovery';

// ============================================
// SELF TOOLS
// ============================================
// These are tools ROOGLE can execute itself without routing to another agent.
// Includes: get_help, get_balance, send_simple_message, send_tokens (for value transfers), confirm_action.

export const selfTools: Tool[] = importedSelfTools;

// ============================================
// DISCOVERY TOOLS
// ============================================
// These tools let ROOGLE search the Sphere ecosystem and hand off intelligently.

export const discoveryTools: Tool[] = importedDiscoveryTools;

// ============================================
// REGISTRY HELPERS
// ============================================

export function getAllTools(): Tool[] {
  return [...selfTools, ...discoveryTools];
}

export function getSelfTools(): Tool[] {
  return selfTools;
}

export function getDiscoveryTools(): Tool[] {
  return discoveryTools;
}

/**
 * Look up a tool by name (used by the orchestrator when the LLM requests a tool call).
 */
export function getToolByName(name: string): Tool | undefined {
  return getAllTools().find((tool) => tool.name === name);
}
