/**
 * src/lib/extraction.ts
 *
 * Shared, single-source-of-truth helpers for pulling send/swap arguments
 * out of free text typed into the prompt box. Pure regex — no LLM call,
 * by design (this project intentionally avoids LLM dependencies).
 *
 * Missing values are returned as `null` — not a placeholder string like
 * "the recipient" or "some" — so callers can explicitly detect an
 * incomplete request and ask a clarifying question, instead of silently
 * proceeding with a placeholder the real SDK would reject anyway.
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

export interface SwapArgs {
  fromToken: string | null;
  toToken: string | null;
  amount: string | null;
}

export type PromptIntent = 'send' | 'swap' | 'unknown';

/**
 * Curated common token symbols, plus a generic ALL-CAPS 2-5 letter word as a
 * fallback (likely a ticker someone typed deliberately in caps, e.g. "XYZ").
 * Lowercase arbitrary tickers outside the curated list won't be caught —
 * a deliberate limitation to avoid false-positive matches on ordinary words.
 */
const KNOWN_TOKENS = /\b(sol|btc|eth|uct|usdc|usdt|token|tokens)\b/i;

function extractTokenSymbol(text: string): string | null {
  const known = text.match(KNOWN_TOKENS);
  if (known) return known[1].toUpperCase();
  const genericTicker = text.match(/\b([A-Z]{2,5})\b/);
  return genericTicker ? genericTicker[1] : null;
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

/**
 * Roughly classifies what a free-text prompt is asking for. Checked in this
 * order because "swap" is the more specific word — a message could contain
 * both ("swap some tokens then send the rest") and swap intent should win.
 */
export function classifyPromptIntent(text: string): PromptIntent {
  const lower = text.toLowerCase();
  if (/\bswap\b/.test(lower)) return 'swap';
  if (/\bsend\b/.test(lower)) return 'send';
  return 'unknown';
}

export function extractSendTokensArgs(text: string): SendTokensArgs {
  const amountMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  return {
    to: extractRecipient(text),
    amount: amountMatch ? amountMatch[1] : null,
    token: extractTokenSymbol(text),
  };
}

export function extractSendMessageArgs(text: string): SendMessageArgs {
  return {
    to: extractRecipient(text),
    message: text,
  };
}

/**
 * Extracts swap arguments from phrasing like "swap 3 SOL to BTC" or
 * "swap SOL for BTC". Anchored on the word "swap" plus two token-like
 * words joined by to/for/into — covers the common phrasing without
 * needing full natural-language understanding.
 */
export function extractSwapArgs(text: string): SwapArgs {
  const amountMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  const pattern = text.match(
    /swap\s+(?:\d+(?:\.\d+)?\s+)?([A-Za-z]{2,10})\s+(?:to|for|into)\s+([A-Za-z]{2,10})/i
  );
  return {
    fromToken: pattern ? pattern[1].toUpperCase() : null,
    toToken: pattern ? pattern[2].toUpperCase() : null,
    amount: amountMatch ? amountMatch[1] : null,
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

/**
 * Returns a clarifying question for a swap request, or null if complete.
 * Names exactly what's missing rather than a generic error.
 */
export function describeMissingSwapFields(args: { fromToken: string | null; toToken: string | null; amount: string | null }): string | null {
  const missing: string[] = [];
  if (isMissingValue(args.amount)) missing.push('an amount');
  if (isMissingValue(args.fromToken)) missing.push('which token to swap from');
  if (isMissingValue(args.toToken)) missing.push('which token to swap to');
  if (missing.length === 0) return null;
  if (missing.length === 1) return `I need ${missing[0]} to set up that swap.`;
  const last = missing[missing.length - 1];
  const rest = missing.slice(0, -1).join(', ');
  return `I need a few more details to set up that swap: ${rest} and ${last}.`;
}