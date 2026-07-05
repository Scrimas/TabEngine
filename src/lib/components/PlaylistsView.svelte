<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import {
    playlistsStore, createPlaylist, renamePlaylist, deletePlaylist,
    removeFromPlaylist, startQueue, activeQueueStore,
  } from '$lib/stores/playlists';
  import { libraryStore, recordOpen } from '$lib/stores/library';
  import PlaylistSongList from './PlaylistSongList.svelte';
  import type { Playlist, LibraryEntry } from '$lib/types';

  export let open = false;

  const dispatch = createEventDispatcher<{ close: void; load: string }>();

  let selectedId: string | null = null;

  $: if (open && selectedId === null && $playlistsStore.length > 0) {
    selectedId = $playlistsStore[0].id;
  }

  $: selectedPlaylist = $playlistsStore.find(p => p.id === selectedId) ?? null;

  $: songs = (selectedPlaylist?.paths ?? [])
    .map(path => $libraryStore.entries.find(e => e.path === path))
    .filter((e): e is LibraryEntry => !!e);

  function handleKeyDown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') dispatch('close');
  }

  function handleBackdropClick() {
    dispatch('close');
  }

  // ── Create / rename / delete playlists ──────────────────────────────────────
  let editingId: string | null = null;
  let editingName = '';
  let renameInputEl: HTMLInputElement | null = null;

  async function startRename(p: Playlist) {
    editingId = p.id;
    editingName = p.name;
    await tick();
    renameInputEl?.focus();
    renameInputEl?.select();
  }

  function handleCreate() {
    const playlist = createPlaylist('New Playlist');
    selectedId = playlist.id;
    startRename(playlist);
  }

  function commitRename(p: Playlist) {
    const name = editingName.trim();
    if (name && name !== p.name) renamePlaylist(p.id, name);
    editingId = null;
    editingName = '';
  }

  function handleDelete(p: Playlist) {
    const yes = confirm(`Delete playlist "${p.name}"? This only removes the playlist, not the songs.`);
    if (!yes) return;
    deletePlaylist(p.id);
    if (selectedId === p.id) selectedId = $playlistsStore.find(x => x.id !== p.id)?.id ?? null;
  }

  // ── Playback ─────────────────────────────────────────────────────────────────
  function playFrom(path: string) {
    if (!selectedPlaylist) return;
    const loadPath = startQueue(selectedPlaylist.id, path);
    if (!loadPath) return;
    const entry = $libraryStore.entries.find(e => e.path === loadPath);
    if (entry) recordOpen(entry);
    dispatch('load', loadPath);
    dispatch('close');
  }

  function playFromStart() {
    if (!selectedPlaylist) return;
    const loadPath = startQueue(selectedPlaylist.id);
    if (!loadPath) return;
    const entry = $libraryStore.entries.find(e => e.path === loadPath);
    if (entry) recordOpen(entry);
    dispatch('load', loadPath);
    dispatch('close');
  }

  function handleRemoveSong(path: string) {
    if (!selectedPlaylist) return;
    removeFromPlaylist(selectedPlaylist.id, path);
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="playlists-backdrop"
    on:click={handleBackdropClick}
    on:keydown={handleKeyDown}
    role="presentation"
  ></div>

  <div class="playlists-wrapper" on:keydown={handleKeyDown} role="presentation">
    <aside class="playlists-modal glass" role="dialog" aria-label="Playlists">
      <!-- Left Pane: playlist list -->
      <div class="playlist-pane">
        <div class="playlist-pane-header">
          <h2>Playlists</h2>
          <button class="new-playlist-btn press" on:click={handleCreate} title="New playlist" aria-label="New playlist">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

        <div class="playlist-list" role="list">
          {#if $playlistsStore.length === 0}
            <p class="empty-msg">No playlists yet.</p>
          {:else}
            {#each $playlistsStore as playlist (playlist.id)}
              {@const active = selectedId === playlist.id}
              {@const isEditing = editingId === playlist.id}
              <!-- svelte-ignore a11y-interactive-supports-focus a11y-no-noninteractive-tabindex -->
              <div
                class="playlist-row"
                class:active
                role="button"
                tabindex={isEditing ? -1 : 0}
                on:click={() => { selectedId = playlist.id; }}
                on:keydown={(e) => { if (e.key === 'Enter') selectedId = playlist.id; }}
              >
                {#if isEditing}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <input
                    class="rename-input"
                    bind:this={renameInputEl}
                    bind:value={editingName}
                    on:click|stopPropagation
                    on:keydown|stopPropagation={(e) => {
                      if (e.key === 'Enter') commitRename(playlist);
                      else if (e.key === 'Escape') { editingId = null; editingName = ''; }
                    }}
                    on:blur={() => commitRename(playlist)}
                    aria-label="Rename playlist"
                  />
                {:else}
                  <span class="playlist-name">{playlist.name}</span>
                  <span class="playlist-count">{playlist.paths.length}</span>
                  <button
                    class="row-icon-btn"
                    title="Rename playlist"
                    aria-label="Rename {playlist.name}"
                    on:click|stopPropagation={() => startRename(playlist)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button
                    class="row-icon-btn danger"
                    title="Delete playlist"
                    aria-label="Delete {playlist.name}"
                    on:click|stopPropagation={() => handleDelete(playlist)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Right Pane: selected playlist's songs -->
      <div class="songs-pane">
        <button class="dialog-close-btn press" on:click={() => dispatch('close')} title="Close (Esc)">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>

        {#if !selectedPlaylist}
          <div class="songs-placeholder">
            <p>Select or create a playlist to see its songs.</p>
          </div>
        {:else}
          <div class="songs-header">
            <h3>{selectedPlaylist.name}</h3>
            {#if songs.length > 0}
              <button class="play-all-btn press" on:click={playFromStart}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Play
              </button>
            {/if}
          </div>

          <PlaylistSongList
            playlist={selectedPlaylist}
            {songs}
            currentPath={$activeQueueStore.playlistId === selectedPlaylist.id ? $activeQueueStore.currentPath : null}
            on:play={(e) => playFrom(e.detail)}
            on:remove={(e) => handleRemoveSong(e.detail)}
          />
        {/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  /* ── Backdrop / Wrapper ─────────────────────────────────────────────────── */
  .playlists-backdrop {
    position: fixed !important;
    inset: 0 !important;
    background: rgba(43, 40, 35, 0.22) !important;
    backdrop-filter: blur(4px) !important;
    -webkit-backdrop-filter: blur(4px) !important;
    z-index: 900 !important;
    animation: fadeIn 0.2s var(--ease-out);
  }

  .playlists-wrapper {
    position: fixed !important;
    inset: 0 !important;
    z-index: 910 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    pointer-events: none !important;
  }

  .playlists-modal {
    pointer-events: auto !important;
    width: 780px;
    height: 540px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    background: var(--bg-modal);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: scaleIn 0.3s var(--ease-out);
  }

  /* ── Left pane: playlists ───────────────────────────────────────────────── */
  .playlist-pane {
    width: 260px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    background: var(--bg-pane);
  }

  .playlist-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
  }
  .playlist-pane-header h2 {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .new-playlist-btn {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-dim);
    border: 1px solid rgba(192, 120, 56, 0.32);
    color: var(--accent);
    cursor: pointer;
  }
  .new-playlist-btn:hover {
    background: rgba(192, 120, 56, 0.24);
  }

  .playlist-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .empty-msg {
    padding: 20px 12px;
    text-align: center;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .playlist-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border-radius: 10px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background var(--transition), border-color var(--transition);
  }
  .playlist-row:hover { background: rgba(43,40,35,0.05); }
  .playlist-row.active {
    background: var(--bg-elevated);
    border-color: var(--border-hover);
  }

  .playlist-name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .playlist-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }

  .rename-input {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 2px 6px;
    outline: none;
  }

  .row-icon-btn {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .row-icon-btn:hover { background: var(--bg-hover); color: var(--accent); }
  .row-icon-btn.danger:hover { background: rgba(176,58,46,0.10); color: var(--red); }

  /* ── Right pane: songs ──────────────────────────────────────────────────── */
  .songs-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    background: var(--bg-elevated);
    min-width: 0;
  }

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
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    z-index: 1;
  }
  .dialog-close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .songs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 52px 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .songs-header h3 {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .play-all-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    background: var(--accent);
    border: none;
    color: var(--bg-base);
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
  }
  .play-all-btn:hover { opacity: 0.9; }

  .songs-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  .songs-placeholder p {
    font-size: 0.82rem;
    color: var(--text-muted);
    max-width: 320px;
  }

</style>
