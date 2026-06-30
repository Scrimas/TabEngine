/// <reference types="svelte" />
/// <reference types="vite/client" />

// Extend the Window type to carry the alphaTab API reference if needed
// from non-Svelte contexts (e.g. web workers).
declare interface Window {
  __tabengine_version__?: string;
}
