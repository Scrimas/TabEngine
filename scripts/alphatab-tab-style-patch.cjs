/**
 * alphatab-tab-style-patch.cjs
 *
 * Appends TabEngine's Songsterr-style tab rendering tweaks to alphaTab's
 * `alphaTab.core.mjs` module:
 *
 *   1. Drop the big vertical "TAB" clef glyph at the start of every system
 *      (redundant with the track pills toolbar).
 *   2. Detach the rhythm strip: stems/beams are drawn flat on a baseline just
 *      below the tab staff instead of hanging from the note numbers.
 *
 * Why this lives in the dist module and not in app code: with
 * `core.useWorkers: true` all layout/painting happens inside alphaTab's own
 * Web Worker, which loads its own copy of the core module. A runtime
 * monkey-patch from AlphaTabManager only affects the main-thread module and
 * is invisible to the worker (this exact regression shipped in July 2026 —
 * the rhythm strip re-attached to the notes when worker rendering was
 * enabled). Patching the module source is the only way to affect both sides.
 *
 * Applied in two places (both required):
 *   - vite.config.ts `alphatabTabStylePatch` plugin — dev server (main thread
 *     AND the dev worker, both served through Vite) and the production bundle.
 *   - scripts/setup-assets.cjs — the verbatim-copied `public/assets/*.mjs`
 *     modules that the production worker loads, which bypass Vite entirely.
 *
 * The snippet only uses `Environment.defaultRenderers` (public export) and
 * wraps the tab factory's `create`; it throws at build time if the module
 * shape changes so an alphaTab upgrade can't silently disable it.
 */

'use strict';

const PATCH_MARKER = '/* TabEngine tab-style patch */';

const PATCH_SNIPPET = `
${PATCH_MARKER}
// Appended by scripts/alphatab-tab-style-patch.cjs — see that file for why.
(() => {
	const tabFactory = Environment.defaultRenderers.find((f) => f.staffId === 'tab');
	if (!tabFactory) throw new Error('TabEngine tab-style patch: no tab renderer factory');
	const originalCreate = tabFactory.create;
	tabFactory.create = function (renderer, bar) {
		const instance = originalCreate.call(this, renderer, bar);

		// Drop the "TAB" clef. TabClefGlyph isn't a public export and class names
		// can be mangled, so identify it structurally: the only pre-beat glyph
		// whose music-font symbol is a tab clef (SMuFL sixStringTabClef=57453 /
		// fourStringTabClef=57454).
		const TAB_CLEF_SYMBOLS = [57453, 57454];
		const originalAddPreBeatGlyph = instance.addPreBeatGlyph;
		instance.addPreBeatGlyph = function (glyph) {
			if (glyph && TAB_CLEF_SYMBOLS.includes(glyph.symbol)) return;
			originalAddPreBeatGlyph.call(this, glyph);
		};

		// Flat rhythm strip: stems/beams start on a baseline just below the
		// bottom staff line instead of hanging from each beat's note numbers.
		instance.getFlagTopY = function (_beat, _direction) {
			return this.getLineY(this.drawnLineCount - 1) + 12;
		};
		instance.getFlagBottomY = function (_beat, _direction) {
			return this.getLineY(this.drawnLineCount - 1) + 12 + 14;
		};
		instance.paintBeamingStem = function (beat, cy, x, topY, bottomY, canvas) {
			if (bottomY < topY) {
				const t = bottomY;
				bottomY = topY;
				topY = t;
			}
			const rhythmBaselineY = cy + this.getLineY(this.drawnLineCount - 1) + 12;
			if (rhythmBaselineY < bottomY) {
				const defaultColor = beat.voice.index === 0
					? this.settings.display.resources.mainGlyphColor
					: this.settings.display.resources.secondaryGlyphColor;
				const oldColor = canvas.color;
				canvas.color = defaultColor;
				canvas.fillRect(x, rhythmBaselineY, this.smuflMetrics.stemThickness, bottomY - rhythmBaselineY);
				canvas.color = oldColor;
			}
		};

		return instance;
	};
})();
`;

/**
 * Append the patch to alphaTab core module source. Idempotent.
 * Throws if `code` doesn't look like the expected module, so a future
 * alphaTab upgrade fails the build instead of silently dropping the patch.
 */
function applyTabStylePatch(code) {
  if (code.includes(PATCH_MARKER)) return code; // already patched
  if (!/\bexport \{[^}]*\bEnvironment\b/.test(code)) {
    throw new Error(
      'alphatab-tab-style-patch: `Environment` export not found in alphaTab core module — ' +
        'alphaTab changed shape, update scripts/alphatab-tab-style-patch.cjs',
    );
  }
  return code + PATCH_SNIPPET;
}

/** True for module ids/paths the patch must be applied to. */
function isAlphaTabCoreModule(id) {
  return id.includes('alphaTab.core.mjs');
}

module.exports = { applyTabStylePatch, isAlphaTabCoreModule, PATCH_MARKER };
