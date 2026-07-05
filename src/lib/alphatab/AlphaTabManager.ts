/**
 * AlphaTabManager.ts
 *
 * Singleton integration layer between alphaTab and the TabEngine Svelte stores.
 *
 * Responsibilities:
 *  1. Initialise the AlphaTabApi on a given DOM element with all required
 *     settings (dark-theme colours, worker, bundled soundfont, cursor).
 *  2. Wire every alphaTab event to the corresponding Svelte store update so
 *     the UI stays fully reactive without polling.
 *  3. Expose thin wrappers around the alphaTab API so components never import
 *     alphaTab directly — all state flows through this module.
 *
 * Worker / SoundFont / Bravura font loading
 * ──────────────────────────────────────────
 *  - alphaTab's player spawns a synthesis Web Worker (and AudioWorklet)
 *    resolved as `new URL('./alphaTab.worker.mjs', import.meta.url)` — i.e.
 *    relative to its own script. In prod that's the Vite chunk under
 *    /assets/, so scripts/setup-assets.cjs copies alphaTab.worker.mjs,
 *    alphaTab.worklet.mjs and alphaTab.core.mjs into public/assets/. In dev
 *    alphaTab is unbundled (optimizeDeps.exclude) and resolves them from
 *    node_modules on its own.
 *  - `sonivox.sf2` and the Bravura music font are imported with Vite's `?url`
 *    suffix directly from the alphaTab package (NOT served as raw public/
 *    passthrough files). This matters under Tauri: its asset protocol derives
 *    Content-Type from Vite's build manifest, and files copied into public/
 *    verbatim (bypassing Vite's asset pipeline) aren't in that manifest — they
 *    get served with the correct bytes but an incorrect `text/html`
 *    Content-Type, which makes the browser refuse to use them as a font (and
 *    breaks the SoundFont fetch downstream). `?url` imports make Vite treat
 *    these exactly like any other processed/hashed asset, avoiding the bug.
 *  - Both assets are bundled into the Tauri binary via the Vite dist/ folder,
 *    so the app works fully offline after first install.
 */

// Import alphaTab as a namespace so we can access all sub-types.
import * as alphaTab from '@coderline/alphatab';
import { updatePlayer, resetPlayer } from '$lib/stores/player';
import { setTracks } from '$lib/stores/tracks';
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url';
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url';
import bravuraOtf from '@coderline/alphatab/font/Bravura.otf?url';
import sonivoxSf2 from '@coderline/alphatab/soundfont/sonivox.sf2?url';
import { TRACK_COLORS, formatTuning } from '$lib/types';
import type { TrackState, LoopHighlightBounds } from '$lib/types';
import { get } from 'svelte/store';
import { playerStore } from '$lib/stores/player';
import { settingsStore } from '$lib/stores/settings';

// ── Singleton state ───────────────────────────────────────────────────────────

let api:        alphaTab.AlphaTabApi | null = null;
let viewportEl: HTMLElement          | null = null;
let metronomeVolumeLimit = 80;
let countInBarLimit = 1;

// Same value as Settings.display.systemPaddingBottom below — the blank
// breathing room reserved below each system so the detached rhythm strip
// never crowds the next row's bar numbers. masterBarBounds.realBounds
// includes this trailing whitespace (it's part of the row's own allocated
// band, not the next row's), so the cursor and loop handles need to trim it
// back off to stop right after the rhythm strip instead of well past it.
const SYSTEM_BOTTOM_PADDING = 32;

/** Trim the reserved trailing whitespace off a masterBarBounds.realBounds
 *  height — used by both the cursor and loop handles so they stop right
 *  after the rhythm strip instead of extending into the next row's gap. */
function trimBottomPadding(h: number): number {
  return Math.max(1, h - SYSTEM_BOTTOM_PADDING);
}

// Loop selection state — the two beats bounding the current highlight/range.
// Kept in sync by the playbackRangeHighlightChanged listener regardless of
// whether the change came from alphaTab's own drag-to-select or our own
// dragLoopHandle() calls, so both interaction paths share one source of truth.
let loopStartBeat: alphaTab.model.Beat | null = null;
let loopEndBeat:   alphaTab.model.Beat | null = null;
// Tracks actually rendered right now — used to pick a sensible default track
// when seeding a loop range with no prior selection (setVisibleTracks keeps
// this in sync with whatever the UI currently shows).
let visibleTrackIndices: number[] = [];

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Create the AlphaTabApi bound to `container` and wire all store updates.
 *
 * @param container  The wrapper <div> that holds `.at-viewport > .at-main`.
 *                   Must be in the DOM before this is called (use `onMount`).
 */
export function initAlphaTab(container: HTMLElement): void {
  viewportEl    = container.querySelector<HTMLElement>('.at-viewport');
  const mainEl  = container.querySelector<HTMLElement>('.at-main');

  if (!mainEl || !viewportEl) {
    console.error('[AlphaTabManager] Required DOM structure (.at-viewport > .at-main) missing.');
    return;
  }

  // ── Settings (SettingsJson literal so all Color fields accept strings) ─────
  // Bake the current theme colours directly into the constructor argument so
  // the very first render (triggered by api.load) uses the correct ink colour.
  // The reactive block in App.svelte calls setThemeSettings() during component
  // initialisation — before onMount runs and before api exists — so that call
  // is always a no-op at startup. Pre-seeding here fixes dark-mode on startup.
  const isDark = get(settingsStore).theme === 'dark';

  const settings: ConstructorParameters<typeof alphaTab.AlphaTabApi>[1] = {
    core: {
      // Workers MUST stay enabled: alphaTab relays synth audio samples through
      // the main thread into the AudioWorklet, so main-thread layout/SVG work
      // (lazy per-system rendering during playback auto-scroll) starves the
      // audio pipeline → distorted, slowed playback. Worker files are shipped
      // to public/assets/ by scripts/setup-assets.cjs.
      useWorkers: true,
      engine: 'svg',
      // Leave scriptFile undefined → alphaTab auto-detects from import.meta.url
      // in the Vite ESM build (requires optimizeDeps.exclude in vite.config.ts)
      //
      // smuflFontSources (not fontDirectory) so the Bravura font is resolved
      // via Vite's own `?url` asset pipeline — see the file-header comment for
      // why this matters under Tauri's asset protocol.
      smuflFontSources: new Map([
        [alphaTab.FontFileFormat.Woff2, bravuraWoff2],
        [alphaTab.FontFileFormat.Woff,  bravuraWoff],
        [alphaTab.FontFileFormat.OpenType, bravuraOtf],
      ]),
    },
    display: {
      layoutMode:   alphaTab.LayoutMode.Page,
      scale:        0.95,
      staveProfile: alphaTab.StaveProfile.Tab,
      // padding: [top, right, bottom, left] in pt
      padding:      [10, 15, 10, 15],
      // Extra vertical breathing room between rendered rows (systems) so the
      // rhythm strip below each tab never crowds the next row's bar numbers.
      systemPaddingTop:    22,
      systemPaddingBottom: SYSTEM_BOTTOM_PADDING,
      resources: {
        staffLineColor:      isDark ? 'rgba(66,62,53,0.70)'    : 'rgba(205,195,170,0.70)',
        barSeparatorColor:   isDark ? 'rgba(66,62,53,0.85)'    : 'rgba(205,195,170,0.85)',
        mainGlyphColor:      isDark ? '#ece6d8'                : '#2b2823',
        secondaryGlyphColor: isDark ? 'rgba(236,230,216,0.55)' : 'rgba(43,40,35,0.55)',
        scoreInfoColor:      isDark ? '#ece6d8'                : '#2b2823',
        barNumberColor:      isDark ? 'rgba(236,230,216,0.38)' : 'rgba(43,40,35,0.38)',
        engravingSettings: {
          beamThickness: 2,
          beamSpacing: 2,
        },
      },
    },
    notation: {
      // Render rhythm stems/beams natively below the tab staff. Unlike a custom
      // overlay, this reserves real layout space (rhythmHeight) per system, so
      // spacing adapts dynamically to each bar's content and never overlaps.
      rhythmMode:   alphaTab.TabRhythmMode.ShowWithBars,
      rhythmHeight: 26,
    },
    player: {
      enablePlayer:   true,
      soundFont:      sonivoxSf2,
      // Audio anti-crackle cushion. Samples are relayed synth-worker → main
      // thread → AudioWorklet; the worklet keeps ~half this amount buffered
      // and refills through the main thread. At the 500 ms default the real
      // cushion is only ~90–115 ms — any main-thread stall longer than that
      // (lazy SVG insertion during auto-scroll, CPU power-saver throttling,
      // WebKitGTK's GStreamer output) causes distorted/slowed playback.
      // Tradeoff: volume/speed/metronome changes take effect up to ~0.7 s
      // late, because already-synthesized samples keep playing.
      bufferTimeInMilliseconds: 1500,
      enableCursor:   true,
      scrollElement:  viewportEl,
      scrollMode:     alphaTab.ScrollMode.Continuous,
      scrollOffsetX:  0,
      scrollOffsetY:  -80,
    },
  };

  // ── Create API ─────────────────────────────────────────────────────────────
  api = new alphaTab.AlphaTabApi(mainEl, settings);

  // Apply theme colors as proper Color instances onto the live resources object.
  // The constructor JSON path converts strings to Color via fromJson, but the
  // runtime setThemeSettings path (string assignment) bypasses that — and the
  // canvas color setter reads `.rgba` which only exists on Color instances, not
  // strings. Setting Color instances here guarantees correct rendering on first
  // api.load() regardless of whether the JSON constructor path succeeded.
  applyThemeColors(api, isDark);
  appliedTheme = isDark ? 'dark' : 'parchment';

  applyRealBoundsCursorHandler(api);

  // Disable wide-vibrato elements and slight beat vibratos (angular VVVV zigzag)
  // to prevent double notation and only show the smooth staff-level waves.
  const ne = alphaTab.NotationElement;
  api.settings.notation.elements.set(ne.EffectWideBeatVibrato, false);
  api.settings.notation.elements.set(ne.EffectSlightBeatVibrato, false);
  api.settings.notation.elements.set(ne.EffectWideNoteVibrato, false);

  // Disable alphaTab's built-in tuning header block — replaced by the
  // per-string tuning-label overlay drawn next to the actual staff lines.
  api.settings.notation.elements.set(ne.GuitarTuning, false);

  // Disable the vertical track-name label in the accolade (redundant with the
  // track pills toolbar above the score).
  api.settings.notation.elements.set(ne.TrackNames, false);

  // Push all post-construction settings mutations (theme colours above, the
  // notation.elements toggles) to the render worker. The worker only receives
  // a settings snapshot at construction and on explicit updateSettings() —
  // in-place mutations of api.settings are invisible to it, unlike the old
  // main-thread renderer which shared the object by reference.
  api.updateSettings();

  // ── Event wiring ───────────────────────────────────────────────────────────

  // 1. SoundFont load progress
  api.soundFontLoad.on((e) => {
    updatePlayer({
      sfLoadProgress: e.total > 0 ? e.loaded / e.total : 0,
    });
  });

  // 2. Player ready (SF2 fully parsed, synthesis engine warm)
  api.playerReady.on(() => {
    updatePlayer({ isReady: true, sfLoaded: true, sfLoadProgress: 1 });
  });

  // 3. Position ticker — drives the scrubber + cursor synchronisation
  //    Event type is PositionChangedEventArgs (not exported directly from
  //    the alphaTab namespace, so we let TypeScript infer it).
  api.playerPositionChanged.on((e) => {
    updatePlayer({
      currentTime: e.currentTime,
      totalTime:   e.endTime,
      currentTick: e.currentTick,
      totalTicks:  e.endTick,
    });
  });

  // 4. Play/pause state toggle
  api.playerStateChanged.on((e) => {
    updatePlayer({
      isPlaying: e.state === alphaTab.synth.PlayerState.Playing,
    });
  });

  // 5. Score loaded — build the mixer track list, then suppress rest glyphs in
  //    bars that contain only rests (no fret numbers).
  api.scoreLoaded.on((score) => {
    // Clear any loop range/highlight left over from the previous score —
    // resetPlayer() below only resets the store, not the live api state, and
    // stale Beat references from the old score must not survive a file swap
    // (see forceClearLoopSelection for why this can't just be
    // clearPlaybackRangeHighlight()).
    api!.isLooping = false;
    forceClearLoopSelection();

    resetPlayer();
    updatePlayer({ tempo: score.tempo });

    const tracks: TrackState[] = score.tracks.map((track, i) => ({
      index:     i,
      name:      track.name      || `Track ${i + 1}`,
      shortName: track.shortName || `T${i + 1}`,
      color:     TRACK_COLORS[i % TRACK_COLORS.length],
      // Seed from the file-authored level (0–16) — alphaTab initialises each
      // channel to playbackInfo.volume/16, so a constant here would desync the
      // fader from what's actually playing.
      volume:    Math.max(0, Math.min(16, track.playbackInfo.volume)),
      pan:       0,
      muted:     false,
      soloed:    false,
      tuning:    track.staves[0]?.isStringed ? [...track.staves[0].tuning] : [],
    }));
    setTracks(tracks);
    container.dispatchEvent(new CustomEvent('tabengine:scoreLoaded'));

    hideRestGlyphsInEmptyBars(score);
    dedupeSectionMarkerText(score);
  });

  // 6. Render finished — notify the ScoreViewer (flips the loading overlay off)
  //    and make sure the beat cursor has its pin-shape SVG child.
  api.renderFinished.on(() => {
    ensureCursorPinShape(container);
    container.dispatchEvent(new CustomEvent('tabengine:renderFinished'));
  });

  // 6b. Any alphaTab error (incl. unparseable files) — dismiss the loading overlay.
  api.error.on(() => {
    container.dispatchEvent(new CustomEvent('tabengine:scoreLoadFailed'));
  });

  // 7. Song reached end naturally — reset synthesis so next play isn't distorted.
  //    When isLooping is true alphaTab handles the restart itself; we only need
  //    this cleanup when the song plays through to the end without looping.
  api.playerFinished.on(() => {
    if (!api!.isLooping) {
      api!.stop();
    }
  });

  // 8. Beat changed — push canvas coordinates to store for the playhead pick.
  api.playedBeatChanged.on((beat) => {
    const b = api!.boundsLookup?.findBeat(beat);
    if (!b) return;
    const bar = b.barBounds.masterBarBounds.realBounds;
    updatePlayer({ beatCanvasX: b.onNotesX, beatCanvasY: bar.y, beatCanvasH: bar.h });
  });

  // 9. Playback range highlight changed — fires live during alphaTab's own
  //    built-in click-drag-to-select (enabled by default via
  //    player.enableUserInteraction) AND whenever we call
  //    highlightPlaybackRange() ourselves (default range / handle drag).
  //    Single source of truth for both interaction paths.
  api.playbackRangeHighlightChanged.on((e) => {
    loopStartBeat = e.startBeat ?? null;
    loopEndBeat   = e.endBeat   ?? null;
    updatePlayer({ loopHighlight: projectLoopHighlight(e) });
  });

  // 10. Plain-click behavior while looping is enabled — "if the loop button
  //     is enabled, there's always a loop". alphaTab's own click handling
  //     (_onBeatMouseUp -> applyPlaybackRangeFromHighlight with no
  //     selectionEnd) always seeks tickPosition to the clicked beat AND
  //     clears playbackRange, since a plain click looks identical to a
  //     zero-length selection. We let the seek stand but override the
  //     clearing: a click inside the active loop just moves the playhead
  //     there (loop keeps playing), a click outside it moves the loop to
  //     wrap the clicked bar instead of leaving playback loop-less.
  //     Distinguishing a real click-drag (drawing a brand new selection,
  //     already supported natively) from a plain click uses the beat seen
  //     on beatMouseDown vs any beat seen on beatMouseMove.
  let clickBeat: alphaTab.model.Beat | null = null;
  let clickRange: alphaTab.AlphaTabApi['playbackRange'] = null;
  let didDrag = false;
  api.beatMouseDown.on((beat) => {
    clickBeat  = beat;
    clickRange = api!.playbackRange;
    didDrag    = false;
  });
  api.beatMouseMove.on((beat) => {
    if (clickBeat && beat !== clickBeat) didDrag = true;
  });
  api.beatMouseUp.on((beat) => {
    const clicked      = beat ?? clickBeat;
    const rangeAtDown   = clickRange;
    const wasDrag       = didDrag;
    clickBeat  = null;
    clickRange = null;
    didDrag    = false;
    if (wasDrag || !clicked || !api || !get(playerStore).isLooping) return;

    const clickTick = clicked.absolutePlaybackStart;
    if (rangeAtDown && clickTick >= rangeAtDown.startTick && clickTick <= rangeAtDown.endTick) {
      // Inside the active loop — undo alphaTab's clear, keep the loop as-is.
      // The underlying AlphaSynth.playbackRange setter unconditionally seeks
      // tickPosition to the range's OWN start whenever it's assigned (even
      // when reassigning the same range) — save/restore the click's seek
      // around it or the playhead snaps back to the loop's beginning.
      const seekTick = api.tickPosition;
      api.playbackRange = rangeAtDown;
      api.tickPosition = seekTick;
      return;
    }
    // Outside the active loop — move it to wrap the clicked bar.
    applyBarLoop(api, clicked.voice.bar);
  });

  console.info('[AlphaTabManager] Initialised successfully.');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const CURSOR_PIN_PATH_D =
  'M0,6.6 Q0,0 6,0 q6,0 6,6.6 v76.8 c0,1.82,-0.49,3.59,-1.42,5.15 l-2.86,4.76 ' +
  'c-0.78,1.3,-2.65,1.3,-3.43,0 l-2.86,-4.76 c-0.93,-1.56,-1.43,-3.33,-1.43,-5.15 v-76.8 Z';
// Songsterr's own small oval/leaf "bud" that sits inside the pin head — same
// coordinate frame as CURSOR_PIN_PATH_D (both taken from the same source SVG),
// so the transform can be reused verbatim with no recomputation.
const CURSOR_PIN_ICON_D =
  'M0,2.97 C0,0.27 3,0 3.98,0 C4.97,0 8,0.27 8,2.97 C8,5.97 5.12,9.67 4,9.67 C2.88,9.67 0,5.97 0,2.97 Z';

/**
 * Injects Songsterr's cursor-pin shape as a real inline <svg> child of
 * alphaTab's `.at-cursor-beat` div, instead of a CSS `background-image` data
 * URI. A solid-color control (same width/transform, no image) confirmed the
 * div's own sizing math is correct — the SVG-as-background-image specifically
 * fails to paint in this WebKitGTK build: viewBox-only renders as a hairline,
 * and adding explicit width/height attributes (the usual fix for that class
 * of bug elsewhere) makes it paint nothing at all instead. A real SVG element
 * sized via width/height:100% is a different rendering path and isn't
 * subject to that bug.
 * Idempotent and safe to call after every render — `.at-cursor-beat` is
 * created once and persists for the app's lifetime (alphaTab only recreates
 * it if cursors are toggled off/on), so the `querySelector('svg')` guard
 * means this only actually does anything once.
 */
function ensureCursorPinShape(container: HTMLElement): void {
  const beatCursor = container.querySelector<HTMLElement>('.at-cursor-beat');
  if (!beatCursor || beatCursor.querySelector('svg')) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 93.4');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';
  svg.style.pointerEvents = 'none';

  // Body is deliberately translucent — it's wide enough to sit directly over
  // the fret numbers as it moves, so it must not fully hide them.
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', CURSOR_PIN_PATH_D);
  body.style.fill = 'var(--accent)';
  body.style.fillOpacity = '0.45';
  svg.appendChild(body);

  const icon = document.createElementNS(SVG_NS, 'path');
  icon.setAttribute('transform', 'translate(2 2)');
  icon.setAttribute('d', CURSOR_PIN_ICON_D);
  icon.style.fill = '#fff';
  icon.style.fillOpacity = '0.9';
  svg.appendChild(icon);

  beatCursor.appendChild(svg);
}

/**
 * Custom cursor placement — identical to alphaTab's own default
 * ToNextBeatAnimatingCursorHandler (see CursorHandler.ts), except it reads
 * `masterBarBounds.realBounds` instead of `.visualBounds`. The stock handler
 * uses visualBounds, which grows to include every decoration registered via
 * registerOverflowTop/Bottom above/below the staff (bend-technique labels,
 * section markers, etc.) — that's why the bar/beat cursor was stretching up
 * to cover things like a "[Chorus]" section marker instead of stopping at
 * the staff itself. `customCursorHandler` is a public alphaTab API (since
 * 1.8.1) made exactly for this kind of override, so this needs no source
 * patching (unlike the worker-visible Songsterr tab-style patch — cursor
 * placement runs on the main thread only, this object is enough on its own).
 */
// Assigned inline (not via a standalone typed const) so TypeScript picks up
// each method's parameter types by contextual inference from
// AlphaTabApi.customCursorHandler's setter — `ICursorHandler` exists in the
// .d.ts but isn't itself exported from the package, so it can't be named
// directly here.
function applyRealBoundsCursorHandler(api: alphaTab.AlphaTabApi): void {
  api.customCursorHandler = {
    onAttach() {},
    onDetach() {},
    placeBarCursor(barCursor, beatBounds) {
      const bounds = beatBounds.barBounds.masterBarBounds.realBounds;
      barCursor.setBounds(bounds.x, bounds.y, bounds.w, trimBottomPadding(bounds.h));
    },
    placeBeatCursor(beatCursor, beatBounds, startBeatX) {
      const bounds = beatBounds.barBounds.masterBarBounds.realBounds;
      beatCursor.transitionToX(0, startBeatX);
      beatCursor.setBounds(startBeatX, bounds.y, 1, trimBottomPadding(bounds.h));
    },
    transitionBeatCursor(beatCursor, _beatBounds, startBeatX, nextBeatX, duration, cursorMode) {
      const factor = cursorMode === alphaTab.midi.MidiTickLookupFindBeatResultCursorMode.ToNextBext ? 2 : 1;
      beatCursor.transitionToX(duration * factor, startBeatX + (nextBeatX - startBeatX) * factor);
    },
  };
}

// ── Transport controls ────────────────────────────────────────────────────────

export function play():      void { api?.play(); }
export function pause():     void { api?.pause(); }
export function playPause(): void { api?.playPause(); }
export function stop():      void { api?.stop(); }
export function resize():    void { api?.render(); }

// ── Settings mutations ────────────────────────────────────────────────────────

export function setDisplayScale(scale: number): void {
  if (!api) return;
  api.settings.display.scale = Math.max(0.25, Math.min(2.0, scale));
  api.updateSettings();
}

export function setMasterVolume(pct: number): void {
  if (!api) return;
  // alphaTab masterVolume: 0.0–3.0 where 1.0 = 100%
  api.masterVolume = Math.max(0, Math.min(pct, 100)) / 100;
  updatePlayer({ masterVolume: pct });
}

export function setPlaybackSpeed(speed: number): void {
  if (!api) return;
  api.playbackSpeed = Math.max(0.25, Math.min(2.0, speed));
  updatePlayer({ playbackSpeed: api.playbackSpeed });
}

export function setMetronomeEnabled(enabled: boolean): void {
  if (!api) return;
  api.metronomeVolume = enabled ? (metronomeVolumeLimit / 100) : 0;
  updatePlayer({ metronomeEnabled: enabled });
}

export function setCountInEnabled(enabled: boolean): void {
  if (!api) return;
  api.countInVolume = enabled ? (metronomeVolumeLimit / 100) : 0;
  updatePlayer({ countInEnabled: enabled });
}

export function setMetronomeVolumeLimit(volume: number): void {
  metronomeVolumeLimit = volume;
  if (!api) return;
  
  const enabled = get(playerStore).metronomeEnabled;
  api.metronomeVolume = enabled ? (metronomeVolumeLimit / 100) : 0;
  
  const countIn = get(playerStore).countInEnabled;
  api.countInVolume = countIn ? (metronomeVolumeLimit / 100) : 0;
}

export function setCountInBarLimit(bars: number): void {
  countInBarLimit = bars;
  // Not supported by alphaTab natively, keep as no-op.
}

function applyThemeColors(target: alphaTab.AlphaTabApi, dark: boolean): void {
  const { Color } = alphaTab.model;
  const res = target.settings.display.resources;
  if (dark) {
    res.staffLineColor      = Color.fromJson('rgba(66,62,53,0.70)')!;
    res.barSeparatorColor   = Color.fromJson('rgba(66,62,53,0.85)')!;
    res.mainGlyphColor      = Color.fromJson('#ece6d8')!;
    res.secondaryGlyphColor = Color.fromJson('rgba(236,230,216,0.55)')!;
    res.scoreInfoColor      = Color.fromJson('#ece6d8')!;
    res.barNumberColor      = Color.fromJson('rgba(236,230,216,0.38)')!;
  } else {
    res.staffLineColor      = Color.fromJson('rgba(205,195,170,0.70)')!;
    res.barSeparatorColor   = Color.fromJson('rgba(205,195,170,0.85)')!;
    res.mainGlyphColor      = Color.fromJson('#2b2823')!;
    res.secondaryGlyphColor = Color.fromJson('rgba(43,40,35,0.55)')!;
    res.scoreInfoColor      = Color.fromJson('#2b2823')!;
    res.barNumberColor      = Color.fromJson('rgba(43,40,35,0.38)')!;
  }
}

// Last theme actually applied to the api — a repeated call with the same theme
// must not trigger updateSettings/render, which is a full score re-render.
let appliedTheme: 'parchment' | 'dark' | null = null;

export function setThemeSettings(theme: 'parchment' | 'dark'): void {
  if (!api || theme === appliedTheme) return;
  appliedTheme = theme;
  applyThemeColors(api, theme === 'dark');
  api.updateSettings();
  api.render();
}

// ── Mixer controls ────────────────────────────────────────────────────────────

/** Change volume for one track. `volume` is the UI's 0–16 scale (GP file model);
 *  alphaTab's changeTrackVolume expects a 0–1 multiplier, so divide by 16. */
export function setTrackVolume(trackIndex: number, volume: number): void {
  if (!api?.score) return;
  const track = api.score.tracks[trackIndex];
  if (track) api.changeTrackVolume([track], Math.max(0, Math.min(16, volume)) / 16);
}

/** Mute / unmute a single track. */
export function setTrackMuted(trackIndex: number, muted: boolean): void {
  if (!api?.score) return;
  const track = api.score.tracks[trackIndex];
  if (track) api.changeTrackMute([track], muted);
}

/** Solo / unsolo a single track. */
export function setTrackSoloed(trackIndex: number, soloed: boolean): void {
  if (!api?.score) return;
  const track = api.score.tracks[trackIndex];
  if (track) api.changeTrackSolo([track], soloed);
}

// ── Loop selection ────────────────────────────────────────────────────────────

/**
 * Toggle looping on/off. Enabling seeds a default range spanning the current
 * bar if nothing is selected yet (a prior manual drag-to-select is left
 * untouched — toggling on just loops whatever's already highlighted).
 * Disabling clears the range/highlight entirely rather than leaving it behind.
 */
export function setLooping(enabled: boolean): void {
  if (!api) return;
  if (enabled) {
    if (!api.playbackRange) {
      const bar = defaultLoopBar();
      if (bar) applyBarLoop(api, bar);
    }
    api.isLooping = true;
    updatePlayer({ isLooping: true });
  } else {
    api.isLooping = false;
    forceClearLoopSelection();
    updatePlayer({ isLooping: false, loopHighlight: null });
  }
}

/**
 * api.applyPlaybackRangeFromHighlight() always seeks playback to the new
 * range's start tick — correct for a brand-new drag-to-select, but not for
 * seeding the loop button's default range (which should wrap the CURRENT bar
 * without yanking playback back to its start) or for resizing an
 * already-active loop's end handle (which restarted the loop from the
 * beginning on every drag update instead of leaving playback where it was).
 * Save and restore tickPosition around the call so it only ever changes the
 * range, never the transport position.
 */
function applyHighlightPreservingPosition(api: alphaTab.AlphaTabApi): void {
  const tick = api.tickPosition;
  try {
    api.applyPlaybackRangeFromHighlight();
  } catch (err) {
    console.warn('[AlphaTabManager] applyPlaybackRangeFromHighlight failed', err);
  }
  api.tickPosition = tick;
}

/**
 * Fully clears the active loop selection, including alphaTab's own internal
 * `_selectionStart`/`_selectionEnd` bookkeeping — NOT just the visible
 * highlight. `api.clearPlaybackRangeHighlight()` alone only wipes the DOM
 * selection blocks; alphaTab still replays the last-highlighted beat on
 * every future render pass (`_onPostRenderFinished` calls
 * `highlightPlaybackRange(this._selectionStart.beat, ...)` unconditionally
 * if that field is still set). If that beat's bar/track is later excluded —
 * a new score loaded, or the visible-track set changed — the replay throws
 * (`beat.bounds.realBounds` on a beat the new bounds cache can't find).
 * Passing the SAME beat as both ends of highlightPlaybackRange +
 * applyPlaybackRangeFromHighlight hits alphaTab's own same-beat branch,
 * which is the only path that actually nulls `_selectionStart` — must be
 * called while `loopStartBeat` is still valid in the CURRENT bounds cache,
 * i.e. before whatever change is about to invalidate it.
 */
function forceClearLoopSelection(): void {
  if (!api) return;
  if (loopStartBeat) {
    api.highlightPlaybackRange(loopStartBeat, loopStartBeat);
    api.applyPlaybackRangeFromHighlight();
  }
  api.playbackRange = null;
  loopStartBeat = null;
  loopEndBeat   = null;
}

/** First/last beat of the bar under the current playback cursor, for the
 *  currently visible track — used to seed a loop range with no prior
 *  selection. Returns null if the score/track/bar data isn't available. */
function defaultLoopBar(): alphaTab.model.Bar | null {
  if (!api?.score) return null;
  const track = api.score.tracks[visibleTrackIndices[0] ?? 0];
  return track?.staves[0]?.bars[currentBarIndex()] ?? null;
}

/**
 * Resolve the (startBeat, endBeat) pair to loop the given bar, plus the
 * exact tick range to actually play.
 *
 * A bar with only ONE beat (most commonly a whole-bar rest — i.e. an "empty"
 * bar) breaks alphaTab's own range machinery: `applyPlaybackRangeFromHighlight`
 * treats identical start/end beats as "no selection" and clears
 * `playbackRange` instead of creating one, and `_cursorSelectRange` (the
 * native highlight painter) early-returns the same way — so looping an
 * empty/single-beat bar silently did nothing. Borrowing the next bar's first
 * beat as the highlight's end gives alphaTab two genuinely different beats
 * to draw a highlight between; the actual tick range is always computed
 * directly from THIS bar's own beat(s), so playback never bleeds into the
 * next bar regardless of which beat was used for the visual.
 */
function loopBeatsForBar(bar: alphaTab.model.Bar): {
  startBeat: alphaTab.model.Beat;
  endBeat:   alphaTab.model.Beat;
  startTick: number;
  endTick:   number;
} | null {
  const beats = bar.voices[0]?.beats;
  if (!beats?.length) return null;
  const first = beats[0];
  const last  = beats[beats.length - 1];
  const startTick = first.absolutePlaybackStart;
  const endTick   = last.absolutePlaybackStart + last.playbackDuration - 50;
  if (first !== last) return { startBeat: first, endBeat: last, startTick, endTick };
  const nextFirstBeat = bar.nextBar?.voices[0]?.beats[0];
  return { startBeat: first, endBeat: nextFirstBeat ?? first, startTick, endTick };
}

/** Set the loop range/highlight to exactly wrap `bar`, preserving whatever
 *  the transport position currently is (see applyHighlightPreservingPosition
 *  for why that needs care — this also bypasses its beat-highlight-driven
 *  tick math, since that's exactly what breaks on single-beat bars). */
function applyBarLoop(api: alphaTab.AlphaTabApi, bar: alphaTab.model.Bar): void {
  const resolved = loopBeatsForBar(bar);
  if (!resolved) return;
  const { startBeat, endBeat, startTick, endTick } = resolved;
  const tick = api.tickPosition;
  try {
    api.highlightPlaybackRange(startBeat, endBeat);
  } catch (err) {
    // The visual highlight can fail under alphaTab's lazy rendering — e.g.
    // loopBeatsForBar borrows the NEXT bar's first beat for single-beat
    // bars, and that bar's bounds may not exist yet if it hasn't scrolled
    // into view. The actual loop range below is computed independently and
    // must still apply — the only casualty of this failing is the handles
    // not showing for this particular update, not the loop itself.
    console.warn('[AlphaTabManager] applyBarLoop: highlightPlaybackRange failed, loop range still applied', err);
    // Leave no stale handles behind at the OLD bar's position — hide them
    // cleanly instead, since playbackRangeHighlightChanged never fired to
    // update loopHighlight itself.
    loopStartBeat = null;
    loopEndBeat   = null;
    updatePlayer({ loopHighlight: null });
  }
  api.playbackRange = { startTick, endTick };
  api.tickPosition = tick;
}

/** Plain-object projection of a beat's canvas bounds for the store. Uses the
 *  beat's *row* (masterBar) height rather than its own tight bounds — a
 *  handle spanning only the note glyph looks stubby; spanning the full row
 *  (matching what alphaTab's own native .at-selection block would use) reads
 *  as a proper edge marker, Songsterr-style. */
function projectLoopHighlight(e: alphaTab.PlaybackHighlightChangeEventArgs): LoopHighlightBounds | null {
  const s  = e.startBeatBounds;
  const en = e.endBeatBounds;
  const startBeat = e.startBeat;
  const endBeat   = e.endBeat;
  if (!s || !en || !startBeat || !endBeat) return null;
  const sRow  = s.barBounds.masterBarBounds.realBounds;
  const enRow = en.barBounds.masterBarBounds.realBounds;

  // Mirror alphaTab's own selection-edge logic (_cursorSelectRange in
  // alphaTab.core.mjs): a beat sitting at the very start/end of its bar
  // extends the edge out to the BAR's bounds instead of just the beat's own
  // tight glyph bounds. Skipping this (using the beat's bounds unconditionally)
  // is why the left handle sat right up against the note — our default loop
  // range always starts on beat index 0 of a bar, so that's the common case.
  const startX = startBeat.index === 0
    ? sRow.x
    : s.realBounds.x;
  const endX = endBeat.index === endBeat.voice.beats.length - 1
    ? enRow.x + enRow.w
    : en.realBounds.x + en.realBounds.w;

  return {
    startX, startY: sRow.y, startH: trimBottomPadding(sRow.h),
    endX,   endY:   enRow.y, endH:   trimBottomPadding(enRow.h),
  };
}

/** Resolve the beat under a canvas-space point — used to snap a dragged loop
 *  handle to the nearest beat. */
export function getBeatAtCanvasPos(x: number, y: number): alphaTab.model.Beat | null {
  return api?.boundsLookup?.getBeatAtPos(x, y) ?? null;
}

/** Resize the active loop selection by moving one edge to `beat` (live
 *  preview only — does not touch actual playback until commitLoopHandleDrag). */
export function dragLoopHandle(which: 'start' | 'end', beat: alphaTab.model.Beat): void {
  if (!api || !loopStartBeat || !loopEndBeat) return;
  // alphaTab's rendering is lazy/progressive (systems render as they scroll
  // into view — see the core.useWorkers comment above), so the OTHER, fixed
  // end of the drag can reference a beat whose row isn't laid out yet once
  // the drag reaches a different line — most likely once a loop spans more
  // than one bar. If either beat isn't in the current bounds cache,
  // alphaTab's own highlightPlaybackRange throws reading
  // `beat.bounds.realBounds` on the missing one — and since that throw
  // happens synchronously inside this pointermove-driven call, it corrupts
  // the drag: the matching pointerup never gets a chance to reset
  // LoopOverlay's `dragging` state, so the handle keeps tracking the pointer
  // after the mouse button is released. Skip the update instead of crashing.
  const anchor = which === 'start' ? loopEndBeat : loopStartBeat;
  if (!api.boundsLookup?.findBeat(beat) || !api.boundsLookup?.findBeat(anchor)) return;
  // Belt-and-suspenders on top of the findBeat() checks above: when the drag
  // spans multiple staff systems, alphaTab's own highlight code also walks
  // `cache.staffSystems[i]` for every system BETWEEN start and end (to build
  // one highlight block per row) without checking those slots are populated
  // yet — a rarer lazy-rendering race the findBeat() checks don't cover,
  // since both individual beats can already have bounds while an
  // in-between system doesn't. Any exception here must not escape this
  // pointermove handler (see the comment above for why that corrupts drag
  // state), so swallow it and just skip this update.
  try {
    if (which === 'start') api.highlightPlaybackRange(beat, loopEndBeat);
    else api.highlightPlaybackRange(loopStartBeat, beat);
  } catch (err) {
    console.warn('[AlphaTabManager] dragLoopHandle: highlightPlaybackRange failed, skipping update', err);
  }
}

/** Commit the in-progress handle drag to the actual playback range. */
export function commitLoopHandleDrag(): void {
  if (!api) return;
  applyHighlightPreservingPosition(api);
}

/**
 * Render only the tracks at the given indices. Pass an empty array to show
 * all tracks (resets to the default full-score view).
 */
export function setVisibleTracks(trackIndices: number[]): void {
  if (!api?.score) return;
  // Clear the loop selection before re-rendering a different track subset —
  // the loop's beat may belong to a track about to be excluded, which would
  // crash the next render pass (see forceClearLoopSelection).
  if (loopStartBeat) forceClearLoopSelection();
  visibleTrackIndices = trackIndices.length === 0
    ? api.score.tracks.map((_, i) => i)
    : trackIndices;
  const tracks = trackIndices.length === 0
    ? [...api.score.tracks]
    : trackIndices.map(i => api!.score!.tracks[i]).filter(Boolean);
  api.renderTracks(tracks);
}

// ── Empty-bar rest hiding ─────────────────────────────────────────────────────

/**
 * Set the `GuitarTabRests` color to transparent on every rest beat in bars
 * that contain only rests (no fret numbers).  Done at model level in scoreLoaded
 * so alphaTab renders the rest glyphs with alpha=0 — no DOM overlay needed.
 *
 * Exception: a single empty bar surrounded by non-empty bars on BOTH sides is
 * preserved — it represents a meaningful pause inside an active passage.
 *
 * Evaluated independently per track/stave so the right bars are suppressed
 * regardless of which track the user is viewing.
 */
function hideRestGlyphsInEmptyBars(score: alphaTab.model.Score): void {
  const { BeatStyle, BeatSubElement, Color } = alphaTab.model;
  const transparent = new Color(0, 0, 0, 0);
  const total = score.masterBars.length;

  for (const track of score.tracks) {
    for (const staff of track.staves) {
      // Per-stave empty-bar map: bar.isRestOnly covers bars with no notes
      const isEmpty = staff.bars.map(bar => bar.isRestOnly);

      for (let m = 0; m < total; m++) {
        if (!isEmpty[m]) continue;

        // Keep rests visible if this single empty bar is sandwiched between
        // two bars that have actual notes on both sides.
        const prevHasContent = m > 0         && !isEmpty[m - 1];
        const nextHasContent = m < total - 1 && !isEmpty[m + 1];
        if (prevHasContent && nextHasContent) continue;

        for (const voice of staff.bars[m].voices) {
          for (const beat of voice.beats) {
            if (!beat.isRest) continue;
            if (!beat.style) beat.style = new BeatStyle();
            beat.style.colors.set(BeatSubElement.GuitarTabRests, transparent);
          }
        }
      }
    }
  }
}

/**
 * Some Guitar Pro files author section markers with the same string in both
 * the short marker id and the long description (e.g. marker="Intro Solo",
 * text="Intro Solo"). alphaTab renders both — `[marker] text` — so identical
 * values print as visually duplicated text ("[Intro Solo] Intro Solo"). Clear
 * the redundant description in that case, keeping just the bracketed marker.
 */
function dedupeSectionMarkerText(score: alphaTab.model.Score): void {
  for (const masterBar of score.masterBars) {
    const section = masterBar.section;
    if (section && section.marker.trim() && section.marker.trim() === section.text.trim()) {
      section.text = '';
    }
  }
}

/** Returns the index of the bar the current playback position is in. */
function currentBarIndex(): number {
  const tick  = get(playerStore).currentTick;
  const bars  = api!.tickCache?.masterBars ?? [];
  let idx = 0;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].start <= tick) idx = i;
    else break;
  }
  return idx;
}

/** Returns the bar index that starts each rendered row, in order. */
function rowStartIndices(): number[] {
  const lookup = api!.boundsLookup;
  const total  = api!.tickCache?.masterBars.length ?? 0;
  if (!lookup) return [];
  const starts: number[] = [];
  for (let i = 0; i < total; i++) {
    if (lookup.findMasterBarByIndex(i)?.isFirstOfLine) starts.push(i);
  }
  return starts;
}

/** Seek to the start of the previous bar (with a small hysteresis window). */
export function seekToPrevBar(): void {
  if (!api) return;
  const currentTick = get(playerStore).currentTick;
  const barStarts   = api.tickCache?.masterBars.map(b => b.start) ?? [];
  for (let i = barStarts.length - 1; i >= 0; i--) {
    if (barStarts[i] < currentTick - 200) {
      api.tickPosition = barStarts[i];
      return;
    }
  }
  api.tickPosition = 0;
}

/** Seek to the start of the next bar. */
export function seekToNextBar(): void {
  if (!api) return;
  const currentTick = get(playerStore).currentTick;
  const barStarts   = api.tickCache?.masterBars.map(b => b.start) ?? [];
  for (const start of barStarts) {
    if (start > currentTick + 100) {
      api.tickPosition = start;
      return;
    }
  }
}

/** Seek to the first bar of the previous rendered row (line). */
export function seekToPrevRow(): void {
  if (!api?.tickCache) return;
  const rows   = rowStartIndices();
  if (rows.length === 0) return;
  const barIdx = currentBarIndex();
  let lineIdx  = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] <= barIdx) lineIdx = i;
    else break;
  }
  const target = rows[Math.max(0, lineIdx - 1)];
  api.tickPosition = api.tickCache.masterBars[target]?.start ?? 0;
}

/** Seek to the first bar of the next rendered row (line). */
export function seekToNextRow(): void {
  if (!api?.tickCache) return;
  const rows   = rowStartIndices();
  if (rows.length === 0) return;
  const barIdx = currentBarIndex();
  let lineIdx  = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] <= barIdx) lineIdx = i;
    else break;
  }
  const target = rows[Math.min(rows.length - 1, lineIdx + 1)];
  api.tickPosition = api.tickCache.masterBars[target]?.start ?? 0;
}

// ── Seek ──────────────────────────────────────────────────────────────────────

/**
 * Seek to a playback position expressed as a fraction 0–1 of total duration.
 */
export function seekToFraction(fraction: number): void {
  if (!api) return;
  const state = get(playerStore);
  const tick  = Math.round(fraction * state.totalTicks);
  api.tickPosition = tick;
}

// ── File loading ──────────────────────────────────────────────────────────────

/**
 * Feed a Guitar Pro file's raw bytes to alphaTab.
 *
 * The `Uint8Array` is obtained from the Tauri `read_gp_file` command which
 * reads the file in Rust and returns a JSON array that the TS side converts.
 */
export function loadFromBytes(bytes: Uint8Array): void {
  if (!api) {
    console.error('[AlphaTabManager] API not initialised before loadFromBytes.');
    return;
  }
  api.load(bytes);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export function destroyAlphaTab(): void {
  api?.destroy();
  api          = null;
  viewportEl   = null;
  appliedTheme = null;
}

/** Expose the raw API for advanced use-cases. */
export function getApi(): alphaTab.AlphaTabApi | null { return api; }

// ── Tuning label anchors ──────────────────────────────────────────────────────

/**
 * Anchor + note letters for the tuning overlay of one track, or null if
 * unavailable. Only meaningful when `trackIndex` is the sole track currently
 * rendered (single-track view) — `lineAlignedBounds` of the first master bar
 * is then exactly the tab staff's line span, which we can evenly divide into
 * one y-position per string.
 */
export function getTuningAnchor(trackIndex: number): { x: number; lineYs: number[]; notes: string[] } | null {
  const tuning = api?.score?.tracks[trackIndex]?.staves[0]?.tuning;
  if (!api?.boundsLookup || !tuning || tuning.length === 0) return null;

  const mb = api.boundsLookup.findMasterBarByIndex(0);
  if (!mb) return null;
  const bounds = mb.lineAlignedBounds;

  const stringCount = tuning.length;
  const lineYs = Array.from({ length: stringCount }, (_, i) =>
    bounds.y + (bounds.h * i) / (stringCount - 1),
  );

  return { x: bounds.x, lineYs, notes: formatTuning(tuning).split(' ') };
}

// ── Songsterr rhythm styling ──────────────────────────────────────────────────
// The Songsterr-style tab tweaks (no TAB clef, detached flat rhythm strip)
// used to be a runtime monkey-patch here, but with core.useWorkers the render
// worker loads its own copy of the alphaTab core module where main-thread
// patches never run — the strip re-attached to the note numbers. The tweaks
// now live in scripts/alphatab-tab-style-patch.cjs, applied to the module
// source by vite.config.ts (dev + bundle) and setup-assets.cjs (prod worker).

