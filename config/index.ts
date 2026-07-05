/**
 * config/index.ts
 * 
 * Loads environment configuration and provides safe defaults.
 * 
 * All code should import from here instead of process.env directly.
 * 
 * Default values must follow the ROOGLE vision:
 * - Always confirm before any money movement
 * - Keep explanations simple and jargon-free
 */

export const config = {
  confirmBeforeValue: process.env.CONFIRM_BEFORE_VALUE_MOVEMENT !== 'false',
  maxToolSteps: parseInt(process.env.MAX_TOOL_STEPS || '5'),
  discoveryEnabled: process.env.DISCOVERY_ENABLED !== 'false',
};
