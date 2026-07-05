# ROOGLE

**ROOGLE** is the friendly conversational orchestrator for the Unicity Sphere.

You talk to ROOGLE in plain English (or any language). It listens, understands what you want, and either handles the request directly using its own tools or intelligently discovers and connects you to the best specialist agent in the entire Unicity ecosystem. Everything stays simple, safe, and jargon-free.

ROOGLE runs as a live agent inside Unicity Sphere (as an iframe or DM bot) powered by the Sphere SDK.

See the full vision in [docs/PROJECT_OVERVIEW.md](./docs/PROJECT_OVERVIEW.md).

## Quick Start

```bash
# 1. Copy environment file and fill in keys (especially GROK_API_KEY + SPHERE_MNEMONIC)
cp .env.example .env

# 2. Install deps
npm install

# 3. Run the Iframe Agent (recommended for testing)
npm run dev:iframe
# Open http://localhost:3001 in your browser

# Other options
npm run dev          # basic core
npx tsx scripts/test-conversation.ts
```

## Running as an Iframe Agent

The primary way to use ROOGLE is as an **iframe agent**.

```bash
npm run dev:iframe
```

This starts a minimal Node server on port 3001 (or `PORT`) that:
- Initializes the SphereClient using your `.env` (real SDK when `SPHERE_MNEMONIC` is set).
- Serves a clean Tailwind chat UI.
- Exposes `/chat` that uses the full core (`handleUserMessage`, Grok + all tools).

### Loading inside Sphere

1. Make the page publicly accessible (deploy the static output or run a persistent server).
2. In Sphere (sphere.unicity.network), use the agent registration / marketplace flow or direct deep-link to embed the URL as an iframe agent.
3. Sphere will load your page inside an iframe and may communicate via `postMessage` (basic support is present; extend `window.addEventListener('message')` if needed).

For local development you can also manually create a test page:
```html
<iframe src="http://localhost:3001" width="100%" height="600"></iframe>
```

See `adapters/iframe/web-entry.ts` for the implementation.

## Structure

- `docs/` — All documentation
- `src/` — Agent source code (orchestrator, tools, LLM layer)
- `adapters/` — Iframe + DM entry points
- `scripts/` — dev tools, tests, connection checker
- `config/` — supporting areas

## Development Scripts

- `npm run dev:iframe` — Iframe agent with chat UI (uses real SDK when possible)
- `npm run start:iframe` — same as above
- `npx tsx scripts/check-sphere-connection.ts` — quick real vs mock status

## License

To be determined.
