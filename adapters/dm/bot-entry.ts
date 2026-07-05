/**
 * adapters/dm/bot-entry.ts
 * 
 * Entry point for the direct-messaging (DM) version of ROOGLE.
 * 
 * Responsibilities:
 * - Connect to Sphere messaging (DMs)
 * - Listen for incoming user messages
 * - Call the orchestrator
 * - Send responses back
 */

// Core agent logic
import { handleUserMessage } from '../../src/agent/roogle';

// This adapter would connect to Sphere DMs and feed messages into handleUserMessage
// Example (future):
// sphereClient.onMessage(async (incoming) => {
//   const reply = await handleUserMessage({ role: 'user', content: incoming.text });
//   await sphereClient.sendMessage(incoming.from, reply.message);
// });


console.log('ROOGLE DM bot adapter placeholder loaded');
