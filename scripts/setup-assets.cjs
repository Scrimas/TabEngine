#!/usr/bin/env node
/**
 * setup-assets.cjs
 *
 * Runs as `postinstall` hook. Copies two alphaTab assets from node_modules
 * into `public/` so Vite serves them in dev AND bundles them for Tauri prod:
 *
 *   - alphaTab.worker.js  →  public/alphaTab.worker.js
 *   - sonivox.sf2         →  public/soundfont/sonivox.sf2
 *
 * The worker must be at a stable URL ('/alphaTab.worker.js') because alphaTab
 * needs to load it from the same origin as the app.  The soundfont (~30 MB)
 * is bundled so the app works fully offline after install.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const AT_DIST     = path.join(ROOT, 'node_modules', '@coderline', 'alphatab', 'dist');
const PUBLIC_DIR  = path.join(ROOT, 'public');
const SF_DIR      = path.join(PUBLIC_DIR, 'soundfont');

// ── helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyIfMissing(src, dest, label) {
  if (fs.existsSync(dest)) {
    console.log(`  ✓ ${label} already present — skipping`);
    return;
  }
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ ${label} source not found at ${src}. Run 'npm install' first.`);
    return;
  }
  fs.copyFileSync(src, dest);
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ✓ Copied ${label} (${kb} KB)`);
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log('\nTabForge postinstall: setting up static assets...');

ensureDir(PUBLIC_DIR);
ensureDir(SF_DIR);

copyIfMissing(
  path.join(AT_DIST, 'alphaTab.worker.js'),
  path.join(PUBLIC_DIR, 'alphaTab.worker.js'),
  'alphaTab.worker.js'
);

copyIfMissing(
  path.join(AT_DIST, 'soundfont', 'sonivox.sf2'),
  path.join(SF_DIR, 'sonivox.sf2'),
  'sonivox.sf2 (SoundFont2)'
);

console.log('Done.\n');
