<script lang="ts">
  import { tracksStore, anySoloed } from '$lib/stores/tracks';
  import { playerStore } from '$lib/stores/player';
  import { setMasterVolume } from '$lib/alphatab/AlphaTabManager';
  import TrackChannel from './TrackChannel.svelte';

  // Single source of truth is the player store (setMasterVolume writes it) —
  // a local copy would silently drift from the actual synth volume.
  $: masterVolume = $playerStore.masterVolume;

  function onMasterVolume(e: Event) {
    setMasterVolume(Number((e.target as HTMLInputElement).value));
  }
</script>

<aside class="mixer" aria-label="Mixer">

  <!-- Header -->
  <header class="mixer-header">
    <div class="header-left">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
        <line x1="4" y1="6"  x2="20" y2="6"/>
        <line x1="4" y1="12" x2="12" y2="12"/>
        <line x1="4" y1="18" x2="17" y2="18"/>
        <circle cx="16" cy="6"  r="2.5" fill="currentColor" stroke="none"/>
        <circle cx="8"  cy="12" r="2.5" fill="currentColor" stroke="none"/>
        <circle cx="13" cy="18" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
      <span class="mixer-label">Mixer</span>
    </div>
    <span class="track-badge">
      {$tracksStore.length} {$tracksStore.length === 1 ? 'track' : 'tracks'}
    </span>
  </header>

  <!-- MASTER section -->
  <div class="master-section">
    <div class="master-top">
      <span class="master-label">Master</span>
      <span class="master-vol">{masterVolume}%</span>
    </div>

    <!-- Master volume slider -->
    <div class="master-fader-wrap">
      <div class="master-fill" style="width:{masterVolume}%"></div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={masterVolume}
        on:input={onMasterVolume}
        aria-label="Master volume"
      />
    </div>
  </div>

  <!-- Track channel list -->
  <div class="channel-list" role="list">
    {#if $tracksStore.length === 0}
      <div class="empty-state" aria-live="polite">
        <p>No score loaded.</p>
        <p>Open a Guitar Pro file to see tracks here.</p>
      </div>
    {:else}
      {#each $tracksStore as track (track.index)}
        <div role="listitem">
          <TrackChannel {track} anySoloed={$anySoloed} />
        </div>
      {/each}
    {/if}
  </div>

</aside>

<style>
  .mixer {
    grid-area: m;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-left: 1px solid var(--border);
    overflow: hidden;
    min-height: 0;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .mixer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--accent);
  }

  .mixer-label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 1.3px;
    text-transform: uppercase;
    color: var(--text-primary);
  }

  .track-badge {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
  }

  /* ── MASTER section ─────────────────────────────────────────────────────── */
  .master-section {
    padding: 14px 16px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .master-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .master-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.1px;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .master-vol {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  .master-fader-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .master-fill {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 4px;
    background: linear-gradient(90deg, var(--accent), var(--accent-bright));
    border-radius: 3px;
    pointer-events: none;
    box-shadow: 0 0 8px rgba(217, 138, 82,0.30);
  }

  .master-fader-wrap input[type=range] {
    width: 100%;
    position: relative;
    z-index: 1;
  }

  .master-fader-wrap input[type=range]::-webkit-slider-runnable-track {
    background: var(--slider-track);
  }

  /* ── Track channel list ─────────────────────────────────────────────────── */
  .channel-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 40px 20px;
    text-align: center;
    flex: 1;
  }

  .empty-state p {
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .empty-state p:first-child {
    font-weight: 500;
    color: var(--text-secondary);
  }
</style>
