<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { songsterrStore, searchDebounced, loadMore, selectSong, resetSongsterr } from '$lib/stores/songsterr';
  import SongsterrResultCard from './SongsterrResultCard.svelte';
  import SongsterrPreview from './SongsterrPreview.svelte';
  import type { SongsterrSong } from '$lib/types';
  import { loadFromBytes } from '$lib/alphatab/AlphaTabManager';
  import { setCurrentSongsterr } from '$lib/stores/library';

  export let open = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  let searchInput: HTMLInputElement;
  let scrollContainer: HTMLDivElement;
  let sentinelEl: HTMLDivElement;

  // ── Focus search input when drawer opens ──────────────────────────────────
  $: if (open && searchInput) {
    requestAnimationFrame(() => searchInput?.focus());
  }

  // ── Intersection observer for infinite scroll ─────────────────────────────
  let observer: IntersectionObserver | null = null;

  onMount(() => {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root: null, threshold: 0 },
    );
  });

  onDestroy(() => {
    observer?.disconnect();
  });

  // Reactive: observe/unobserve sentinel
  $: if (sentinelEl && observer) {
    observer.observe(sentinelEl);
  }

  function handleInput(e: Event) {
    searchDebounced((e.target as HTMLInputElement).value);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if ($songsterrStore.selected) {
        selectSong(null);
      } else {
        dispatch('close');
      }
    }
  }

  function handleSelect(song: SongsterrSong) {
    selectSong(song);
  }

  function handleLoad(e: CustomEvent<Uint8Array>) {
    loadFromBytes(e.detail);
    setCurrentSongsterr($songsterrStore.selected, e.detail);
    dispatch('close');
    resetSongsterr();
  }

  function handleBackdropClick() {
    dispatch('close');
  }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="browser-backdrop"
    on:click={handleBackdropClick}
    on:keydown={handleKeyDown}
    role="presentation"
  ></div>

  <!-- Centering Layout Wrapper (avoids translate vs scale conflicts) -->
  <div class="browser-wrapper" on:keydown={handleKeyDown} role="presentation">
    <!-- Modal Window -->
    <aside
      class="browser-modal glass"
      role="dialog"
      aria-label="Songsterr Browser"
    >
      <!-- Left Pane: Search & Results -->
      <div class="search-pane">
        <!-- Header -->
        <div class="browser-header">
          <div class="header-title-row">
            <svg class="header-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="var(--accent)" stroke-width="1.6"/>
              <path d="M13 13L17 17" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <h2 class="header-title">Browse Songsterr</h2>
          </div>

          <!-- Search input -->
          <div class="search-box">
            <svg class="search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <input
              bind:this={searchInput}
              type="text"
              class="search-input"
              placeholder="Search songs, artists…"
              value={$songsterrStore.query}
              on:input={handleInput}
              on:dragstart|preventDefault
              on:keydown|stopPropagation={(e) => {
                if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.currentTarget.select();
                }
              }}
              spellcheck="false"
              autocomplete="off"
            />
            {#if $songsterrStore.query}
              <button
                class="clear-btn press"
                on:click={() => searchDebounced('')}
                title="Clear search"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </button>
            {/if}
          </div>
        </div>

        <!-- Results scroll container -->
        <div class="results-scroll" bind:this={scrollContainer}>
          {#if $songsterrStore.error && $songsterrStore.results.length === 0}
            <div class="state-message error-state">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="15" stroke="var(--red)" stroke-width="1.5" opacity="0.4"/>
                <path d="M18 12V20M18 24V24.01" stroke="var(--red)" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <p class="state-title">Search failed</p>
              <p class="state-sub">{$songsterrStore.error}</p>
            </div>
          {:else if !$songsterrStore.query.trim()}
            <div class="state-message empty-state">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <rect width="44" height="44" rx="12" fill="rgba(43,40,35,0.04)" stroke="rgba(43,40,35,0.12)" stroke-width="1"/>
                <path d="M15 22C15 18.7 17.7 16 21 16H23C26.3 16 29 18.7 29 22V28H15V22Z" stroke="var(--accent)" stroke-width="1.4" fill="none" opacity="0.6"/>
                <line x1="18" y1="22" x2="18" y2="28" stroke="var(--accent)" stroke-width="1" opacity="0.4"/>
                <line x1="22" y1="20" x2="22" y2="28" stroke="var(--accent)" stroke-width="1" opacity="0.4"/>
                <line x1="26" y1="22" x2="26" y2="28" stroke="var(--accent)" stroke-width="1" opacity="0.4"/>
                <rect x="13" y="28" width="18" height="2" rx="1" fill="var(--accent)" opacity="0.3"/>
              </svg>
              <p class="state-title">Search Songsterr</p>
              <p class="state-sub">Find tabs for any song and load them directly.</p>
            </div>
          {:else if $songsterrStore.results.length === 0 && !$songsterrStore.isSearching}
            <div class="state-message empty-state">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="15" stroke="var(--text-muted)" stroke-width="1.2" opacity="0.3"/>
                <path d="M13 18H23M18 13V23" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" opacity="0.35"/>
              </svg>
              <p class="state-title">No results found</p>
              <p class="state-sub">Try another query.</p>
            </div>
          {:else}
            <div class="results-list">
              {#each $songsterrStore.results as song, i (song.id)}
                <div style="animation-delay: {Math.min(i, 10) * 30}ms" class="result-animate">
                  <SongsterrResultCard
                    {song}
                    active={$songsterrStore.selected?.id === song.id}
                    on:click={() => handleSelect(song)}
                  />
                </div>
              {/each}

              <!-- Loading indicator / sentinel -->
              {#if $songsterrStore.isSearching}
                <div class="loading-indicator">
                  <div class="skeleton-card"></div>
                  <div class="skeleton-card"></div>
                  <div class="skeleton-card"></div>
                </div>
              {:else if $songsterrStore.hasMore}
                <div class="scroll-sentinel" bind:this={sentinelEl}></div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Right Pane: Preview Detail -->
      <div class="preview-pane">
        <!-- Close button for the main dialog -->
        <button class="dialog-close-btn press" on:click={() => dispatch('close')} title="Close (Esc)">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>

        {#if $songsterrStore.selected}
          <SongsterrPreview
            song={$songsterrStore.selected}
            on:load={handleLoad}
          />
        {:else}
          <div class="preview-placeholder">
            <div class="placeholder-content">
              <div class="placeholder-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                  <path d="M9 18V6l10-2v12" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="6.5" cy="18" r="2.5"/>
                  <circle cx="16.5" cy="16" r="2.5"/>
                </svg>
              </div>
              <p class="placeholder-title">Select a Song</p>
              <p class="placeholder-sub">Click a search result on the left to see tracks, tuning, and load options.</p>
            </div>
          </div>
        {/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  /* ── Backdrop ───────────────────────────────────────────────────────────── */
  .browser-backdrop {
    position: fixed !important;
    inset: 0 !important;
    background: rgba(43, 40, 35, 0.22) !important;
    backdrop-filter: blur(4px) !important;
    -webkit-backdrop-filter: blur(4px) !important;
    z-index: 900 !important;
    animation: fadeIn 0.2s var(--ease-out);
  }

  /* ── Wrapper ────────────────────────────────────────────────────────────── */
  .browser-wrapper {
    position: fixed !important;
    inset: 0 !important;
    z-index: 910 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    pointer-events: none !important;
  }

  /* ── Modal Window ───────────────────────────────────────────────────────── */
  .browser-modal {
    pointer-events: auto !important;
    width: 860px;
    height: 580px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    background: rgba(250, 247, 240, 0.90);
    backdrop-filter: blur(28px) saturate(1.3);
    -webkit-backdrop-filter: blur(28px) saturate(1.3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: scaleIn 0.3s var(--ease-out);
  }

  /* ── Panes ──────────────────────────────────────────────────────────────── */
  .search-pane {
    width: 360px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    background: rgba(246, 241, 231, 0.4);
  }

  .preview-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    background: var(--bg-elevated);
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .browser-header {
    padding: 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .header-icon { flex-shrink: 0; }

  .header-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  /* ── Main Close Button ──────────────────────────────────────────────────── */
  .dialog-close-btn {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    z-index: 100;
    transition: background var(--transition), color var(--transition);
  }
  .dialog-close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ── Search box ─────────────────────────────────────────────────────────── */
  .search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 11px;
    color: var(--text-muted);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 9px 34px 9px 34px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    outline: none;
    font-size: 13.5px;
    color: var(--text-primary);
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  .search-input::placeholder {
    color: var(--text-muted);
  }
  .search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }

  .clear-btn {
    position: absolute;
    right: 8px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: background var(--transition), color var(--transition);
  }
  .clear-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ── Results List ───────────────────────────────────────────────────────── */
  .results-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(43,40,35,0.14) transparent;
  }

  .results-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .result-animate {
    animation: fadeInUp 0.3s var(--ease-out) both;
  }

  /* ── Placeholder pane style ──────────────────────────────────────────────── */
  .preview-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-muted);
    text-align: center;
  }
  .placeholder-content {
    max-width: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .placeholder-icon {
    color: var(--accent);
    opacity: 0.6;
    margin-bottom: 4px;
  }
  .placeholder-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .placeholder-sub {
    font-size: 12px;
    line-height: 1.5;
  }

  /* ── State messages ─────────────────────────────────────────────────────── */
  .state-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 60px 16px;
    text-align: center;
  }

  .state-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .state-sub {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .error-state .state-title { color: var(--red); }

  /* ── Skeleton loaders ───────────────────────────────────────────────────── */
  .loading-indicator {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .skeleton-card {
    height: 72px;
    border-radius: var(--radius);
    background: linear-gradient(110deg, var(--bg-hover) 30%, var(--bg-elevated) 50%, var(--bg-hover) 70%);
    background-size: 300% 100%;
    animation: shimmer 1.4s ease infinite;
  }

  .scroll-sentinel {
    height: 1px;
    width: 100%;
  }
</style>
