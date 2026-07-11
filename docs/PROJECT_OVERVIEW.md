# Project Overview

ROOGLE is a wallet dashboard for the Unicity Sphere ecosystem — connect
your wallet, see your real holdings, send and swap tokens.

For the technical breakdown, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For setup, see the root [README.md](../README.md).

## Product decisions worth knowing

- **No LLM.** Every action either comes from a button (structured, exact
  arguments) or a free-text prompt parsed with plain regex
  (`src/lib/extraction.ts`) — no API key, no network call, no LLM
  dependency anywhere.
- **No server-side wallet.** Every balance/send/swap action runs in the
  browser against the user's own connected wallet via Sphere Connect.
  ROOGLE's server never holds a mnemonic or private key on anyone's behalf.
- **Swap is a real negotiation, not an instant trade.** Unicity has no
  AMM/liquidity pool. A swap here searches the public market for a real
  counterparty, sends them a DM offer through the user's own wallet, and
  pays only after they accept.
- **Missing or incomplete input is always named explicitly.** Forms and
  prompt parsing describe exactly what's missing ("How much would you
  like to send to roogle?") rather than silently guessing or defaulting.