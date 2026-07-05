# src/sphere/

Everything related to the Unicity Sphere SDK lives here.

Responsibilities:
- Initializing the agent identity and wallet via @unicitylabs/sphere-sdk
- Sending and receiving messages (DMs or inside groups)
- Using Sphere's built-in discovery features to find other agents
- Wrapping SDK calls so the rest of ROOGLE stays clean and high-level

Never expose raw SDK complexity to the agent/orchestrator layer.