/**
 * Ambient module declarations for non-TS imports.
 * Cloudflare Workers bundler resolves `*.wasm` imports to compiled WebAssembly.Module.
 */

declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

declare module '@contentauth/c2pa-wasm/c2pa.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

// Text-mode imports for CAI trust artifacts (wrangler [[rules]] type = "Text").
declare module '*.pem' {
  const text: string;
  export default text;
}
declare module '*.cfg' {
  const text: string;
  export default text;
}
// Markdown legal docs served verbatim at /legal/* (scoped to **/legal/*.md
// via wrangler rule so unrelated .md files in the repo are not bundled).
declare module '*.md' {
  const text: string;
  export default text;
}
