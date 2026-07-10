/**
 * src/agent/llm/index.ts
 *
 * LLM Abstraction Layer with Tool Calling Support (improved provider selection)
 *
 * Priority order (clearly logged):
 * 1. Grok (xAI) if GROK_API_KEY is set
 * 2. OpenAI if OPENAI_API_KEY is set (legacy support)
 * 3. High-quality local simulator (always available fallback)
 *
 * Always returns:
 *   - message: clean user-facing text (no tool names)
 *   - thoughts?: internal reasoning (only for debug/expandable)
 *   - toolCalls?: actions decided by the LLM
 */

import type { Tool } from '../../interfaces/message';
import type { UserMessage, AgentMessage } from '../../interfaces/message';
import { extractSendTokensArgs, extractSendMessageArgs } from '../extraction';

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  message: string;
  thoughts?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>;
}

/**
 * Converts our internal Tool definitions into a format suitable for LLM tool calling (OpenAI style).
 */
export function convertToolsToLLMFormat(tools: Tool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters || {},
        // For simplicity in Phase 3 we accept loose parameters
      },
    },
  }));
}

/**
 * Main function for tool-calling enabled LLM calls.
 * Priority: Grok (if GROK_API_KEY) > OpenAI (if OPENAI_API_KEY) > Simulator (fallback)
 */
export async function callLLMWithTools(
  systemPrompt: string,
  messages: Array<UserMessage | AgentMessage>,
  availableTools: Tool[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const grokKey = process.env.GROK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const llmTools = convertToolsToLLMFormat(availableTools);

  // Prioritize Grok
  if (grokKey) {
    console.log('[LLM] Using Grok API (xAI)');
    try {
      return await callRealGrok(systemPrompt, messages, llmTools, grokKey, options);
    } catch (err) {
      console.warn('[LLM] Grok API call failed, attempting OpenAI fallback:', err);
      // fall through to OpenAI if available
    }
  }

  // Then OpenAI (legacy / alternative)
  if (openaiKey) {
    console.log('[LLM] Using OpenAI API');
    try {
      return await callRealOpenAI(systemPrompt, messages, llmTools, openaiKey, options);
    } catch (err) {
      console.warn('[LLM] OpenAI API call failed, falling back to simulator:', err);
    }
  }

  // High-quality simulator fallback
  console.log('[LLM] Using local simulator (no API key or all providers failed)');
  return simulateToolCalling(systemPrompt, messages, availableTools);
}

/**
 * Real Grok API tool calling implementation (xAI endpoint - OpenAI compatible format).
 */
async function callRealGrok(
  systemPrompt: string,
  messages: Array<UserMessage | AgentMessage>,
  tools: any[],
  apiKey: string,
  options: LLMOptions
): Promise<LLMResponse> {
  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
  ];

  const model = process.env.GROK_MODEL || 'grok-3';

  const body = {
    model,
    messages: formattedMessages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 600,
  };

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message;

  const toolCalls = (choice?.tool_calls || []).map((tc: any) => ({
    name: tc.function.name,
    arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
  }));

  // For real calls, if the model also returned content we can treat it as thoughts or message.
  // Following rules: if there are tool calls, the final message will be produced after execution in the orchestrator.
  // Reasoning captured in thoughts.
  const content = choice?.content || '';

  return {
    message: toolCalls.length > 0 ? '' : content, // final message only if no tools
    thoughts: content || 'LLM (Grok) used tool calling. Reasoning captured in tool selection.',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * Real OpenAI tool calling implementation (fallback / legacy support).
 */
async function callRealOpenAI(
  systemPrompt: string,
  messages: Array<UserMessage | AgentMessage>,
  tools: any[],
  apiKey: string,
  options: LLMOptions
): Promise<LLMResponse> {
  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
  ];

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: formattedMessages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 600,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message;

  const toolCalls = (choice?.tool_calls || []).map((tc: any) => ({
    name: tc.function.name,
    arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
  }));

  const content = choice?.content || '';

  return {
    message: toolCalls.length > 0 ? '' : content,
    thoughts: content || 'LLM (OpenAI) used tool calling. Reasoning captured in tool selection.',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * Local simulator that behaves like a tool-calling LLM (Grok-style decisions).
 * It produces:
 *   - clean `message` (never leaks tool names)
 *   - rich `thoughts` (internal reasoning - only shown in debug)
 *   - proper `toolCalls` when action is needed (Self Tools or Discovery Tools)
 */
function simulateToolCalling(
  systemPrompt: string,
  messages: Array<UserMessage | AgentMessage>,
  availableTools: Tool[]
): LLMResponse {
  // Get the latest user message
  const latestUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const lower = latestUserMsg.toLowerCase().trim();

  const toolsByName = new Map(availableTools.map((t) => [t.name, t]));

  // === Decision logic (mimics what a good LLM would do with the system prompt) ===
  // Now considers both Self Tools and Discovery Tools for specialist handoff.
  let chosenToolName: string | null = null;
  let args: Record<string, any> = {};
  let thoughts = 'I reviewed the user\'s request against my available Self Tools and Discovery Tools. ';

  if (lower.includes('balance') || lower.includes('how much') || lower.includes('money i have') || lower.includes('funds')) {
    chosenToolName = 'get_balance';
    args = { asset: 'main balance' };
    thoughts += 'The user is asking about their balance or money. The get_balance tool is the best direct match to give a friendly, simple answer.';
  } 
  else if (lower.includes('yield') || lower.includes('earn') || lower.includes('invest') || lower.includes('staking') || (lower.includes('safe') && lower.includes('token'))) {
    // Discovery / routing case for Phase 4 — must come before generic "help"
    chosenToolName = 'hand_off_to_agent';
    args = {
      query: latestUserMsg,
      reason: 'User is asking for safe yield/earning opportunities on tokens.',
      context: latestUserMsg
    };
    thoughts += 'This request is about earning yield safely on tokens. This is best handled by a specialist agent in the Unicity Sphere ecosystem rather than my basic Self Tools. I will use the discovery tools (search_agents / recommend_best_agent / hand_off_to_agent) to find the right match and prepare the handoff. The user will only see a clean friendly message.';
  } 
  else if (
    lower.includes('help') ||
    lower.includes('what can you do') ||
    lower.includes('who are you') ||
    lower.includes('how do you work') ||
    lower.includes('tell me about') ||
    lower.includes('what you are') ||
    lower.includes('about yourself')
  ) {
    chosenToolName = 'get_help';
    thoughts += 'User wants an explanation of my capabilities. get_help will provide a clear, plain-English overview.';
  } 
  else if ((lower.includes('send') || lower.includes('message to') || lower.includes('tell ') || lower.includes('say to')) && !lower.includes('tell me about')) {
    // Detect value transfer vs text message
    const hasAmount = /\b\d+(?:\.\d+)?\b/.test(lower);
    const hasToken = /\b(sol|uct|token|tokens)\b/i.test(lower);

    if (hasAmount || hasToken) {
      // This is sending tokens/value, not a text message
      const { to, amount, token } = extractSendTokensArgs(latestUserMsg);
      chosenToolName = 'send_tokens';
      args = { to, amount, token };
      thoughts += 'Detected request to send tokens/value (amount/token/recipient). Using send_tokens tool (not send_simple_message). Will confirm before action.';
    } else {
      const { to, message } = extractSendMessageArgs(latestUserMsg);
      chosenToolName = 'send_simple_message';
      args = { to, message };
      thoughts += 'This appears to be a request to prepare a message for someone. I will use send_simple_message to prepare it safely. I will make sure confirmation happens for any value-related action.';
    }
  } 
  else if (lower.includes('confirm') || lower.includes('yes')) {
    // Let confirmation flow be handled in orchestrator
    thoughts += 'This looks like a confirmation response. No new tool needed right now.';
  } 
  else {
    // Direct friendly response — be helpful about Unicity Sphere
    thoughts += 'No specific tool matched strongly. I will give a friendly, relevant overview of what is possible in Unicity Sphere and invite the user to share their goal.';
    return {
      message: "I'm here to help in Unicity Sphere! I can give you a safe balance summary, prepare simple messages, or discover and connect you to the right specialist agent for things like earning yield safely on tokens, portfolio management, or privacy features. Just tell me what you're trying to do.",
      thoughts,
      toolCalls: undefined,
    };
  }

  if (chosenToolName && toolsByName.has(chosenToolName)) {
    return {
      message: '', // message will come from executing the tool result (keeps it clean)
      thoughts,
      toolCalls: [
        {
          name: chosenToolName,
          arguments: args,
        },
      ],
    };
  }

  // Fallback direct
  return {
    message: "I'm here to make Unicity Sphere easy for you — whether that's checking your balance safely, preparing a message, or finding a specialist agent for yield, portfolio help, or other features. What would you like to do?",
    thoughts,
    toolCalls: undefined,
  };
}