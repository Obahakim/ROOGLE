# adapters/iframe/

Code specific to running ROOGLE inside the Unicity Sphere as an iframe agent or embedded component.

Typical contents:
- Web entry point
- Any minimal UI (chat interface) if required by Sphere for iframe agents
- Message passing between the parent Sphere window and the ROOGLE core

Keep logic minimal — delegate everything possible to src/agent/.