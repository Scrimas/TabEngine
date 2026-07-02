import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

function alphatabVibratoPatch() {
  return {
    name: 'alphatab-vibrato-patch',
    transform(code: string, id: string) {
      // Since alphaTab 1.8 the ESM code lives in alphaTab.core.mjs (the
      // package entry alphaTab.mjs only re-exports it). scripts/setup-assets.cjs
      // applies the same patch to the worker copies in public/assets/, which
      // bypass Vite transforms.
      if (id.includes('alphaTab.core.mjs') || id.includes('alphaTab.js')) {
        let modified = code.replace(
          /return\s+MusicFontSymbol\.GuitarVibratoStroke;/g,
          'return MusicFontSymbol.WiggleSawtoothNarrow;'
        );
        modified = modified.replace(
          /return\s+MusicFontSymbol\.GuitarWideVibratoStroke;/g,
          'return MusicFontSymbol.WiggleSawtooth;'
        );
        return { code: modified };
      }
    }
  };
}

// Tauri 2 exposes TAURI_ENV_DEBUG=true|false to beforeBuildCommand
// (TAURI_DEBUG was the Tauri 1 name and is no longer set).
const tauriDebug = process.env.TAURI_ENV_DEBUG === 'true';

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [svelte(), alphatabVibratoPatch()],

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
