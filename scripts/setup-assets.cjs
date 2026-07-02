#!/usr/bin/env node
/**
 * setup-assets.cjs
 *
 * Runs as `postinstall` hook. Copies alphaTab's worker/worklet ESM modules
 * from node_modules into `public/assets/` so they ship in the Tauri build:
 *
 *   - alphaTab.worker.mjs   →  public/assets/alphaTab.worker.mjs
 *   - alphaTab.worklet.mjs  →  public/assets/alphaTab.worklet.mjs
 *   - alphaTab.core.mjs     →  public/assets/alphaTab.core.mjs  (imported by both)
 *
 * Why: alphaTab's player always spawns a synthesis Web Worker (and an
 * AudioWorklet) resolved as `new URL('./alphaTab.worker.mjs', import.meta.url)`.
 * In the production bundle `import.meta.url` is the Vite chunk at
 * `<root>/assets/alphatab-<hash>.js`, so the browser requests
 * `<root>/assets/alphaTab.worker.mjs`. Without these copies Tauri serves its
 * index.html fallback instead, the module worker fails to parse HTML
 * ("SyntaxError: Unexpected token '<'"), and the player never becomes ready —
 * the UI hangs at "Loading SoundFont…". Dev is unaffected (alphaTab is
 * unbundled there via optimizeDeps.exclude, so the relative URL resolves
 * inside node_modules).
 *
 * The SoundFont and Bravura music font are NOT copied here — they're imported
 * in AlphaTabManager.ts via Vite's `?url` suffix and flow through Vite's
 * asset pipeline like any other hashed asset.
 *
 * The copies also get the same vibrato-glyph remap as the
 * `alphatabVibratoPatch` plugin in vite.config.ts: with `core.useWorkers`
 * enabled the release build renders the score inside alphaTab.worker.mjs /
 * alphaTab.core.mjs, and files in public/ bypass Vite transforms entirely.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const AT_DIST    = path.join(ROOT, 'node_modules', '@coderline', 'alphatab', 'dist');
const ASSETS_DIR = path.join(ROOT, 'public', 'assets');

// ── helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Mirror of alphatabVibratoPatch in vite.config.ts — keep the two in sync.
function patchVibratoGlyphs(code) {
  return code
    .replace(
      /return\s+MusicFontSymbol\.GuitarVibratoStroke;/g,
      'return MusicFontSymbol.WiggleSawtoothNarrow;'
    )
    .replace(
      /return\s+MusicFontSymbol\.GuitarWideVibratoStroke;/g,
      'return MusicFontSymbol.WiggleSawtooth;'
    );
}

function copy(src, dest, label) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ ${label} source not found at ${src}. Run 'npm install' first.`);
    return;
  }
  fs.writeFileSync(dest, patchVibratoGlyphs(fs.readFileSync(src, 'utf8')));
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ✓ Copied ${label} (${kb} KB)`);
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log('\nTabEngine postinstall: setting up alphaTab worker assets...');

ensureDir(ASSETS_DIR);

for (const file of ['alphaTab.worker.mjs', 'alphaTab.worklet.mjs', 'alphaTab.core.mjs']) {
  copy(path.join(AT_DIST, file), path.join(ASSETS_DIR, file), file);
}

console.log('Done.\n');
