<script lang="ts">
  import { instrumentCategory, formatViews } from '$lib/types';
  import type { SongsterrSong } from '$lib/types';

  export let song: SongsterrSong;
  export let active = false;

  // Deduplicate instrument categories present in this song's tracks
  $: categories = [...new Set(song.tracks.map(t => instrumentCategory(t.instrumentId)))];

  // Highest view count across all tracks as a popularity proxy
  $: topViews = Math.max(...song.tracks.map(t => t.views ?? 0), 0);

  const CATEGORY_COLORS: Record<string, string> = {
    guitar: '#6366f1',
    bass:   '#22c55e',
    drums:  '#f59e0b',
    keys:   '#ec4899',
    other:  '#8b5cf6',
  };

  const CATEGORY_LABELS: Record<string, string> = {
    guitar: 'Guitar',
    bass:   'Bass',
    drums:  'Drums',
    keys:   'Keys',
    other:  'Other',
  };

  const CATEGORY_ICONS: Record<string, string> = {
    guitar: '🎸',
    bass:   '🎸',
    drums:  '🥁',
    keys:   '🎹',
    other:  '🎵',
  };
</script>

<button
  class="result-card lift"
  class:active
  on:click
  title="{song.title} — {song.artist.name}"
>
  <div class="card-main">
    <div class="card-text">
      <span class="song-title truncate">{song.title}</span>
      <span class="song-artist truncate">{song.artist.name}</span>
    </div>
    <div class="card-meta">
      {#if topViews > 0}
        <span class="views mono-nums" title="{topViews.toLocaleString()} views">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 3C4.5 3 1.7 5.1 1 8c.7 2.9 3.5 5 7 5s6.3-2.1 7-5c-.7-2.9-3.5-5-7-5z" stroke="currentColor" stroke-width="1.2" fill="none"/>
            <circle cx="8" cy="8" r="2" fill="currentColor"/>
          </svg>
          {formatViews(topViews)}
        </span>
      {/if}
      <span class="track-count">{song.tracks.length} track{song.tracks.length !== 1 ? 's' : ''}</span>
    </div>
  </div>
  <div class="card-badges">
    {#each categories as cat}
      <span
        class="instrument-badge"
        style="background: {CATEGORY_COLORS[cat]}22; color: {CATEGORY_COLORS[cat]}; border-color: {CATEGORY_COLORS[cat]}44;"
      >
        {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
      </span>
    {/each}
    {#if song.chordsPresent}
      <span class="instrument-badge chord-badge">♫ Chords</span>
    {/if}
  </div>
</button>

<style>
  .result-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: transparent;
    border: 1px solid transparent;
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition),
                box-shadow var(--transition);
  }
  .result-card:hover {
    background: var(--bg-elevated);
    border-color: var(--border);
  }
  .result-card.active {
    background: var(--accent-dim);
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px rgba(192, 120, 56, 0.12);
  }

  .card-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }

  .card-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .song-title {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--text-primary);
    line-height: 1.3;
  }
  .song-artist {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.3;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .views {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .views svg { opacity: 0.6; }

  .track-count {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .card-badges {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .instrument-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 500;
    border: 1px solid;
    white-space: nowrap;
    line-height: 1.4;
  }

  .chord-badge {
    background: rgba(139, 92, 246, 0.12);
    color: #8b5cf6;
    border-color: rgba(139, 92, 246, 0.25);
  }
</style>
