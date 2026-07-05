# src/agent/

This is the heart of ROOGLE.

It contains:
- The main orchestrator logic that manages conversations
- The permanent system prompt
- All tool definitions (both self-tools that ROOGLE can execute directly and discovery tools for routing to other agents)

The code here should remain conversational and jargon-free in its behavior. Technical details are hidden from the user.

Main entry ideas:
- roogle.ts (main orchestrator)
- prompts/system.ts
- tools/ (registry + categories)
- llm/ (LLM and tool-calling layer)