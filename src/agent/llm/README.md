# src/agent/llm/

This folder will contain all logic related to talking to the language model and turning its responses into tool calls or final answers.

## Planned contents (future phases)

- `index.ts` or `llm.ts` — Core abstraction for calling the LLM (supports different providers)
- `tool-calling.ts` — Logic for parsing tool calls from LLM output
- `prompt-builder.ts` — Combines system prompt + history + tools into the final prompt

The goal is to keep LLM-specific code isolated so ROOGLE can easily switch models or use different tool-calling strategies later.

For now this folder is a placeholder to show where LLM integration will live.
