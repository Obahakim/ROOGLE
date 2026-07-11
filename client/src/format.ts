/**
 * client/src/format.ts
 *
 * Thin wrapper around the SDK's own amount conversion helpers. These are
 * the same functions verified earlier against the installed SDK version —
 * `parseTokenAmount` (not `toSmallestUnit`, which doesn't actually exist
 * at runtime in this SDK version despite appearing in its type declarations).
 */

import { formatAmount, parseTokenAmount, toHumanReadable } from '@unicitylabs/sphere-sdk';

/** Smallest-units string -> human display string with symbol, e.g. "1.5 UCT". */
export function formatBalance(amount: string, decimals: number, symbol: string): string {
  try {
    return formatAmount(BigInt(amount), { decimals, symbol });
  } catch {
    return `${amount} ${symbol}`;
  }
}

/** Human-typed amount (e.g. "2") -> smallest-units string for an intent call. */
export function toSmallestUnits(humanAmount: string, decimals: number): string {
  return parseTokenAmount(humanAmount, decimals).toString();
}

/** Smallest-units string -> plain human number string, no symbol. */
export function toHuman(amount: string, decimals: number): string {
  try {
    return toHumanReadable(BigInt(amount), decimals);
  } catch {
    return amount;
  }
}