# src/agent/tools/

All tools that ROOGLE can use.

Organized into two main categories:

- self/ — Tools ROOGLE can execute itself (examples: simple answers, basic calculations, user preference storage, confirmations)
- discovery/ — Tools that let ROOGLE search, evaluate, and hand off to the best specialist agents on the Unicity Sphere

tools/index.ts should export a clean registry that the orchestrator uses.