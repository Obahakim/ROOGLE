# config/

Central place for configuration and environment handling.

Contains:
- Loading of .env values
- Safe default settings aligned with ROOGLE vision (e.g. always confirm money movement)
- Constants that should not be scattered around the codebase

Never hardcode secrets. Use environment variables for anything sensitive.