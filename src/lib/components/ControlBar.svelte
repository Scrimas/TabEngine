<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    stop, playPause,
    setMetronomeEnabled, setPlaybackSpeed,
    seekToFraction, setLooping,
  } from '$lib/alphatab/AlphaTabManager';
  import { playerStore } from '$lib/stores/player';
  import { libraryStore } from '$lib/stores/library';
  import { settingsStore, updateSettings } from '$lib/stores/settings';
  import { formatTime } from '$lib/types';

  const dispatch = createEventDispatcher<{ download: void }>();

  let draggingScrubber = false;
  let scrubberPreview  = 0;

  function onScrubInput(e: Event) {
    draggingScrubber = true;
    scrubberPreview = Number((e.target as HTMLInputElement).value) / 1000;
  }
  function onScrubChange(e: Event) {
    const frac = Number((e.target as HTMLInputElement).value) / 1000;
    seekToFraction(frac);
    draggingScrubber = false;
  }

  $: displayProgress = draggingScrubber
    ? scrubberPreview
    : ($playerStore.totalTicks > 0 ? $playerStore.currentTick / $playerStore.totalTicks : 0);

  $: displayTime  = formatTime($playerStore.currentTime);
  $: displayTotal = formatTime($playerStore.totalTime);

  function toggleMetronome() { setMetronomeEnabled(!$playerStore.metronomeEnabled); }
  function toggleLoop()      { setLooping(!$playerStore.isLooping); }
  function triggerDownload() { dispatch('download'); }

  $: canPlay = $playerStore.isReady;

  // Popovers are position:fixed and anchored via getBoundingClientRect() rather
  // than CSS position:absolute — the control bar (and its ancestors) use
  // overflow:hidden for layout clipping, which would otherwise clip/occlude an
  // absolutely-positioned popover under sibling panels like the Mixer.
  function anchoredStyle(el: HTMLElement): string {
    const rect = el.getBoundingClientRect();
    const bottom = window.innerHeight - rect.top + 10;
    const right  = window.innerWidth - rect.right;
    return `position: fixed; bottom: ${bottom}px; right: ${right}px;`;
  }

  // ── Metronome volume popover ──────────────────────────────────────────────
  let showMetronomePopover = false;
  let metronomePopoverStyle = '';
  let metronomeAnchorEl: HTMLDivElement;
  function toggleMetronomePopover() {
    showTempoPopover = false;
    showMetronomePopover = !showMetronomePopover;
    if (showMetronomePopover) metronomePopoverStyle = anchoredStyle(metronomeAnchorEl);
  }

  // ── Tempo popover ("Compact strip" design) ─────────────────────────────────
  const SPEED_MIN  = 10;   // % — matches setPlaybackSpeed's 0.1x clamp
  const SPEED_MAX  = 200;  // % — matches setPlaybackSpeed's 2.0x clamp
  const SPEED_STEP = 5;    // % — snap increment for drag / +- / keyboard
  const SPEED_LABELED = [10, 25, 50, 75, 100, 125, 150, 175, 200];

  function pctToLeft(pct: number): number {
    return (pct - SPEED_MIN) / (SPEED_MAX - SPEED_MIN) * 100;
  }
  const SPEED_TICKS = (() => {
    const out: { left: number; h: number; major: boolean }[] = [];
    for (let v = SPEED_MIN; v <= SPEED_MAX; v += 5) {
      const major = SPEED_LABELED.includes(v);
      out.push({ left: pctToLeft(v), h: major ? 16 : 8, major });
    }
    return out;
  })();
  const SPEED_LABELS = SPEED_LABELED.map(v => ({ v, left: pctToLeft(v) }));

  let showTempoPopover = false;
  let tempoPopoverStyle = '';
  let bpmBadgeEl: HTMLButtonElement;
  function toggleTempoPopover() {
    showMetronomePopover = false;
    showTempoPopover = !showTempoPopover;
    if (showTempoPopover) tempoPopoverStyle = anchoredStyle(bpmBadgeEl);
  }

  $: speedPct     = Math.round($playerStore.playbackSpeed * 100);
  $: effectiveBpm = Math.round($playerStore.tempo * $playerStore.playbackSpeed);
  $: rulerLeft    = pctToLeft(speedPct);

  function snapToStep(pct: number): number {
    return Math.round(pct / SPEED_STEP) * SPEED_STEP;
  }
  function applySpeedPct(pct: number, snap = false) {
    const value = snap ? snapToStep(pct) : pct;
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, value));
    setPlaybackSpeed(clamped / 100);
  }
  function nudgeSpeedPct(delta: number) { applySpeedPct(speedPct + delta, true); }
  function resetSpeed() { applySpeedPct(100); }

  function onMetronomeVolumeInput(e: Event) {
    updateSettings({ metronomeVolume: Number((e.target as HTMLInputElement).value) });
  }
  function onBpmInput(e: Event) {
    const bpm = Number((e.currentTarget as HTMLInputElement).value);
    if (!bpm || $playerStore.tempo <= 0) return;
    applySpeedPct((bpm / $playerStore.tempo) * 100);
  }

  let draggingRuler = false;
  function applyRulerPointer(e: PointerEvent, ruler: HTMLElement) {
    const rect = ruler.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    applySpeedPct(SPEED_MIN + frac * (SPEED_MAX - SPEED_MIN), true);
  }
  function onRulerPointerDown(e: PointerEvent) {
    const ruler = e.currentTarget as HTMLElement;
    draggingRuler = true;
    ruler.setPointerCapture?.(e.pointerId);
    applyRulerPointer(e, ruler);
  }
  function onRulerPointerMove(e: PointerEvent) {
    if (draggingRuler) applyRulerPointer(e, e.currentTarget as HTMLElement);
  }
  function onRulerPointerUp() { draggingRuler = false; }

  // Attached to the popover container (not just the ruler) so +/- work as
  // soon as the popover opens, without requiring an extra click to focus the
  // ruler first. Ignores keydowns from the BPM input so typing e.g. "120"
  // isn't hijacked by the '0' reset shortcut.
  function onTempoKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    // Arrow keys are reserved for scrubbing the playback position elsewhere in
    // the app, so tempo stepping only responds to +/- (not arrows).
    if (e.key === '+' || e.key === '=') {
      e.preventDefault(); nudgeSpeedPct(SPEED_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault(); nudgeSpeedPct(-SPEED_STEP);
    } else if (e.key === '0') {
      e.preventDefault(); resetSpeed();
    }
  }
  function autofocus(node: HTMLElement) { node.focus(); }

  // ── Shared popover dismissal ────────────────────────────────────────────────
  function clickOutside(node: HTMLElement, onOutside: () => void) {
    function handleClick(e: MouseEvent) {
      if (!node.contains(e.target as Node)) onOutside();
    }
    document.addEventListener('mousedown', handleClick, true);
    return {
      destroy() { document.removeEventListener('mousedown', handleClick, true); },
    };
  }
  function closeMetronomePopover() { showMetronomePopover = false; }
  function closeTempoPopover()     { showTempoPopover = false; }
</script>

<footer class="control-bar" aria-label="Playback controls">

  <!-- Stop + Play -->
  <div class="transport">
    <button class="stop-btn" on:click={stop} disabled={!canPlay}
            title="Stop" aria-label="Stop">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2.5"/>
      </svg>
    </button>

    <button
      class="play-btn"
      class:playing={$playerStore.isPlaying}
      on:click={playPause}
      disabled={!canPlay}
      title={$playerStore.isPlaying ? 'Pause' : 'Play'}
      aria-label={$playerStore.isPlaying ? 'Pause' : 'Play'}
    >
      {#if $playerStore.isPlaying}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1.3"/>
          <rect x="14" y="5" width="4" height="14" rx="1.3"/>
        </svg>
      {:else}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-left:2px" aria-hidden="true">
          <path d="M8 5v14l11-7z"/>
        </svg>
      {/if}
    </button>
  </div>

  <!-- Elapsed time -->
  <span class="time-display" aria-live="off" aria-label="Elapsed time">{displayTime}</span>

  <!-- Scrubber -->
  <div class="scrubber-wrap">
    <div class="scrubber-fill" style="width:{displayProgress * 100}%"></div>
    <input
      type="range"
      min="0"
      max="1000"
      step="1"
      value={Math.round(displayProgress * 1000)}
      on:input={onScrubInput}
      on:change={onScrubChange}
      disabled={!canPlay}
      aria-label="Playback position"
      aria-valuetext="{displayTime} of {displayTotal}"
    />
  </div>

  <!-- Total time -->
  <span class="time-display total" aria-label="Total duration">{displayTotal}</span>

  <!-- Right controls -->
  <div class="right-ctrl">
    <!-- BPM badge (opens tempo popover) -->
    <div class="popover-anchor" use:clickOutside={closeTempoPopover}>
      <button
        class="bpm-badge"
        class:active={showTempoPopover}
        on:click={toggleTempoPopover}
        bind:this={bpmBadgeEl}
        title="Tempo"
        aria-label="Tempo: {effectiveBpm} BPM"
        aria-expanded={showTempoPopover}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 4h4l3 16H7z"/><line x1="12" y1="20" x2="15.5" y2="8"/>
        </svg>
        <span class="bpm-val">{effectiveBpm}</span>
        <span class="bpm-unit">BPM</span>
      </button>

      {#if showTempoPopover}
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div
          class="popover tempo-popover"
          style={tempoPopoverStyle}
          tabindex="-1"
          role="group"
          aria-label="Tempo controls"
          use:autofocus
          on:keydown={onTempoKeydown}
        >
          <div class="strip-header">
            <button class="strip-btn" on:click={() => nudgeSpeedPct(-SPEED_STEP)} aria-label="Decrease tempo">−</button>
            <div class="strip-bpm">
              <input
                class="strip-bpm-input"
                type="number"
                min={Math.round($playerStore.tempo * SPEED_MIN / 100)}
                max={Math.round($playerStore.tempo * SPEED_MAX / 100)}
                value={effectiveBpm}
                on:change={onBpmInput}
                aria-label="Tempo in BPM"
              />
              <span class="strip-bpm-unit">bpm</span>
              <span class="strip-bpm-song">/ {$playerStore.tempo}</span>
            </div>
            <button class="strip-btn" on:click={() => nudgeSpeedPct(SPEED_STEP)} aria-label="Increase tempo">+</button>
            <div class="strip-spacer"></div>
            <div class="strip-pct-chip">{speedPct}%</div>
            <button class="strip-btn" on:click={resetSpeed} title="Reset to 100%" aria-label="Reset tempo to 100%">↺</button>
          </div>

          <div
            class="strip-ruler"
            role="slider"
            aria-valuemin={SPEED_MIN}
            aria-valuemax={SPEED_MAX}
            aria-valuenow={speedPct}
            aria-label="Playback speed percentage"
            on:pointerdown={onRulerPointerDown}
            on:pointermove={onRulerPointerMove}
            on:pointerup={onRulerPointerUp}
          >
            <div class="strip-track"></div>
            <div class="strip-track-fill" style="width:{rulerLeft}%"></div>
            {#each SPEED_TICKS as tick}
              <div class="strip-tick" class:major={tick.major} style="left:{tick.left}%; height:{tick.h}px;"></div>
            {/each}
            {#each SPEED_LABELS as label}
              <div class="strip-tick-label" class:base={label.v === 100} style="left:{label.left}%">{label.v}</div>
            {/each}
            <div class="strip-thumb-pin" style="left:{rulerLeft}%"></div>
            <div class="strip-thumb-dot" style="left:{rulerLeft}%"></div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Metronome toggle + volume popover -->
    <div class="popover-anchor metronome-group" use:clickOutside={closeMetronomePopover} bind:this={metronomeAnchorEl}>
      <button
        class="icon-toggle"
        class:active={$playerStore.metronomeEnabled}
        on:click={toggleMetronome}
        title="Metronome"
        aria-pressed={$playerStore.metronomeEnabled}
        aria-label="Metronome"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 4h4l3 16H7z"/><line x1="12" y1="20" x2="15.5" y2="8"/>
        </svg>
      </button>
      <button
        class="caret-btn"
        class:active={showMetronomePopover}
        on:click={toggleMetronomePopover}
        title="Metronome volume"
        aria-label="Metronome volume"
        aria-expanded={showMetronomePopover}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {#if showMetronomePopover}
        <div class="popover volume-popover" style={metronomePopoverStyle}>
          <span class="popover-title">Metronome Volume</span>
          <div class="volume-row">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={$settingsStore.metronomeVolume}
              on:input={onMetronomeVolumeInput}
              aria-label="Metronome volume"
            />
            <span class="value-display">{$settingsStore.metronomeVolume}%</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Loop toggle -->
    <button
      class="icon-toggle"
      class:active={$playerStore.isLooping}
      on:click={toggleLoop}
      title="Toggle loop"
      aria-pressed={$playerStore.isLooping}
      aria-label="Loop"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a6 6 0 0 1 6-6h9"/>
        <path d="M15 3l3 3-3 3"/>
        <path d="M21 12a6 6 0 0 1-6 6H6"/>
        <path d="M9 21l-3-3 3-3"/>
      </svg>
    </button>

    <!-- Download to Library -->
    {#if $libraryStore.currentSongsterrSong}
      <button
        class="icon-toggle download-btn"
        on:click={triggerDownload}
        title="Download to library"
        aria-label="Download tab"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    {/if}
  </div>

</footer>

<style>
  .control-bar {
    grid-area: f;
    height: var(--control-bar-height);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 18px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    overflow: hidden;
  }

  /* ── Transport ──────────────────────────────────────────────────────────── */
  .transport {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  }

  .stop-btn {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition), color var(--transition), border-color var(--transition);
  }
  .stop-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .stop-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .play-btn {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: #fff;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(192, 120, 56, 0.38);
    transition: filter var(--transition), transform 140ms var(--ease-spring),
                box-shadow var(--transition);
    flex-shrink: 0;
  }
  .play-btn:hover:not(:disabled) { filter: brightness(1.08); }
  .play-btn:active:not(:disabled) { transform: scale(0.95); }
  .play-btn.playing { animation: pulse-glow 2.4s var(--ease-out) infinite; }
  .play-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }

  /* ── Timeline ───────────────────────────────────────────────────────────── */
  .time-display {
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 38px;
    text-align: right;
  }
  .time-display.total {
    color: var(--text-secondary);
    text-align: left;
  }

  .scrubber-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .scrubber-fill {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 4px;
    background: linear-gradient(90deg, var(--accent), var(--accent-bright));
    border-radius: 3px;
    pointer-events: none;
    box-shadow: 0 0 8px rgba(192,120,56,0.38);
  }
  .scrubber-wrap input[type=range] {
    width: 100%;
    position: relative;
    z-index: 1;
  }
  .scrubber-wrap input[type=range]::-webkit-slider-runnable-track {
    background: rgba(43,40,35,0.12);
  }

  /* ── Right controls ─────────────────────────────────────────────────────── */
  .right-ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .bpm-badge {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border-radius: 9px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition);
  }
  .bpm-badge:hover, .bpm-badge.active {
    background: var(--accent-dim);
    border-color: var(--accent-glow);
  }
  .bpm-val {
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .bpm-unit {
    font-size: 11px;
    color: var(--text-muted);
  }

  /* ── Popovers (tempo + metronome volume) ───────────────────────────────────── */
  .popover-anchor {
    position: relative;
  }
  .metronome-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .caret-btn {
    width: 18px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .caret-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .caret-btn.active {
    background: var(--accent-dim);
    color: var(--accent);
    border-color: var(--accent-glow);
  }

  .popover {
    /* position: fixed + inset are set inline (see anchoredStyle in <script>) so
       the popover escapes the control bar's overflow:hidden clipping and paints
       above sibling panels (e.g. the Mixer) instead of underneath them. */
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px 16px;
    z-index: 1000;
  }

  /* Metronome volume popover */
  .volume-popover {
    width: 200px;
  }
  .popover-title {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 10px;
  }
  .volume-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .volume-row input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .value-display {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 32px;
    text-align: right;
  }

  /* Tempo popover — "Compact strip" design: one-row header with % chip,
     hanging ticks below the ruler, diamond pin thumb. */
  .tempo-popover {
    width: 340px;
    padding: 16px 20px 14px;
  }
  .tempo-popover:focus {
    /* Autofocused on open so +/- and 0 work immediately — not a
       keyboard-navigated target, so the default focus ring is not useful. */
    outline: none;
  }

  .strip-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .strip-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    transition: background var(--transition), color var(--transition), border-color var(--transition);
  }
  .strip-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  .strip-bpm {
    display: flex;
    align-items: baseline;
    justify-content: center;
    min-width: 100px;
  }
  .strip-bpm-input {
    width: 4ch;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    text-align: right;
  }
  .strip-bpm-input:focus {
    outline: none;
  }
  .strip-bpm-input::-webkit-inner-spin-button,
  .strip-bpm-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .strip-bpm-input[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .strip-bpm-unit {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-left: 4px;
  }
  .strip-bpm-song {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 4px;
  }

  .strip-spacer {
    flex: 1;
  }
  .strip-pct-chip {
    padding: 4px 11px;
    border-radius: 99px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    color: var(--accent);
    font-weight: 700;
    font-size: 13px;
    white-space: nowrap;
  }

  .strip-ruler {
    position: relative;
    height: 86px;
    margin-top: 18px;
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }
  .strip-track {
    position: absolute;
    left: 0;
    right: 0;
    top: 36px;
    height: 2px;
    border-radius: 2px;
    background: var(--border);
  }
  .strip-track-fill {
    position: absolute;
    left: 0;
    top: 36px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0.9;
  }
  .strip-tick {
    position: absolute;
    top: 42px;
    width: 1px;
    background: var(--border);
  }
  .strip-tick.major {
    background: var(--border-hover);
  }
  .strip-tick-label {
    position: absolute;
    top: 63px;
    transform: translateX(-50%);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .strip-tick-label.base {
    color: var(--text-primary);
    font-weight: 700;
  }
  .strip-thumb-pin {
    position: absolute;
    top: 16px;
    width: 26px;
    height: 26px;
    transform: translate(-50%, -50%) rotate(45deg);
    border-radius: 50% 50% 0 50%;
    background: var(--bg-elevated);
    border: 1px solid var(--border-hover);
    box-shadow: var(--shadow-sm);
  }
  .strip-thumb-dot {
    position: absolute;
    top: 14px;
    width: 9px;
    height: 9px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--accent);
  }

  .icon-toggle {
    width: 34px;
    height: 32px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .icon-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .icon-toggle.active {
    background: var(--accent-dim);
    color: var(--accent);
    border-color: var(--accent-glow);
  }
</style>
