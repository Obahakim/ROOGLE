/**
 * Compile-time constant injected by esbuild.config.mjs (via `define`).
 * Not a runtime env var — there is no server-side process.env access in
 * the browser; this value gets baked into the bundle at build time.
 */
declare const __SPHERE_NETWORK__: string;

/**
 * @unicitylabs/sphere-sdk genuinely ships no .d.ts for this subpath (checked:
 * dist/impl/browser/ has only .js/.cjs, no .d.ts). This is an upstream gap,
 * not a bug on our side — silencing it here per TypeScript's own suggested
 * remedy for a package that "actually exposes this module" without types.
 */
declare module '@unicitylabs/sphere-sdk/impl/browser';