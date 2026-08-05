# ROOGLE

**ROOGLE** is a browser-native Unicity Sphere wallet dashboard.

It connects to the user's own wallet via Sphere Connect, shows real token balances, lets users send tokens and request payments, discovers market quotes, and stores transaction history locally in the browser.

ROOGLE is not a server-side wallet or LLM service. Every value action is approved by the user's wallet in the browser, and local history is persisted in `localStorage`.

## What ROOGLE does now

- Connect to a Sphere wallet using the user's own wallet app or extension
- Display real on-chain token balances
- Send tokens to addresses or nametags
- Create payment requests that the recipient approves in their own wallet
- Search public market quotes and pay selected quotes
- Keep a local transaction history with `pending` → `success` refresh behavior
- Run as a lightweight static + Node server app

## Quick start

```bash
npm install
npm run build:client
npm run build:server
npm start
```

For development:

```bash
npm run dev
```

`npm run dev` starts `adapters/iframe/web-entry.ts` in watch mode and serves the built `public/` assets.

## Project structure

- `client/` — browser UI source, styles, and favicon
- `public/` — built static app output
- `adapters/iframe/` — lightweight server entrypoint and parse API
- `config/` — runtime configuration and environment handling
- `src/` — shared utilities and prompt extraction logic
- `tests/` — unit and end-to-end test suites

## How it works

- The app is served from `public/`
- The client connects to Sphere using `@unicitylabs/sphere-sdk/connect/browser`
- Wallet actions are executed with the user's wallet approval
- Transaction history is saved locally in the browser, not on a backend

## Useful commands

- `npm run dev` — start development server with live reload via `tsx`
- `npm run build:client` — bundle the client UI into `public/`
- `npm run build:server` — compile the Node server entrypoint
- `npm run build` — build both client and server
- `npm start` — run the compiled server
- `npm test` — run the test suite

## License

MIT
