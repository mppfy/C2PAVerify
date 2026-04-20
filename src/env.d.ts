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
