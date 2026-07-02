<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    initAlphaTab,
    loadFromBytes,
    destroyAlphaTab,
    setVisibleTracks,
    setLoopRange,
    getLoopBarBounds,
    findBarIndexAtCanvasPos,
    getBarStartTick,
    getBarEndTick,
    getTuningAnchor,
    resize,
  } from '$lib/alphatab/AlphaTabManager';
  import { playerStore } from '$lib/stores/player';
  import { tracksStore } from '$lib/stores/tracks';
  import { get } from 'svelte/store';
  import LoadingOverlay from './LoadingOverlay.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { importFileToLibrary, recordOpen } from '$lib/stores/library';
  import type { LibraryEntry } from '$lib/types';

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
      const vp = canvasToViewport(anchor.x, lineY);
      return { x: vp.x, y: vp.y, note: anchor.notes[i] };
    });
  }

  // ── Loop resize handles ──────────────────────────────────────────────────────

  interface HandlePos { x: number; y: number; h: number; }
  let startHandle: HandlePos | null = null;
  let endHandle:   HandlePos | null = null;

  // Convert alphaTab canvas coordinates → viewport-element-relative px.
  // Adds back viewportEl's current scroll offset so the result is the position
  // within the *unscrolled* content box — the overlay elements are normal
  // (scrolling) children of .at-viewport, so the browser's native scroll already
  // moves them; re-deriving from live (scrolled) bounding rects without this
  // would double-count the scroll offset and drift at 2x speed.
  function canvasToViewport(cx: number, cy: number): { x: number; y: number } {
    if (!viewportEl || !atMainEl) return { x: cx, y: cy };
    const vr = viewportEl.getBoundingClientRect();
    const mr = atMainEl.getBoundingClientRect();
    return {
      x: cx + (mr.left - vr.left) + viewportEl.scrollLeft,
      y: cy + (mr.top - vr.top) + viewportEl.scrollTop,
    };
  }

  // Convert mouse client position → canvas coordinates
  function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    if (!atMainEl) return { x: 0, y: 0 };
    const mr = atMainEl.getBoundingClientRect();
    return { x: clientX - mr.left, y: clientY - mr.top };
  }

  function refreshHandles() {
    if (!atMainEl) return;
    const bounds = getLoopBarBounds();
    if (!bounds) { startHandle = null; endHandle = null; return; }
    const sv = canvasToViewport(bounds.startBar.x, bounds.startBar.y);
    const ev = canvasToViewport(
      bounds.endBar.x + bounds.endBar.w,
      bounds.endBar.y,
    );
    startHandle = { x: sv.x, y: sv.y, h: bounds.startBar.h };
    endHandle   = { x: ev.x, y: ev.y, h: bounds.endBar.h   };
  }

  // Reactive refresh when loop state changes
  $: {
    $playerStore.loopStartTick;
    $playerStore.loopEndTick;
    $playerStore.isLooping;
    tick().then(refreshHandles);
  }

  // Playhead pick position (viewport-relative)
  let pickPos: { x: number; y: number; h: number } | null = null;
  $: {
    const s = $playerStore;
    if (s.isPlaying && s.beatCanvasX && atMainEl) {
      const vp = canvasToViewport(s.beatCanvasX, s.beatCanvasY);
      pickPos = { x: vp.x, y: vp.y, h: s.beatCanvasH };
    } else {
      pickPos = null;
    }
  }

  // Drag state
  let dragging: 'start' | 'end' | null = null;
  let dragPreviewX = 0;
  let dragPreviewY = 0;

  function onHandlePointerDown(e: PointerEvent, which: 'start' | 'end') {
    e.preventDefault();
    e.stopPropagation();
    dragging = which;
    dragPreviewX = e.clientX;
    dragPreviewY = e.clientY;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onHandlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    dragPreviewX = e.clientX;
    dragPreviewY = e.clientY;
    // Update preview position of the dragging handle
    const vr = viewportEl.getBoundingClientRect();
    const previewVx = e.clientX - vr.left;
    const previewVy = e.clientY - vr.top;
    if (dragging === 'start') {
      startHandle = { ...(startHandle ?? { x: 0, y: 0, h: 40 }), x: previewVx };
    } else {
      endHandle = { ...(endHandle ?? { x: 0, y: 0, h: 40 }), x: previewVx };
    }
  }

  function onHandlePointerUp(e: PointerEvent) {
    if (!dragging) return;
    const which = dragging;
    dragging = null;

    const canvas = clientToCanvas(e.clientX, e.clientY);
    const barIdx = findBarIndexAtCanvasPos(canvas.x, canvas.y);
    const player = get(playerStore);

    if (which === 'start') {
      const newStart = getBarStartTick(barIdx);
      const newEnd   = Math.max(newStart + 1, player.loopEndTick);
      setLoopRange(newStart, newEnd);
    } else {
      const newEnd   = getBarEndTick(barIdx);
      const newStart = Math.min(player.loopStartTick, newEnd - 1);
      setLoopRange(newStart, newEnd);
    }

    tick().then(refreshHandles);
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

      refreshHandles();
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
          refreshHandles();
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
    startHandle = null;
    endHandle   = null;
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
          {track.name}
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

    <!-- Loop resize handles (overlaid on viewport) -->
    {#if $playerStore.isLooping && startHandle && !dragging}
      <div
        class="loop-handle loop-handle-start"
        style="left:{startHandle.x - 20}px; top:{startHandle.y}px; height:{startHandle.h}px"
        on:pointerdown={(e) => onHandlePointerDown(e, 'start')}
        on:pointermove={onHandlePointerMove}
        on:pointerup={onHandlePointerUp}
        title="Drag to move loop start"
        aria-label="Loop start handle"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M8 1 L2 8 L8 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    {/if}

    {#if $playerStore.isLooping && endHandle && !dragging}
      <div
        class="loop-handle loop-handle-end"
        style="left:{endHandle.x}px; top:{endHandle.y}px; height:{endHandle.h}px"
        on:pointerdown={(e) => onHandlePointerDown(e, 'end')}
        on:pointermove={onHandlePointerMove}
        on:pointerup={onHandlePointerUp}
        title="Drag to move loop end"
        aria-label="Loop end handle"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M2 1 L8 8 L2 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    {/if}

    <!-- Dragging preview handles -->
    {#if dragging === 'start' && startHandle}
      <div
        class="loop-handle loop-handle-start dragging"
        style="left:{startHandle.x - 20}px; top:{startHandle.y}px; height:{startHandle.h}px"
        on:pointermove={onHandlePointerMove}
        on:pointerup={onHandlePointerUp}
        role="presentation"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M8 1 L2 8 L8 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    {/if}
    {#if dragging === 'end' && endHandle}
      <div
        class="loop-handle loop-handle-end dragging"
        style="left:{endHandle.x}px; top:{endHandle.y}px; height:{endHandle.h}px"
        on:pointermove={onHandlePointerMove}
        on:pointerup={onHandlePointerUp}
        role="presentation"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
          <path d="M2 1 L8 8 L2 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    {/if}

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
      on:animationend={() => { refreshHandles(); refreshTuningLabels(); }}
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

  /* ── Loop resize handles ─────────────────────────────────────────────────── */
  .loop-handle {
    position: absolute;
    width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ew-resize;
    z-index: 20;
    color: #fff;
    background: transparent;
    user-select: none;
    touch-action: none;
  }
  .loop-handle-start { border-right: 3px solid var(--accent); }
  .loop-handle-end   { border-left:  3px solid var(--accent); }

  .loop-handle svg {
    width: 20px;
    height: 20px;
    background: var(--accent);
    border-radius: 50%;
    padding: 4px;
    box-shadow: 0 2px 8px rgba(192,120,56,0.40);
    pointer-events: none;
    flex-shrink: 0;
    overflow: hidden;
  }
  .loop-handle:hover svg,
  .loop-handle.dragging svg {
    background: var(--accent-bright);
    box-shadow: 0 4px 14px rgba(192,120,56,0.55);
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
    background: transparent !important;
    border: 1px solid rgba(192,120,56,0.08) !important;
  }
  :global(.at-cursor-beat) {
    background: rgba(192,120,56,0.25) !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  :global(.at-selection div) {
    background: rgba(192,120,56,0.04) !important;
  }
  :global(.at-selection > div:first-child) {
    border-left: 3px solid var(--accent) !important;
    box-shadow: inset 2px 0 6px rgba(192,120,56,0.18) !important;
  }
  :global(.at-selection > div:last-child) {
    border-right: 3px solid var(--accent) !important;
    box-shadow: inset -2px 0 6px rgba(192,120,56,0.18) !important;
  }
  :global(.at-surface) {
    cursor: default;
  }

</style>
