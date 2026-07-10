/**
 * src/agent/extraction.ts
 *
 * Shared, single-source-of-truth helpers for pulling send_tokens /
 * send_simple_message arguments out of free user text. Used by BOTH the
 * local simulator (llm/index.ts) and the orchestrator (roogle.ts) so there
 * is exactly one regex to fix when it's wrong, instead of three separate
 * (and previously inconsistent) copies.
 *
 * Missing values are returned as `null` — not a placeholder string like
 * "the recipient" or "some" — so callers can explicitly detect an
 * incomplete request and ask a clarifying question, instead of silently
 * proceeding with a placeholder that the real SDK will reject anyway
 * (e.g. parseTokenAmount("some", ...) throwing "Invalid amount").
 */

export interface SendTokensArgs {
  to: string | null;
  amount: string | null;
  token: string | null;
}

export interface SendMessageArgs {
  to: string | null;
  message: string;
}

/**
 * Extracts a recipient handle from free text.
 *
 * Prefers an explicit "@handle" (unambiguous) over the word "to". Requires
 * "to" to be a standalone word (\b...\b on both sides) so it can't match
 * inside an unrelated word like "token" — e.g. "Send token to @roogle"
 * previously matched the "to" inside "token" and extracted "ken".
 */
function extractRecipient(text: string): string | null {
  const atMatch = text.match(/@([A-Za-z0-9_.-]+)/);
  if (atMatch) return atMatch[1];

  const toWordMatch = text.match(/\bto\b\s+@?([A-Za-z0-9._-]+)/i);
  if (toWordMatch) return toWordMatch[1];

  return null;
}

export function extractSendTokensArgs(text: string): SendTokensArgs {
  const amountMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  const tokenMatch = text.match(/\b(sol|uct|token|tokens)\b/i);
  return {
    to: extractRecipient(text),
    amount: amountMatch ? amountMatch[1] : null,
    token: tokenMatch ? tokenMatch[1].toUpperCase() : null,
  };
}

export function extractSendMessageArgs(text: string): SendMessageArgs {
  return {
    to: extractRecipient(text),
    message: text,
  };
}

/**
 * A value counts as "missing" if it's falsy OR one of the old placeholder
 * sentinels — kept for defense-in-depth in case a real LLM (Grok/OpenAI)
 * ever produces one of these instead of leaving the field out.
 */
function isMissingValue(v: string | null | undefined): boolean {
  return !v || v === 'the recipient' || v === 'some' || v === 'tokens';
}

/**
 * Returns a human clarifying question describing exactly what's missing
 * for a send_tokens request, or null if it has everything needed to proceed.
 * `token` is NOT treated as strictly required — it defaults sensibly and
 * SphereClient.sendTokens() falls back safely if it can't be resolved.
 */
export function describeMissingSendTokensFields(args: { to: string | null; amount: string | null }): string | null {
  const missingTo = isMissingValue(args.to);
  const missingAmount = isMissingValue(args.amount);
  if (missingTo && missingAmount) {
    return "Happy to help send tokens — how much would you like to send, and to whom (e.g. @nametag)?";
  }
  if (missingAmount) {
    return `How much would you like to send to ${args.to}?`;
  }
  if (missingTo) {
    return `Who would you like to send ${args.amount} tokens to? (e.g. @nametag)`;
  }
  return null;
}

/**
 * Returns a clarifying question for send_simple_message, or null if complete.
 */
export function describeMissingSendMessageFields(args: { to: string | null }): string | null {
  if (isMissingValue(args.to)) {
    return "Who would you like me to send that message to? (e.g. @nametag)";
  }
  return null;
}