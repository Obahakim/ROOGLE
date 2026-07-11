/**
 * esbuild.config.mjs
 *
 * Bundles client/src/main.ts (including @unicitylabs/sphere-sdk/connect/browser
 * and the market-discovery browser SDK usage) into a single public/app.js,
 * then copies the HTML/CSS alongside it. Run via `npm run build:client`.
 *
 * This is intentionally a plain esbuild script rather than a heavier
 * bundler/framework — there's no React/Vue here, just DOM + fetch + the
 * Sphere SDK's browser build.
 */

import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'public');

mkdirSync(outDir, { recursive: true });

/**
 * @unicitylabs/nostr-js-sdk's browser build has two `await import(...)` calls
 * to Node built-ins ('crypto', 'zlib') as fallbacks for a Node.js runtime.
 * Both are guarded by real environment checks (`globalThis.crypto?.subtle`
 * and `process.versions?.node`) that are always false in an actual browser —
 * confirmed by reading the source, not assumed — so these branches never
 * execute there. esbuild still needs to resolve them statically to produce
 * a bundle at all, so we shim them to an empty module.
 */
const emptyNodeBuiltinShim = {
  name: 'empty-node-builtin-shim',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^(crypto|zlib)$/ }, (args) => ({
      path: args.path,
      namespace: 'empty-shim',
    }));
    buildApi.onLoad({ filter: /.*/, namespace: 'empty-shim' }, () => ({
      contents: 'export default {};',
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(__dirname, 'client/src/main.ts')],
  bundle: true,
  outfile: path.join(outDir, 'app.js'),
  format: 'esm',
  target: ['es2020'],
  minify: false,
  sourcemap: true,
  plugins: [emptyNodeBuiltinShim],
  define: {
    __SPHERE_NETWORK__: JSON.stringify(process.env.SPHERE_NETWORK || 'testnet'),
  },
});

copyFileSync(path.join(__dirname, 'client/index.html'), path.join(outDir, 'index.html'));
copyFileSync(path.join(__dirname, 'client/src/style.css'), path.join(outDir, 'style.css'));

console.log('[build:client] Wrote public/app.js, public/index.html, public/style.css');
