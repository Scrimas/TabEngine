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
import type { TrackState } from '$lib/types';
import { get } from 'svelte/store';
import { playerStore } from '$lib/stores/player';
import { settingsStore } from '$lib/stores/settings';

// ── Singleton state ───────────────────────────────────────────────────────────

let api:        alphaTab.AlphaTabApi | null = null;
let viewportEl: HTMLElement          | null = null;
let metronomeVolumeLimit = 80;
let countInBarLimit = 1;

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
      systemPaddingBottom: 32,
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

  // 6. Render finished — notify the ScoreViewer (flips the loading overlay off).
  api.renderFinished.on(() => {
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

  console.info('[AlphaTabManager] Initialised successfully.');
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
 * Activate looping between two tick positions.
 */
export function setLoopRange(startTick: number, endTick: number): void {
  if (!api) return;
  api.playbackRange = { startTick, endTick };
  api.isLooping     = true;
  updatePlayer({ isLooping: true, loopStartTick: startTick, loopEndTick: endTick });
}

export function clearLoop(): void {
  if (!api) return;
  api.isLooping     = false;
  api.playbackRange = null;
  updatePlayer({ isLooping: false, loopStartTick: 0, loopEndTick: 0 });
}

/**
 * Toggle full-song looping on/off. When disabling, also clears any custom
 * playback range so the next enable starts as a full-song loop.
 */
export function setLooping(enabled: boolean): void {
  if (!api) return;
  api.isLooping = enabled;
  if (!enabled) {
    api.playbackRange = null;
    updatePlayer({ isLooping: false, loopStartTick: 0, loopEndTick: 0 });
  } else {
    updatePlayer({ isLooping: true });
  }
}

/**
 * Render only the tracks at the given indices. Pass an empty array to show
 * all tracks (resets to the default full-score view).
 */
export function setVisibleTracks(trackIndices: number[]): void {
  if (!api?.score) return;
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

// ── Loop bounds (for drag-resize handles) ─────────────────────────────────────

export interface LoopBarBounds {
  startBar: { x: number; y: number; w: number; h: number };
  endBar:   { x: number; y: number; w: number; h: number };
}

/**
 * Returns the canvas-coordinate bounding boxes of the bars that contain the
 * loop start and end ticks. Returns null when no loop is active or the layout
 * hasn't been computed yet.
 */
export function getLoopBarBounds(): LoopBarBounds | null {
  if (!api?.boundsLookup || !api.tickCache) return null;
  const { loopStartTick, loopEndTick, isLooping } = get(playerStore);
  if (!isLooping || loopEndTick <= loopStartTick) return null;

  const bars = api.tickCache.masterBars;

  let si = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].start <= loopStartTick) { si = i; break; }
  }
  let ei = si;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].start < loopEndTick) { ei = i; break; }
  }

  const sb = api.boundsLookup.findMasterBarByIndex(si);
  const eb = api.boundsLookup.findMasterBarByIndex(ei);
  if (!sb || !eb) return null;

  return {
    startBar: { x: sb.realBounds.x, y: sb.realBounds.y, w: sb.realBounds.w, h: sb.realBounds.h },
    endBar:   { x: eb.realBounds.x, y: eb.realBounds.y, w: eb.realBounds.w, h: eb.realBounds.h },
  };
}

/**
 * Given canvas-coordinate X/Y, return the bar index whose realBounds contain
 * the point. Falls back to the nearest bar if no exact hit.
 */
export function findBarIndexAtCanvasPos(cx: number, cy: number): number {
  if (!api?.boundsLookup || !api.tickCache) return 0;
  const total = api.tickCache.masterBars.length;
  for (let i = 0; i < total; i++) {
    const b = api.boundsLookup.findMasterBarByIndex(i);
    if (!b) continue;
    const r = b.realBounds;
    if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) return i;
  }
  let nearest = 0, nd = Infinity;
  for (let i = 0; i < total; i++) {
    const b = api.boundsLookup.findMasterBarByIndex(i);
    if (!b) continue;
    const r = b.realBounds;
    const dx = Math.max(0, r.x - cx, cx - (r.x + r.w));
    const dy = Math.max(0, r.y - cy, cy - (r.y + r.h));
    const d = Math.hypot(dx, dy);
    if (d < nd) { nd = d; nearest = i; }
  }
  return nearest;
}

/** Start tick for a given bar index. */
export function getBarStartTick(barIndex: number): number {
  return api?.tickCache?.masterBars[barIndex]?.start ?? 0;
}

/** End tick for a given bar index (= next bar start). */
export function getBarEndTick(barIndex: number): number {
  if (!api?.tickCache) return 0;
  const bars = api.tickCache.masterBars;
  return bars[barIndex + 1]?.start ?? (bars[barIndex]?.start ?? 0) + 1920;
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

