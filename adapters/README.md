# adapters/

Thin adapter layers that let the same core ROOGLE agent run in different environments.

- iframe/ — Entry point when ROOGLE is loaded as an embedded agent (iframe) inside the Sphere web UI.
- dm/ — Entry point when ROOGLE runs as a direct-messaging bot.

These adapters should be very small. They translate platform-specific events into the common conversation interface used by src/agent/.