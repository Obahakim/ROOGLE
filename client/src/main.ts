/**
 * client/src/main.ts
 *
 * Bundle entry point (see esbuild.config.mjs). Just boots the app once
 * the DOM is ready.
 */

import { initApp } from './app';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}