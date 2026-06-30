<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    stop, playPause,
    setMetronomeEnabled,
    seekToFraction, setLooping,
  } from '$lib/alphatab/AlphaTabManager';
  import { playerStore } from '$lib/stores/player';
  import { libraryStore } from '$lib/stores/library';
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
    <!-- BPM badge -->
    <div class="bpm-badge" title="Tempo" aria-label="Tempo: {$playerStore.tempo} BPM">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
           stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 4h4l3 16H7z"/><line x1="12" y1="20" x2="15.5" y2="8"/>
      </svg>
      <span class="bpm-val">{$playerStore.tempo}</span>
      <span class="bpm-unit">BPM</span>
    </div>

    <!-- Metronome toggle -->
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
