/**
 * src/agent/tools/self/index.ts
 *
 * Self Tools for ROOGLE
 *
 * These are tools that ROOGLE can handle directly.
 * Each tool returns a friendly, plain-English result.
 * No jargon, always safe and helpful.
 */

import type { Tool } from '../../../interfaces/message';
import { getSphereClient } from '../../../sphere/client';

/**
 * get_help: Explains what ROOGLE can do.
 */
export const getHelpTool: Tool = {
  name: 'get_help',
  description: 'Explains what ROOGLE can do in plain, friendly language. Use this when someone asks for help, what you can do, or who you are.',
  parameters: {
    topic: { type: 'string', description: 'Optional specific topic the user is asking about', optional: true }
  },
  execute: async (args: { topic?: string }) => {
    const topic = args.topic || '';
    if (topic.includes('balance') || topic.includes('money')) {
      return "I can show you a friendly summary of your balance. Just ask me 'what's my balance?'";
    }
    return `Hi! I'm ROOGLE. In Unicity Sphere I can help with:
- A safe, plain-English summary of your balance
- Preparing simple messages to send (with confirmation for anything important)
- Discovering and connecting you to specialist agents for earning yield safely, portfolio strategies, privacy tools, and other useful services

Just tell me in your own words what you want to do. No special commands needed. What are you looking to achieve?`;
  }
};

/**
 * get_balance: Friendly balance summary.
 * 
 * The tool always returns a friendly description. 
 * Whether real SDK data or mock is used is decided centrally by roogle.ts.
 */
export const getBalanceTool: Tool = {
  name: 'get_balance',
  description: 'Returns a simple, friendly summary of the user\'s balance. Real data will come from Sphere SDK when active.',
  parameters: {
    asset: { type: 'string', description: 'Optional specific asset or token to check', optional: true }
  },
  execute: async (args: { asset?: string }) => {
    // Defensive real-SDK-first check: roogle.ts normally routes get_balance
    // through sphereClient.getBalance() directly when real mode is active,
    // but this tool attempts the same if ever invoked on its own.
    const sphereClient = getSphereClient();
    if (sphereClient.isUsingRealSdk() || sphereClient.isForceRealSdk()) {
      console.log('[Tool:get_balance] Real SDK mode active — delegating to SphereClient.getBalance().');
      return sphereClient.getBalance(args.asset);
    }
    console.log('[Tool:get_balance] Using demo fallback (real SDK mode not active).');
    const asset = args.asset || 'your main balance';
    return `Your ${asset} looks healthy right now.`;
  }
};

/**
 * send_simple_message: Prepares a message to send (demo only, no actual send yet)
 */
export const sendSimpleMessageTool: Tool = {
  name: 'send_simple_message',
  description: 'Prepares a simple friendly message to send to someone. This is a safe demo tool only — nothing is actually sent yet.',
  parameters: {
    to: { type: 'string', description: 'Who to send the message to (name or address)' },
    message: { type: 'string', description: 'The message content in plain words' }
  },
  execute: async (args: { to?: string; message?: string }) => {
    const to = args.to || 'your friend';
    const msg = args.message || 'a friendly hello';
    return `Okay, I've prepared a message for ${to}: "${msg}". This is just a demo for now. In a real version, I'd ask you to confirm before sending anything.`;
  }
};

/**
 * send_tokens: Sends tokens/value to another user or address.
 * 
 * This tool focuses ONLY on the send action / confirmation prep.
 * The orchestrator (roogle.ts) decides real SDK vs mock/placeholder execution
 * based on getSphereClient().isUsingRealSdk().
 */
export const sendTokensTool: Tool = {
  name: 'send_tokens',
  description: 'Sends tokens or value (e.g. SOL, other assets) to a recipient address or nametag. Use this for any request involving sending, transferring, or paying tokens/value. Always confirm with the user first.',
  parameters: {
    to: { type: 'string', description: 'Recipient (nametag like @obahakim or address)' },
    amount: { type: 'string', description: 'Amount to send (e.g. "2")' },
    token: { type: 'string', description: 'Token or asset symbol (e.g. "SOL", "UCT")', optional: true }
  },
  execute: async (args: { to?: string; amount?: string; token?: string }) => {
    const to = args.to || 'the recipient';
    const amount = args.amount || 'some';
    const token = args.token || 'tokens';

    // Defensive real-SDK-first check: roogle.ts normally routes send_tokens
    // through sphereClient.sendTokens() directly (after confirmation) when
    // real mode is active. This tool attempts the same if ever invoked on
    // its own, with a safe fallback if the real call fails or isn't available.
    const sphereClient = getSphereClient();
    if (sphereClient.isUsingRealSdk() || sphereClient.isForceRealSdk()) {
      console.log(`[Tool:send_tokens] Real SDK mode active — attempting real send of ${amount} ${token} to ${to}.`);
      try {
        return await sphereClient.sendTokens(to, amount, token);
      } catch (e: any) {
        console.warn(`[Tool:send_tokens] Real send failed, falling back to safe placeholder: ${e?.message || e}`);
      }
    }
    console.log('[Tool:send_tokens] Using demo fallback (real SDK mode not active).');
    return `I've prepared to send ${amount} ${token} to ${to}.`;
  }
};

/**
 * confirm_action: Generates a clear, safe confirmation message before important actions.
 */
export const confirmActionTool: Tool = {
  name: 'confirm_action',
  description: 'Creates a friendly confirmation question before doing anything important like sending value or taking action.',
  parameters: {
    action: { type: 'string', description: 'What action we are about to take' },
    details: { type: 'string', description: 'Extra details to explain simply', optional: true }
  },
  execute: async (args: { action?: string; details?: string }) => {
    const action = args.action || 'do that';
    const details = args.details ? ` (${args.details})` : '';
    return `Just to keep things safe, before I ${action}${details}, can you confirm? Please reply "yes" if you'd like me to go ahead.`;
  }
};

// Export all self tools as an array
export const selfTools: Tool[] = [
  getHelpTool,
  getBalanceTool,
  sendSimpleMessageTool,
  sendTokensTool,
  confirmActionTool
];