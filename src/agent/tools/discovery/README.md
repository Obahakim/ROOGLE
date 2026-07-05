# src/agent/tools/discovery/

Discovery tools are how ROOGLE finds and connects users to the best specialist agents in the Unicity Sphere ecosystem.

## Purpose

When a user asks for something that ROOGLE cannot (or should not) handle directly, ROOGLE uses these tools to:

1. Understand the user's real need in plain language.
2. Search the Sphere marketplace / agent directory.
3. Evaluate and recommend the most suitable specialist.
4. Prepare a clean handoff with the right context so the specialist can continue the conversation seamlessly.

## Implemented Discovery Tools

- **search_agents** — Searches mock (and future real) specialist agents matching the request.
- **recommend_best_agent** — Picks the single best match with a score/reason.
- **hand_off_to_agent** — Prepares and returns handoff data (target ID, reason, context).

The orchestrator (`roogle.ts`) ensures the user never sees tool names or specialist names — only clean messages. All details live in `thoughts` and the `handoff` object.

## Key Principles

- Always explain to the user in plain English why you are connecting them to a specialist.
- Only hand off when it genuinely helps the user.
- The user should feel supported, not passed around.

These tools are central to ROOGLE's role as an intelligent orchestrator.
