<script lang="ts">
  /**
   * TrackChannel.svelte
   *
   * A single mixer channel strip: instrument colour badge, name, volume
   * fader, pan display, and Mute / Solo buttons.
   */

  import type { TrackState } from '$lib/types';
  import {
    setTrackVolume,
    setTrackMuted,
    setTrackSoloed,
  } from '$lib/alphatab/AlphaTabManager';
  import { updateTrack } from '$lib/stores/tracks';

  export let track: TrackState;
  export let anySoloed: boolean = false;

  // Derived dim state: dimmed when another track is soloed and this one isn't
  $: dimmed = anySoloed && !track.soloed;

  function handleVolume(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    updateTrack(track.index, { volume: v });
    setTrackVolume(track.index, v);
  }

  function toggleMute() {
    const next = !track.muted;
    updateTrack(track.index, { muted: next });
    setTrackMuted(track.index, next);
  }

  function toggleSolo() {
    const next = !track.soloed;
    updateTrack(track.index, { soloed: next });
    setTrackSoloed(track.index, next);
  }

  // Volume percentage label (alphaTab uses 0–16 scale)
  $: volPct = Math.round((track.volume / 16) * 100);
</script>

<div class="channel" class:dimmed class:muted={track.muted} role="group" aria-label={track.name}>
  <!-- Colour badge + name -->
  <div class="header">
    <div class="color-badge" style="background: {track.color};" aria-hidden="true"></div>
    <span class="name" title={track.name}>{track.name}</span>
  </div>

  <!-- Volume fader -->
  <div class="fader-row">
    <span class="fader-label" aria-hidden="true">VOL</span>
    <div class="fader-wrap">
      <div class="fader-fill" style="width: {volPct}%; background: {track.color}40;"></div>
      <input
        id="vol-{track.index}"
        type="range"
        min="0"
        max="16"
        step="0.5"
        value={track.volume}
        on:input={handleVolume}
        aria-label="Volume for {track.name}"
        style="--thumb-color: {track.color};"
      />
    </div>
    <span class="vol-value" aria-hidden="true">{volPct}%</span>
  </div>

  <!-- Mute / Solo buttons -->
  <div class="btn-row">
    <button
      class="ms-btn mute"
      class:active={track.muted}
      on:click={toggleMute}
      title="Mute {track.name}"
      aria-pressed={track.muted}
    >M</button>
    <button
      class="ms-btn solo"
      class:active={track.soloed}
      on:click={toggleSolo}
      title="Solo {track.name}"
      aria-pressed={track.soloed}
    >S</button>
    <span class="short-name" aria-hidden="true">{track.shortName || track.name.slice(0,3)}</span>
  </div>
</div>

<style>
  .channel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    transition: opacity var(--transition), background var(--transition),
                border-color var(--transition), transform var(--transition),
                box-shadow var(--transition);
  }
  .channel:hover {
    background: var(--bg-hover);
    border-color: var(--border-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }
  .channel.dimmed {
    opacity: 0.35;
  }
  .channel.muted .header .name {
    text-decoration: line-through;
    opacity: 0.5;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .color-badge {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 6px currentColor;
  }
  .name {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  /* Fader */
  .fader-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fader-label {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.06em;
    width: 24px;
    flex-shrink: 0;
  }
  .fader-wrap {
    position: relative;
    flex: 1;
  }
  .fader-fill {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 3px;
    border-radius: 2px;
    pointer-events: none;
    transition: width 0.08s linear;
  }
  .fader-wrap input[type=range] {
    width: 100%;
    position: relative;
    z-index: 1;
  }
  .fader-wrap input[type=range]::-webkit-slider-thumb {
    background: var(--thumb-color, var(--accent));
    box-shadow: 0 0 8px var(--thumb-color, var(--accent-glow));
  }
  .vol-value {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--text-secondary);
    width: 34px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  /* Mute / Solo */
  .btn-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ms-btn {
    width: 28px;
    height: 22px;
    border-radius: 5px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    border: 1px solid var(--border);
    background: rgba(43,40,35,0.05);
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition),
                border-color var(--transition), box-shadow var(--transition),
                transform 120ms var(--ease-spring);
  }
  .ms-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .ms-btn:active { transform: scale(0.92); }
  .ms-btn.mute.active {
    background: var(--red-dim);
    border-color: rgba(248,113,113,0.45);
    color: var(--red);
    box-shadow: 0 0 10px rgba(248,113,113,0.22);
  }
  .ms-btn.solo.active {
    background: var(--amber-dim);
    border-color: rgba(251,191,36,0.45);
    color: var(--amber);
    box-shadow: 0 0 10px rgba(251,191,36,0.22);
  }
  .short-name {
    font-size: 0.65rem;
    color: var(--text-muted);
    margin-left: auto;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
