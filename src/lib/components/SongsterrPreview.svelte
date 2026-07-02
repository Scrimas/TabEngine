<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { instrumentCategory, formatTuning, formatViews } from '$lib/types';
  import type { SongsterrSong } from '$lib/types';
  import { fetchTabBytes, fetchRestrictedTabBytes, selectSong, songsterrStore } from '$lib/stores/songsterr';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';

  export let song: SongsterrSong;

  const dispatch = createEventDispatcher<{ load: { song: SongsterrSong; bytes: Uint8Array }; close: void }>();

  const CATEGORY_COLORS: Record<string, string> = {
    guitar: '#6366f1',
    bass:   '#22c55e',
    drums:  '#f59e0b',
    keys:   '#ec4899',
    other:  '#8b5cf6',
  };

  function difficultyStars(d: number | undefined): string {
    if (!d) return '—';
    return '★'.repeat(d) + '☆'.repeat(Math.max(0, 5 - d));
  }

  async function handleLoad() {
    try {
      let bytes: Uint8Array;
      if (song.restrictionStatus === 'restricted') {
        const slug = song.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const songUrl = `https://www.songsterr.com/a/wsa/${song.artist.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${slug}-tab-s${song.id}`;
        bytes = await fetchRestrictedTabBytes(songUrl, song.title);
      } else {
        bytes = await fetchTabBytes(song.id);
      }
      // Capture `song` from this closure rather than re-reading the store later —
      // the user may have selected a different song while this fetch was in flight.
      dispatch('load', { song, bytes });
    } catch {
      // Error is already stored in songsterrStore
    }
  }

  function handleOpenWeb() {
    const slug = song.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const url = `https://www.songsterr.com/a/wsa/${song.artist.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${slug}-tab-s${song.id}`;
    shellOpen(url);
  }

  function handleClose() {
    selectSong(null);
  }
</script>

<div class="preview-panel" role="dialog" aria-label="Song preview">
  <div class="preview-header">
    <div class="preview-titles">
      <h2 class="preview-title truncate">{song.title}</h2>
      <p class="preview-artist truncate">{song.artist.name}</p>
    </div>
  </div>

  <div class="preview-body">
    <!-- Metadata chips -->
    <div class="meta-chips">
      {#if song.hasPlayer}
        <span class="chip chip-player">▶ Interactive Player</span>
      {/if}
      {#if song.chordsPresent}
        <span class="chip chip-chords">♫ Chords</span>
      {/if}
      {#if song.revisionId}
        <span class="chip chip-rev">Rev #{song.revisionId}</span>
      {/if}
    </div>

    <!-- Track table -->
    <div class="track-section">
      <h3 class="section-label">Tracks ({song.tracks.length})</h3>
      <div class="track-table">
        <div class="track-header">
          <span class="th-name">Name</span>
          <span class="th-tuning">Tuning</span>
          <span class="th-diff">Difficulty</span>
          <span class="th-views">Views</span>
        </div>
        {#each song.tracks as track, i}
          {@const cat = instrumentCategory(track.instrumentId)}
          <div class="track-row" style="animation-delay: {i * 40}ms">
            <div class="track-name">
              <span
                class="track-dot"
                style="background: {CATEGORY_COLORS[cat]}"
              ></span>
              <div class="track-name-text">
                <span class="track-label truncate">{track.name}</span>
                <span class="track-instrument truncate">{track.instrument}</span>
              </div>
            </div>
            <span class="track-tuning mono-nums">
              {track.tuning.length > 0 ? formatTuning(track.tuning) : '—'}
            </span>
            <span class="track-diff" title="{track.difficulty ?? 0}/5">
              {difficultyStars(track.difficulty)}
            </span>
            <span class="track-views mono-nums">
              {track.views ? formatViews(track.views) : '—'}
            </span>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Actions -->
  <div class="preview-actions">
    {#if song.restrictionStatus === 'loading'}
      <div class="restriction-box info">
        <span class="spinner-dark"></span>
        <span>Checking tab availability...</span>
      </div>
    {:else if song.restrictionStatus === 'restricted'}
      <div class="restriction-box warning">
        <svg class="lock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>Copyright-restricted. Available via downloader.</span>
      </div>
    {:else if song.restrictionStatus === 'unpublished'}
      <div class="restriction-box warning">
        <svg class="lock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>This tab is unpublished/private.</span>
      </div>
    {:else if song.restrictionStatus === 'unrestricted'}
      <div class="restriction-box success">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Ready to stream in player.</span>
      </div>
    {/if}

    <button
      class="btn-load press"
      class:disabled-restricted={song.restrictionStatus === 'unpublished'}
      on:click={handleLoad}
      disabled={$songsterrStore.isFetching || song.restrictionStatus === 'loading' || song.restrictionStatus === 'unpublished'}
    >
      {#if $songsterrStore.isFetching}
        <span class="spinner"></span>
        Loading…
      {:else}
        {#if song.restrictionStatus === 'restricted'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Load via Downloader
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8L7 12L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Load in Player
        {/if}
      {/if}
    </button>
    <button
      class="btn-web press"
      class:primary-web={song.restrictionStatus === 'unpublished'}
      on:click={handleOpenWeb}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M6 3H3v10h10v-3M9 3h4v4M14 2L7 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Open on Songsterr
    </button>
  </div>

  {#if $songsterrStore.error}
    <div class="preview-error">{$songsterrStore.error}</div>
  {/if}
</div>

<style>
  .preview-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Header ────────────────────────────────────────────────────────────── */
  .preview-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }



  .preview-titles {
    min-width: 0;
    flex: 1;
  }
  .preview-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.3;
    margin: 0;
  }
  .preview-artist {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }

  /* ── Body ───────────────────────────────────────────────────────────────── */
  .preview-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  /* ── Meta chips ─────────────────────────────────────────────────────────── */
  .meta-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .chip {
    padding: 3px 10px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid;
  }
  .chip-player {
    background: var(--green-dim);
    color: var(--green);
    border-color: rgba(26, 122, 74, 0.25);
  }
  .chip-chords {
    background: rgba(139, 92, 246, 0.12);
    color: #8b5cf6;
    border-color: rgba(139, 92, 246, 0.25);
  }
  .chip-rev {
    background: rgba(43, 40, 35, 0.06);
    color: var(--text-muted);
    border-color: var(--border);
  }

  /* ── Track table ────────────────────────────────────────────────────────── */
  .track-section { margin-top: 4px; }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .track-table {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .track-header {
    display: grid;
    grid-template-columns: 1fr 80px 90px 56px;
    gap: 8px;
    padding: 7px 10px;
    background: var(--bg-hover);
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .track-row {
    display: grid;
    grid-template-columns: 1fr 80px 90px 56px;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-elevated);
    align-items: center;
    animation: fadeInUp 0.3s var(--ease-out) both;
  }

  .track-name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .track-dot {
    width: 8px;
    height: 8px;
    border-radius: 2.5px;
    flex-shrink: 0;
  }
  .track-name-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .track-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .track-instrument {
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .track-tuning {
    font-size: 11px;
    color: var(--text-secondary);
  }
  .track-diff {
    font-size: 11px;
    color: var(--amber);
    letter-spacing: 1px;
  }
  .track-views {
    font-size: 11px;
    color: var(--text-muted);
    text-align: right;
  }

  /* ── Actions ────────────────────────────────────────────────────────────── */
  .preview-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .btn-load {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 20px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 13.5px;
    transition: background var(--transition), box-shadow var(--transition);
  }
  .btn-load:hover:not(:disabled) {
    background: var(--accent-bright);
    box-shadow: var(--shadow-accent);
  }
  .btn-load:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .btn-web {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 12.5px;
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .btn-web:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  /* ── Restriction Boxes ─────────────────────────────────────────────────── */
  .restriction-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.4;
    animation: fadeInUp 0.2s var(--ease-out) both;
  }

  .restriction-box.info {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .restriction-box.warning {
    background: var(--red-dim);
    color: var(--red);
    border: 1px solid rgba(176, 58, 46, 0.12);
  }

  .restriction-box.success {
    background: var(--green-dim);
    color: var(--green);
    border: 1px solid rgba(26, 122, 74, 0.12);
  }

  .lock-icon {
    flex-shrink: 0;
  }

  .spinner-dark {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  .btn-load.disabled-restricted {
    background: var(--bg-hover) !important;
    color: var(--text-muted) !important;
    border: 1px solid var(--border) !important;
    cursor: not-allowed !important;
    opacity: 0.6 !important;
    box-shadow: none !important;
  }

  .btn-web.primary-web {
    background: var(--accent) !important;
    color: #fff !important;
    border: none !important;
    font-weight: 600 !important;
    box-shadow: var(--shadow-sm) !important;
  }
  .btn-web.primary-web:hover {
    background: var(--accent-bright) !important;
    box-shadow: var(--shadow-accent) !important;
  }

  /* ── Spinner ────────────────────────────────────────────────────────────── */
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Error ──────────────────────────────────────────────────────────────── */
  .preview-error {
    padding: 10px 16px;
    background: var(--red-dim);
    color: var(--red);
    font-size: 12px;
    border-top: 1px solid rgba(176, 58, 46, 0.2);
  }
</style>
