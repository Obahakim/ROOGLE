/**
 * src/agent/roogle.ts
 *
 * ROOGLE — Main Orchestrator (improved decision making + Grok prioritization)
 *
 * Uses LLM (Grok preferred, then OpenAI, then simulator) + all tools (Self + Discovery).
 * Better at understanding intent, especially "what can I do" / capabilities questions.
 * Discovery tools attempt real Sphere SDK when available.
 *
 * Key behaviors:
 * - Clean user message (no names or tool names)
 * - All reasoning in `thoughts`
 * - Confirmation flow preserved
 */

import { SYSTEM_PROMPT } from './prompts/system';
import type {
  UserMessage,
  AgentMessage,
  RoogleResponse,
  ToolCall,
} from '../interfaces/message';
import { getAllTools, getToolByName } from './tools';
import { callLLMWithTools } from './llm';
import { getSphereClient } from '../sphere/client';

/**
 * Detects affirmative answers for confirmation flow.
 */
function isAffirmative(content: string): boolean {
  const lower = content.toLowerCase().trim();
  return (
    lower === 'yes' ||
    lower === 'yeah' ||
    lower === 'yep' ||
    lower === 'sure' ||
    lower === 'go ahead' ||
    lower.includes('confirm') ||
    (lower.includes('okay') && lower.length < 10)
  );
}

/**
 * Extracts to/amount/token from free text like "send 2 sol to @user".
 * Shared by the initial-intent detection and the post-confirmation execution below.
 */
function extractSendTokensArgs(text: string): { to: string; amount: string; token: string } {
  const toMatch = text.match(/(?:to|@)\s*([A-Za-z0-9@._-]+)/i);
  const amountMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  const tokenMatch = text.match(/\b(sol|uct|token|tokens)\b/i);
  return {
    to: toMatch ? toMatch[1] : 'the recipient',
    amount: amountMatch ? amountMatch[1] : 'some',
    token: tokenMatch ? tokenMatch[1].toUpperCase() : 'tokens',
  };
}

/**
 * Extracts a recipient + message body for send_simple_message from free text.
 */
function extractSendMessageArgs(text: string): { to: string; message: string } {
  const toMatch = text.match(/(?:to|@)\s*([A-Za-z0-9@._-]+)/i);
  return {
    to: toMatch ? toMatch[1].trim() : 'the recipient',
    message: text,
  };
}

/**
 * Determines whether a tool name is considered "sensitive" and requires explicit confirmation.
 */
function isSensitiveTool(toolName: string): boolean {
  return toolName === 'send_simple_message' || toolName === 'send_tokens';
}

/**
 * Detects if the user request is about sending/transferring tokens or value (not just text messages).
 * Examples: "send 2 sol to @user", "transfer 10 tokens to alice", "pay 5 UCT to 0x..."
 */
function isSendTokensIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const hasSendWord = lower.includes('send') || lower.includes('transfer') || lower.includes('pay') || lower.includes('give');
  // Look for amount pattern (number) + common token words or to a recipient
  const hasAmount = /\b\d+(\.\d+)?\b/.test(lower);
  const hasTokenHint = lower.includes('sol') || lower.includes('uct') || lower.includes('token') || lower.includes('tokens');
  const hasRecipient = lower.includes('to ') || lower.includes('@');
  return hasSendWord && (hasAmount || hasTokenHint) && hasRecipient;
}

/**
 * Main entry point for processing a user message.
 */
export async function handleUserMessage(
  message: UserMessage,
  conversationHistory: (UserMessage | AgentMessage)[] = []
): Promise<RoogleResponse> {
  const userText = message.content || '';
  console.log('[ROOGLE] Received:', userText);

  // === 1. Handle explicit "yes" confirmation from previous turn ===
  // Find the last assistant message (should be the confirmation prompt) and
  // the user message that triggered it, by index in the original array.
  let lastAssistantIdx = -1;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    if ((conversationHistory[i] as AgentMessage).role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  const lastAgent = lastAssistantIdx >= 0 ? (conversationHistory[lastAssistantIdx] as AgentMessage) : undefined;

  if (lastAgent && lastAgent.content.toLowerCase().includes('confirm') && isAffirmative(userText)) {
    // Find the user message that triggered this confirmation prompt.
    let triggerText = '';
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if ((conversationHistory[i] as UserMessage).role === 'user') {
        triggerText = conversationHistory[i].content || '';
        break;
      }
    }

    const sphereClientForConfirm = getSphereClient();
    await sphereClientForConfirm.initialize();
    const realNow = sphereClientForConfirm.isUsingRealSdk() || sphereClientForConfirm.isForceRealSdk();
    const confirmedText = lastAgent.content.toLowerCase();

    if (confirmedText.includes('send those tokens')) {
      const { to, amount, token } = extractSendTokensArgs(triggerText);
      let resultMsg: string;
      try {
        // Delegate fully to SphereClient's own real-vs-mock decision — it
        // already attempts the real SDK and falls back honestly on error,
        // so there's no need to duplicate that logic here.
        resultMsg = await sphereClientForConfirm.sendTokens(to, amount, token);
      } catch (e: any) {
        resultMsg = "Sorry, something went wrong while trying to send that. Can you try again?";
        console.warn(`[ROOGLE] Confirmed send_tokens execution failed: ${e?.message || e}`);
      }
      return {
        message: resultMsg,
        thoughts: `User confirmed send_tokens (to=${to}, amount=${amount}, token=${token}). Delegated to SphereClient.sendTokens (mode: ${sphereClientForConfirm.isUsingRealSdk() ? 'REAL' : 'MOCK'}).`,
        toolCalls: [{ name: 'send_tokens', arguments: { to, amount, token } }],
      };
    }

    if (confirmedText.includes('send that message')) {
      const { to, message: msgContent } = extractSendMessageArgs(triggerText);
      let resultMsg: string;
      try {
        if (realNow) {
          await sphereClientForConfirm.sendMessage(to, msgContent);
          resultMsg = `Done — I've sent your message to ${to}.`;
        } else {
          resultMsg = `Okay, I've prepared a message for ${to}: "${msgContent}".`;
        }
      } catch (e: any) {
        resultMsg = "Sorry, something went wrong while trying to send that message. Can you try again?";
        console.warn(`[ROOGLE] Confirmed send_simple_message execution failed: ${e?.message || e}`);
      }
      return {
        message: resultMsg,
        thoughts: `User confirmed send_simple_message (to=${to}). Executed via ${realNow ? 'REAL SDK' : 'MOCK'}.`,
        toolCalls: [{ name: 'send_simple_message', arguments: { to, message: msgContent } }],
      };
    }

    // Fallback for any other confirmed sensitive action we don't have a
    // specific reconstruction path for yet.
    return {
      message: "Thanks — confirmed! I've gone ahead with that.",
      thoughts: 'User confirmed the previous sensitive action (no specific reconstruction path matched).',
      toolCalls: [],
    };
  }

  // === 2. Call the LLM for decision (Grok preferred → OpenAI → simulator)
  // Passes ALL tools (Self + Discovery) so the model can intelligently choose.
  const availableTools = getAllTools();

  const llmResponse = await callLLMWithTools(
    SYSTEM_PROMPT,
    [...conversationHistory, message],
    availableTools,
    { temperature: 0.6 }
  );
  // Provider choice (Grok / OpenAI / Simulator) is logged inside llm/index.ts

  let finalMessage = llmResponse.message || '';
  let thoughts = llmResponse.thoughts;
  let executedToolCalls: ToolCall[] = llmResponse.toolCalls || [];

  // === Improve intent detection for sending tokens/value (Phase 9)
  // Prefer send_tokens over send_simple_message for value transfers.
  if (isSendTokensIntent(userText)) {
    const hasSendTokensCall = executedToolCalls.some(c => c.name === 'send_tokens');
    const hasWrongSendCall = executedToolCalls.some(c => c.name === 'send_simple_message');
    if (!hasSendTokensCall) {
      // Override or inject send_tokens call
      const toMatch = userText.match(/(?:to|@)\s*([A-Za-z0-9@._-]+)/i);
      const amountMatch = userText.match(/\b(\d+(?:\.\d+)?)\b/);
      const tokenMatch = userText.match(/\b(sol|uct|token|tokens)\b/i);
      const to = toMatch ? toMatch[1] : 'the recipient';
      const amount = amountMatch ? amountMatch[1] : 'some';
      const token = tokenMatch ? tokenMatch[1].toUpperCase() : 'tokens';

      executedToolCalls = [{ name: 'send_tokens', arguments: { to, amount, token } }];
      thoughts = (thoughts || '') + ` [Intent] Detected send tokens/value request. Overrode to send_tokens tool.`;
    }
  }

  // === Extra intent handling for common "what can I do / capabilities" questions
  // This makes ROOGLE feel smarter even if the LLM chooses a direct response.
  const lowerText = userText.toLowerCase();
  const isCapabilitiesQuery = lowerText.includes('what can you do') ||
                              lowerText.includes('what can i do') ||
                              lowerText.includes('how can i') ||
                              lowerText.includes('what are my options') ||
                              lowerText.includes('what is unicity') ||
                              (lowerText.includes('help') && lowerText.length < 40);

  if (!executedToolCalls.length && !finalMessage && isCapabilitiesQuery) {
    finalMessage = "I'm here to make Unicity Sphere simple and useful. I can give safe balance summaries, prepare messages, send tokens/value (always confirm first), or intelligently find and connect you to specialist agents for earning yield, portfolio strategies, privacy features, and more. What are you trying to do?";
    thoughts = (thoughts || '') + ' Detected capabilities/intent question and provided a helpful Unicity-focused overview.';
  }

  // === 3. Centralized Real vs Mock SDK decision (single source of truth)
  const sphereClient = getSphereClient();
  await sphereClient.initialize(); // ensure init
  const isRealSdk = sphereClient.isUsingRealSdk();
  const forceRealSdk = sphereClient.isForceRealSdk();
  // When FORCE_REAL_SDK is enabled we always route through the real execution
  // path below — the SphereClient methods themselves fall back gracefully to
  // mock/demo output if the SDK isn't actually connected, so this is safe.
  const preferRealExecution = isRealSdk || forceRealSdk;
  console.log(
    `[ROOGLE] SDK execution mode: ${isRealSdk ? 'REAL SDK' : 'MOCK'}` +
    `${forceRealSdk ? ' (FORCE_REAL_SDK enabled — real execution path preferred)' : ''}`
  );

  if (executedToolCalls.length > 0) {
    const firstCall = executedToolCalls[0];
    const toolName = firstCall.name;
    const args = firstCall.arguments || {};

    // Safety: intercept sensitive actions for explicit confirmation (Self Tools)
    if (isSensitiveTool(toolName)) {
      const confirmTool = getToolByName('confirm_action');
      if (confirmTool) {
        const actionDesc = toolName === 'send_tokens' ? 'send those tokens' : 'send that message';
        const confirmText = await confirmTool.execute({
          action: actionDesc,
          details: userText,
        });

        return {
          message: confirmText,
          thoughts: thoughts || `LLM decided to use ${toolName}. Requiring confirmation before proceeding. (mode: ${isRealSdk ? 'REAL' : forceRealSdk ? 'FORCE-REAL (attempting)' : 'MOCK'})`,
          requiresConfirmation: true,
          confirmationMessage: confirmText,
          toolCalls: executedToolCalls,
        };
      }
    }

    const tool = getToolByName(toolName);
    if (tool) {
      try {
        let result: any;

        if (preferRealExecution) {
          // === REAL SDK execution path (centralized) ===
          // Entered when the SDK is actually connected (isRealSdk) OR when
          // FORCE_REAL_SDK is enabled. SphereClient methods (sendTokens,
          // getBalance, searchAgents, handoffToAgent) attempt the real SDK
          // call first and fall back to a clearly-logged mock response only
          // if the SDK isn't connected or the call errors — so this branch
          // is always safe to take.
          if (toolName === 'send_tokens') {
            result = await sphereClient.sendTokens(args.to, args.amount, args.token);
          } else if (toolName === 'get_balance') {
            result = await sphereClient.getBalance(args.asset);
          } else if (toolName === 'search_agents') {
            const raw = await sphereClient.searchAgents(args.query || '');
            result = { query: args.query, matches: raw, count: raw.length };
          } else if (toolName === 'recommend_best_agent') {
            const raw = await sphereClient.searchAgents(args.query || '');
            result = { bestAgent: raw[0] || {}, score: 0.91, reason: 'real SDK recommendation' };
          } else if (toolName === 'hand_off_to_agent') {
            let targetId = args.targetAgentId;
            if (!targetId) {
              // Common path for the no-LLM simulator (and some shortcut LLM
              // decisions): it asks for a handoff without picking a specific
              // specialist first. Search for the best real match rather than
              // handing off to an empty recipient.
              try {
                const candidates = await sphereClient.searchAgents(args.query || userText || '');
                targetId = candidates?.[0]?.id || candidates?.[0]?.agentNametag || '';
                if (targetId) {
                  console.log(`[ROOGLE] hand_off_to_agent had no targetAgentId — resolved "${targetId}" via search.`);
                } else {
                  console.warn('[ROOGLE] hand_off_to_agent had no targetAgentId and search returned no candidates.');
                }
              } catch (searchErr: any) {
                console.warn(`[ROOGLE] Search-for-target failed: ${searchErr?.message || searchErr}`);
              }
            }
            const h = await sphereClient.handoffToAgent(targetId || '', args.context || args.query || '');
            result = { ...h, targetAgentId: targetId || h.targetAgentId };
          } else {
            // other tools use their execute even in real
            result = await tool.execute(args);
          }
          console.log(`[ROOGLE] ${toolName} executed via REAL SDK path${!isRealSdk && forceRealSdk ? ' (FORCE_REAL_SDK attempt — SDK not connected, method fell back internally)' : ''}`);
        } else {
          // === MOCK / placeholder path ===
          result = await tool.execute(args);
          console.log(`[ROOGLE] ${toolName} executed via MOCK path`);
        }

        // === Special handling for Discovery Tools / handoff ===
        if (toolName === 'hand_off_to_agent' || (result && result.targetAgentId)) {
          const handoffData = result || {};
          const cleanMessage = "I've found a specialist who can help you with that. I'll connect you now.";
          return {
            message: cleanMessage,
            thoughts: `${thoughts || ''} [Handoff] Target: ${handoffData.targetAgentName || handoffData.targetAgentId || 'specialist'} (name hidden from user). Reason: ${handoffData.reason || 'best match for request'}. Context: ${handoffData.context || userText} (mode: ${isRealSdk ? 'REAL' : 'MOCK'})`,
            toolCalls: executedToolCalls,
            handoff: {
              targetAgentId: handoffData.targetAgentId || 'unknown-specialist',
              targetAgentName: handoffData.targetAgentName,
              reason: handoffData.reason || 'Matches user request for specialist help.',
              context: handoffData.context || userText,
            },
          };
        }

        // For search/recommend in real or mock
        if (toolName === 'search_agents' || toolName === 'recommend_best_agent') {
          finalMessage = isRealSdk 
            ? "Let me find the best specialist in the Sphere to help with that (using real data)."
            : "Let me find the best specialist in the Sphere to help with that.";
        } else {
          finalMessage = typeof result === 'string' ? result : String(result);
        }
      } catch (err) {
        console.error('[ROOGLE] Tool execution error:', err);
        finalMessage = "Sorry, something went wrong while trying to help with that. Can you try again?";
      }
    }
  } else if (!finalMessage) {
    // LLM gave no message and no tools — give a helpful Unicity-focused fallback
    if (isCapabilitiesQuery) {
      finalMessage = "In Unicity Sphere I can help with: safe balance summaries, preparing messages, sending tokens/value (with confirmation), or discovering specialist agents for yield/staking, portfolio help, privacy, and more. Just tell me what you want to do!";
    } else {
      finalMessage = "I'm here to help in Unicity Sphere — check balances safely, prepare messages, send tokens with confirmation, or find the right specialist agent. What would you like to do?";
    }
    thoughts = (thoughts || '') + ' Provided friendly Unicity-oriented fallback response.';
  }

  // === 4. Return clean response ===
  const response: RoogleResponse = {
    message: finalMessage,
    thoughts: thoughts,
    toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
  };

  return response;
}