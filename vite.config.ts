import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { applyTabStylePatch, isAlphaTabCoreModule } from './scripts/alphatab-tab-style-patch.cjs';

// NOTE: an `alphatabVibratoPatch` plugin used to live here, remapping
// GuitarVibratoStroke/GuitarWideVibratoStroke → WiggleSawtoothNarrow/
// WiggleSawtooth. It matched the pre-1.8 filename `alphaTab.js` and had been
// silently dead since the alphaTab 1.8 upgrade — the approved app look (small
// smooth vibrato waves) is the UNPATCHED GuitarVibratoStroke rendering, and
// re-activating the remap replaced the waves with an angular sawtooth zigzag.
// Do not resurrect it.

// Songsterr-style tab rendering (no TAB clef, detached flat rhythm strip).
// Must be a source patch, not a runtime monkey-patch: with core.useWorkers
// the render worker loads its own copy of the core module where app-side
// patches never run. setup-assets.cjs applies the same patch to the
// public/assets/ worker copies, which bypass Vite.
function alphatabTabStylePatch(): Plugin {
  return {
    name: 'alphatab-tab-style-patch',
    transform(code, id) {
      if (isAlphaTabCoreModule(id)) {
        return { code: applyTabStylePatch(code), map: null };
      }
    },
  };
}

// Tauri 2 exposes TAURI_ENV_DEBUG=true|false to beforeBuildCommand
// (TAURI_DEBUG was the Tauri 1 name and is no longer set).
const tauriDebug = process.env.TAURI_ENV_DEBUG === 'true';

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [svelte(), alphatabTabStylePatch()],

  // Resolve $lib alias
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },

  // Prevent Vite from pre-bundling alphaTab — it uses dynamic worker imports
  // that must resolve at runtime against the dist tree.
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },

  // Dev server mirrors Tauri devUrl
  server: {
    port: 1420,
    strictPort: true,
    host: 'localhost',
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 1420,
    },
  },

  // Production build targets Tauri's embedded Chromium baseline (WebView2 / wry)
  // alphaTab uses BigInt literals, so we target esnext to avoid transpilation issues.
  build: {
    target: ['esnext', 'chrome120'],
    minify: tauriDebug ? false : 'esbuild',
    sourcemap: tauriDebug,
    // Raise chunk size warning threshold — alphaTab + sonivox.sf2 reference is large
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        // Split alphaTab into its own chunk
        manualChunks: {
          alphatab: ['@coderline/alphatab'],
        },
      },
    },
  },
}));
