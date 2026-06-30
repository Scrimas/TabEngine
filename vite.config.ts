import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

function alphatabVibratoPatch() {
  return {
    name: 'alphatab-vibrato-patch',
    transform(code: string, id: string) {
      if (id.includes('alphaTab.js')) {
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
    minify: process.env.TAURI_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_DEBUG,
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
