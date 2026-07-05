# src/

Core source code for the ROOGLE agent.

Everything here is written in TypeScript and focuses on:
- Understanding plain-language user requests
- Deciding whether to handle things directly or route to specialists
- Clean separation of agent logic from Sphere platform details

Subfolders:
- agent/ — The brain (orchestrator, prompts, tools)
- sphere/ — All integration with the Sphere SDK
- interfaces/ — Shared types used across the agent
