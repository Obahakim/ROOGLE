# Architecture

## Summary

ROOGLE is a static client app (`client/`) plus a minimal server
(`adapters/iframe/web-entry.ts`). There is no LLM and no server-side
wallet anywhere in this system.

## Server

`adapters/iframe/web-entry.ts` — plain Node `http`, no framework.

- Serves `public/` (the built client app) as static files.
- `POST /api/parse` — takes `{ text: string }`, returns
  `{ intent: 'send' | 'swap' | 'unknown', args, missing }` using pure
  regex parsing (`src/lib/extraction.ts`). No network call, no SDK, no LLM.
- `GET /health` — for platform health checks.

That's the entire server-side surface.

## Client

Everything that touches a wallet or real value lives in `client/src/`:

- `wallet.ts` — Sphere Connect wrapper. `autoConnect()` detects the best
  transport (iframe > extension > popup) and connects to the user's own
  wallet. Balance reads (`sphere_getBalance`), sends, and DMs all go
  through `client.query(...)` / `client.intent(...)` against that
  connection — ROOGLE's server never sees a mnemonic or private key.
- `market.ts` — a separate, ephemeral, auto-generated Sphere instance
  (browser SDK, `market: true`) used only to read the public market
  (search, recent listings). The Connect protocol has no search RPC by
  design, so this can't go through the user's wallet connection — but it
  also never needs to, since it never touches funds or signs anything.
- `format.ts` — amount conversion, using the SDK's own `formatAmount` /
  `parseTokenAmount` / `toHumanReadable` (verified against the actual
  installed SDK version, not just its type declarations, which mismatched
  the runtime in one case — `toSmallestUnit` doesn't exist at runtime;
  `parseTokenAmount` is the real function).
- `app.ts` — bento rendering, the send flow, and the swap flow (search →
  DM negotiate → poll for reply → pay on accept).
- `identicon.ts` — a small deterministic SVG fingerprint from a pubkey,
  the same convention as Metamask/ENS "blockies".

Bundled by `esbuild.config.mjs` (plain esbuild, not a framework) into
`public/app.js` + copied `index.html`/`style.css`.

## Why no server-side wallet

Earlier versions of this project ran a single, server-side, mnemonic-based
wallet (`SPHERE_MNEMONIC`) shared by every visitor. That's fine for a
single-operator demo, but wrong for a public product — nobody should be
transacting through a wallet they don't control. This architecture moves
every value-touching action to the user's own connected wallet instead.