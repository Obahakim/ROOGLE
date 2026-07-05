/**
 * scripts/test-conversation.ts
 *
 * Phase 6 test script for ROOGLE with Grok + improved real Sphere SDK integration.
 *
 * === How to enable REAL Sphere SDK mode ===
 * 1. cp .env.example .env
 * 2. Edit .env and set at minimum:
 *      SPHERE_NETWORK=testnet
 *      SPHERE_MNEMONIC=your twelve-word mnemonic   (for persistent real identity)
 *    Optional but recommended:
 *      SPHERE_DATA_DIR, SPHERE_TOKENS_DIR, SPHERE_ORACLE_API_KEY (public testnet key is safe)
 * 3. Run this script again.
 *
 * Without a valid SPHERE_MNEMONIC the client will fall back to mock data.
 * The client logs clearly whether "REAL" or "MOCK" mode is active.
 *
 * Run:
 *   npx tsx scripts/test-conversation.ts
 *
 * Shows:
 *   - Clean user-facing message
 *   - Thoughts (may contain attempted real SDK results or fallback)
 *   - handoff populated when discovery succeeds
 */

import { handleUserMessage } from '../src/agent/roogle';
import type { UserMessage } from '../src/interfaces/message';
import { getSphereClient } from '../src/sphere/client';

async function runTest() {
  // Initialize early so we can report the mode
  const sphereClient = getSphereClient();
  await sphereClient.initialize();

  const mode = sphereClient.isUsingRealSdk() ? 'REAL Sphere SDK' : 'MOCK FALLBACK';
  console.log(`=== ROOGLE Conversation Test (Phase 6 - Grok + Sphere) ===`);
  console.log(`Sphere mode active: ${mode}\n`);

  let history: any[] = [];

  const messages = [
    "Hi there!",
    "What can you do?",
    "What's my balance?",
    "Can you send a hello message to my friend Alex?",
    "yes",
    "How much money do I have?",
    "Tell me about yourself again",
    "Can you help me understand what you are?",
    "Help me earn yield on my tokens safely"
  ];

  for (const text of messages) {
    const userMsg: UserMessage = {
      role: 'user',
      content: text,
    };

    console.log(`User: ${text}`);

    const response = await handleUserMessage(userMsg, history);

    // === Main clean response (what the user sees) ===
    console.log(`ROOGLE: ${response.message}`);

    // === Thoughts shown separately (debug / expandable) ===
    if (response.thoughts) {
      console.log(`   [Thoughts]: ${response.thoughts}`);
    }

    // Internal tool info (for developers)
    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(`   [Internal Tool Calls]: ${response.toolCalls.map((t) => t.name).join(', ')}`);
    }

    // Handoff info (specialist details are only in thoughts for user)
    if (response.handoff) {
      console.log(`   [Handoff]: targetId=${response.handoff.targetAgentId}`);
      if (response.handoff.targetAgentName) {
        console.log(`   [Handoff Internal Name]: ${response.handoff.targetAgentName} (never shown to user)`);
      }
    }

    if (response.requiresConfirmation) {
      console.log('   (waiting for confirmation...)');
    }

    console.log('');

    // Update history (only the visible message for the conversation context)
    history.push(userMsg);
    history.push({ role: 'assistant', content: response.message });
  }

  console.log('=== Test complete ===');
}

runTest().catch(console.error);
