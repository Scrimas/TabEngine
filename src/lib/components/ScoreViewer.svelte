<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    initAlphaTab,
    loadFromBytes,
    destroyAlphaTab,
    setVisibleTracks,
    getTuningAnchor,
    resize,
  } from '$lib/alphatab/AlphaTabManager';
  import { playerStore } from '$lib/stores/player';
  import { tracksStore } from '$lib/stores/tracks';
  import { get } from 'svelte/store';
  import LoadingOverlay from './LoadingOverlay.svelte';
  import LoopOverlay from './LoopOverlay.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { importFileToLibrary, recordOpen } from '$lib/stores/library';
  import type { LibraryEntry } from '$lib/types';
  import { canvasToViewport } from '$lib/alphatab/canvasCoords';

  let containerEl: HTMLElement;  // outer <main> — passed to initAlphaTab
  let viewportEl: HTMLDivElement; // .at-viewport scroll container
  let atMainEl:   HTMLElement | null = null; // .at-main (alphaTab's render root)

  let scoreReady         = false;
  let isDragOver         = false;
  let selectedTrackIndex: number | null = null;

  // ── Track selection ──────────────────────────────────────────────────────────
  function selectTrack(index: number | null) {
    selectedTrackIndex = index;
    setVisibleTracks(index === null ? [] : [index]);
    tick().then(refreshTuningLabels);
  }

  // ── Tuning labels (per-string, at the start of the track) ───────────────────
  interface TuningLabel { x: number; y: number; note: string; }
  let tuningLabels: TuningLabel[] = [];

  function refreshTuningLabels() {
    if (selectedTrackIndex === null || !atMainEl) { tuningLabels = []; return; }
    const anchor = getTuningAnchor(selectedTrackIndex);
    if (!anchor) { tuningLabels = []; return; }
    tuningLabels = anchor.lineYs.map((lineY, i) => {
      const vp = canvasToViewport(anchor.x, lineY, viewportEl, atMainEl);
      return { x: vp.x, y: vp.y, note: anchor.notes[i] };
    });
  }

  // Playhead pick position (viewport-relative)
  let pickPos: { x: number; y: number; h: number } | null = null;
  $: {
    const s = $playerStore;
    if (s.isPlaying && s.beatCanvasX && atMainEl) {
      const vp = canvasToViewport(s.beatCanvasX, s.beatCanvasY, viewportEl, atMainEl);
      pickPos = { x: vp.x, y: vp.y, h: s.beatCanvasH };
    } else {
      pickPos = null;
    }
  }

  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: any = null;

  // Observer that hides vibrato/watermark text after each render. Kept at
  // component scope so the previous one can be disconnected on re-render —
  // observers are never released while observing, so one-per-render would
  // accumulate across track switches and file loads.
  let vibratoObserver: MutationObserver | null = null;

  // ── Mount / lifecycle ────────────────────────────────────────────────────────
  onMount(() => {
    initAlphaTab(containerEl);
    atMainEl = containerEl.querySelector<HTMLElement>('.at-main');

    // Auto-select the first real track (rather than leaving "All" highlighted)
    // since a fresh load already renders a single track by default.
    containerEl.addEventListener('tabengine:scoreLoaded', () => {
      if (get(tracksStore).length > 0) selectTrack(0);
    });

    containerEl.addEventListener('tabengine:renderFinished', () => {
      scoreReady = true;
      atMainEl = containerEl.querySelector<HTMLElement>('.at-main');

      const hideVibratoText = () => {
        if (!atMainEl) return;
        const textElements = atMainEl.querySelectorAll('svg text, svg tspan');
        textElements.forEach((el: any) => {
          const txt = el.textContent || '';
          const clean = txt.replace(/[^a-zA-Z\~\u007E]/g, '');
          const isVibrato = clean.length > 0 && /^[vVwW\~\u007E]+$/.test(clean);
          const isWatermark = txt.trim().toLowerCase() === 'rendered by alphatab';
          if (isVibrato || isWatermark) {
            el.style.display = 'none';
            if (el.parentNode && el.parentNode.tagName === 'text') {
              (el.parentNode as HTMLElement).style.display = 'none';
            }
          }
        });
      };

      // Run immediately and observe for any late DOM additions (SVG engine)
      hideVibratoText();
      vibratoObserver?.disconnect();
      vibratoObserver = new MutationObserver(hideVibratoText);
      if (atMainEl) vibratoObserver.observe(atMainEl, { childList: true, subtree: true });

      refreshTuningLabels();
    });

    containerEl.addEventListener('tabengine:scoreLoadFailed', () => {
      scoreReady = true; // dismiss the overlay so the UI isn't stuck
    });

    // Dynamic resize debouncer to prevent layout transitions from stuttering the canvas render
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (scoreReady) {
          resize();
          refreshTuningLabels();
        }
      }, 150);
    });
    resizeObserver.observe(containerEl);

    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        isDragOver = true;
      } else if (event.payload.type === 'drop') {
        isDragOver = false;
        const path = event.payload.paths[0];
        if (path) handleDroppedPath(path);
      } else {
        isDragOver = false;
      }
    }).then(fn => { unlistenDragDrop = fn; });
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    vibratoObserver?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    unlistenDragDrop?.();
    destroyAlphaTab();
  });

  // ── Public API ───────────────────────────────────────────────────────────────
  function reportLoadFailure(message: string, err: unknown): void {
    console.error(`[ScoreViewer] ${message}:`, err);
    scoreReady = true; // dismiss the loading overlay so the UI isn't stuck
    alert(`${message}: ${err}`);
  }

  export async function loadFile(path: string): Promise<void> {
    scoreReady = false;
    selectedTrackIndex = null;
    try {
      const bytes: number[] = await invoke('read_gp_file', { path });
      loadFromBytes(new Uint8Array(bytes));
    } catch (err) {
      reportLoadFailure('Failed to load file', err);
    }
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────────────
  // Tauri's native OS-level drag-drop (enabled by default) intercepts file
  // drops before they ever reach the webview's HTML5 dragover/drop DOM events,
  // so those never fire here. Use the native event instead.
  let unlistenDragDrop: UnlistenFn | null = null;

  async function handleDroppedPath(path: string) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (!['gp', 'gp3', 'gp4', 'gp5', 'gpx'].includes(ext)) return;
    scoreReady = false;
    try {
      const importedPath = await importFileToLibrary(path);
      const meta: LibraryEntry = await invoke('file_metadata', { path: importedPath });
      recordOpen(meta);
      await loadFile(importedPath);
    } catch (err) {
      reportLoadFailure('Failed to open dropped file', err);
    }
  }
</script>

<main
  class="score-viewer"
  class:drag-over={isDragOver}
  bind:this={containerEl}
  role="region"
  aria-label="Score viewer"
>
  <!-- Track tabs toolbar -->
  <div class="score-toolbar">
    <div class="track-tabs" role="toolbar" aria-label="Visible tracks">
      <button
        class="track-tab"
        class:active={selectedTrackIndex === null}
        on:click={() => selectTrack(null)}
      >
        <span class="tab-dot" style="background:#aeb2bc;{selectedTrackIndex !== null ? 'opacity:.4' : ''}"></span>
        All
      </button>
      {#each $tracksStore as track (track.index)}
        <button
          class="track-tab"
          class:active={selectedTrackIndex === track.index}
          on:click={() => selectTrack(track.index)}
          title={track.name}
        >
          <span class="tab-dot" style="background:{track.color};{selectedTrackIndex !== track.index ? 'opacity:.4' : ''}"></span>
          {track.instrument}
        </button>
      {/each}
    </div>
  </div>

  <!-- Loading overlay -->
  <LoadingOverlay {scoreReady} />

  <!-- Drop hint -->
  {#if !$playerStore.sfLoaded || (!scoreReady && $playerStore.totalTicks === 0)}
    <div class="drop-hint" class:active={isDragOver} aria-hidden="true">
      <div class="drop-icon">
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
          <rect width="52" height="52" rx="14" fill="rgba(43,40,35,0.06)" stroke="rgba(43,40,35,0.20)" stroke-width="1.5"/>
          <path d="M26 16 L26 34 M18 26 L26 34 L34 26" stroke="#c07838" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 38 L36 38" stroke="#c07838" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
        </svg>
      </div>
      <p class="drop-title">Drop a Guitar Pro file here</p>
      <p class="drop-sub">or use <kbd>Ctrl+O</kbd> / the sidebar to open a file</p>
      <div class="format-pills">
        {#each ['GP', 'GP3', 'GP4', 'GP5', 'GPX'] as fmt}
          <span class="pill">.{fmt.toLowerCase()}</span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- alphaTab scroll viewport -->
  <div class="at-viewport" class:ready={scoreReady} bind:this={viewportEl}>

    <!-- Loop selection drag handles (highlight fill is alphaTab's own .at-selection) -->
    <LoopOverlay {atMainEl} {viewportEl} />

    <!-- Per-string tuning labels at the start of the selected track -->
    {#each tuningLabels as label}
      <span
        class="tuning-label"
        style="left:{label.x - 20}px; top:{label.y}px;"
        aria-hidden="true"
      >{label.note}</span>
    {/each}

    <div
      class="score-card"
      on:animationend={refreshTuningLabels}
    >
      <div class="at-main"></div>
    </div>
  </div>
</main>

<style>
  .score-viewer {
    grid-area: main;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-score);
    min-height: 0;
  }

  .score-viewer.drag-over {
    box-shadow: inset 0 0 0 2px var(--accent);
    background: rgba(192, 120, 56, 0.04);
  }

  /* ── Toolbar ─────────────────────────────────────────────────────────────── */
  .score-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-score);
    flex-shrink: 0;
  }

  .track-tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    flex: 1;
  }
  .track-tabs::-webkit-scrollbar { display: none; }

  .track-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 12px;
    border-radius: 9px;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .track-tab:hover {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }
  .track-tab.active {
    background: var(--bg-elevated);
    border-color: var(--border-hover);
    color: var(--text-primary);
  }

  .tab-dot {
    width: 8px;
    height: 8px;
    border-radius: 2.5px;
    flex-shrink: 0;
  }

  /* ── alphaTab viewport ───────────────────────────────────────────────────── */
  .at-viewport {
    flex: 1;
    overflow: auto;
    position: relative;
    background: var(--bg-score);
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
    padding: 30px;
  }

  .score-card {
    max-width: 1160px;
    margin: 0 auto;
    background: var(--score-bg);
    border: 1px solid rgba(43,40,35,0.10);
    border-radius: 16px;
    padding: 10px;
    box-shadow: 0 14px 50px rgba(90,75,55,0.15);
    min-height: 100%;
  }

  .at-viewport.ready .score-card {
    animation: fadeInUp 0.45s var(--ease-out);
    padding: 40px 40px 10px;
  }

  /* ── Tuning labels ───────────────────────────────────────────────────────── */
  .tuning-label {
    position: absolute;
    width: 20px;
    transform: translateY(-50%);
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    pointer-events: none;
    z-index: 15;
  }

  /* ── Drop hint ───────────────────────────────────────────────────────────── */
  .drop-hint {
    position: absolute;
    inset: 48px 0 0 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    pointer-events: none;
    z-index: 10;
    opacity: 0.7;
    transition: opacity var(--transition), transform var(--transition);
  }
  .drop-hint.active { opacity: 1; transform: scale(1.02); }

  .drop-icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    /* box-shadow instead of filter: drop-shadow — WebKitGTK (Tauri's Linux
       webview) rasterizes drop-shadow on a container from its sharp-cornered
       bounding box rather than the rounded SVG content, leaving a faint
       square ghost around the rounded card. box-shadow has no such issue. */
    box-shadow: 0 0 16px rgba(192,120,56,0.35);
    animation: float-y 3.5s var(--ease-out) infinite;
  }

  .drop-title {
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  .drop-sub {
    font-size: 0.82rem;
    color: var(--text-secondary);
  }
  .drop-sub kbd {
    display: inline-block;
    padding: 1px 6px;
    background: rgba(43,40,35,0.07);
    border: 1px solid rgba(43,40,35,0.15);
    border-radius: 4px;
    font-size: 0.78rem;
    font-family: inherit;
  }

  .format-pills {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 4px;
  }
  .pill {
    padding: 3px 10px;
    border-radius: 99px;
    background: var(--accent-dim);
    border: 1px solid rgba(192,120,56,0.24);
    color: #8f541e;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  /* ── alphaTab internal overrides ─────────────────────────────────────────── */
  :global(.at-cursor-bar) {
    background: RGB(217, 138, 82, 0.05) !important;
    border: 0px solid rgba(192,120,56,0.08) !important;
  }
  /* Songsterr-style playhead. Two hard constraints discovered by reading
     alphaTab's own source and by trial:
     1. alphaTab re-applies `transform: translate() scale()` to this element
        every frame (its native positioning), where the scale's X factor is
        a HARDCODED CONSTANT 0.01 (it always calls setBounds with width=1
        against an internal xscale of 100 — see ScalableHtmlElementContainer
        in alphaTab.js) and the Y factor varies per row (barHeight/100). So:
          - any `width` we set is divided by 100 in the final render — to
            end up with a visible 16px-wide cursor we must set width to
            **1600px**, not 16px (16px literally renders as 0.16px = gone;
            this is exactly what broke the previous attempt).
          - any FIXED-pixel decoration (border-triangle, ::after dot sized
            in px) gets crushed by that same constant ×0.01 horizontally,
            and by a *different, dynamic* factor vertically per row — so
            fixed-px pseudo-elements can't reliably reproduce a shape here.
          - percentage-based sizing (border-radius %, background-size %) is
            resolved against the box's own layout dimensions before any
            transform is applied, so it scales consistently regardless —
            that's why the whole pin (head, sides, taper) is baked into one
            background-image SVG at background-size:100% 100% below, rather
            than built from separate fixed-size pieces.
     2. `clip-path` (both `url(#svg-clipPath)` and `polygon(...)`) renders
        this specific element fully invisible in this WebKitGTK build (Tauri
        Linux webview) — some interaction with the per-frame transform +
        `will-change: transform` alphaTab already applies. Confirmed by
        testing both forms; do not reintroduce clip-path here.
     The SVG below is Songsterr's own cursor body path, embedded verbatim
     (viewBox 12×93.4, its natural bounding box) and filled with the
     project's --accent hex directly, since CSS custom properties can't be
     referenced inside a data: URI. */
  /* Shape itself is a real inline <svg> child injected by AlphaTabManager's
     ensureCursorPinShape() — a CSS background-image data URI reliably fails
     to paint at the transformed size in this WebKitGTK build (confirmed via
     a solid-color control + DevTools: the div's own width/scale math is
     correct, only the background-image painting isn't). This rule just
     resets the div itself to a plain, invisible positioning box. */
  :global(.at-cursor-beat) {
    position: relative !important;
    width: 1600px !important;
    background: transparent !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  /* alphaTab's own native selection fill is intentionally left invisible —
     the LoopOverlay component draws the only visible loop indicator (two
     edge handles), matching the Songsterr reference look rather than a
     filled block whose width grows with the loop range. */
  :global(.at-selection div) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }
  :global(.at-surface) {
    cursor: default;
  }

</style>
