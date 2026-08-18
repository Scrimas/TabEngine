<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import {
    libraryStore,
    recordOpen,
    renameEntry,
    removeEntry,
    importFileToLibrary,
    mergeScannedEntries,
  } from '$lib/stores/library';
  import { settingsStore, updateSettings } from '$lib/stores/settings';
  import {
    playlistsStore, createPlaylist, addToPlaylist,
    removeFromPlaylist, startQueue, activeQueueStore,
    setQueueRepeat, setQueueShuffle,
  } from '$lib/stores/playlists';
  import PlaylistSongList from './PlaylistSongList.svelte';
  import { toast, confirmDialog } from '$lib/stores/notifications';
  import { overlayOpened, overlayClosed } from '$lib/stores/overlays';
  import type { LibraryEntry, LibrarySortField } from '$lib/types';

  const dispatch = createEventDispatcher<{ load: string; 'open-browser': void; 'open-playlists': void }>();

  let searchQuery = '';
  let viewMode: 'library' | 'playlist' = 'library';

  $: activePlaylist = $playlistsStore.find(p => p.id === $activeQueueStore.playlistId) ?? null;
  // Keep unresolvable paths as explicit "missing" rows instead of silently
  // hiding them — the user can see and remove them.
  $: activePlaylistItems = (activePlaylist?.paths ?? []).map(path => ({
    path,
    entry: $libraryStore.entries.find(e => e.path === path) ?? null,
  }));

  async function playActivePlaylistPath(path: string) {
    if (!activePlaylist) return;
    const loadPath = startQueue(activePlaylist.id, path);
    if (!loadPath) return;
    const entry = $libraryStore.entries.find(e => e.path === loadPath);
    if (entry) recordOpen(entry);
    dispatch('load', loadPath);
  }

  /** Score-authored title when known, filename otherwise. */
  function displayName(e: LibraryEntry): string {
    return e.title || e.name;
  }

  function sortEntries(entries: LibraryEntry[], field: LibrarySortField): LibraryEntry[] {
    const copy = [...entries];
    switch (field) {
      case 'type':       return copy.sort((a, b) => a.ext.localeCompare(b.ext) || displayName(a).localeCompare(displayName(b)));
      case 'artist':     return copy.sort((a, b) =>
        (a.artist ?? '￿').localeCompare(b.artist ?? '￿') || displayName(a).localeCompare(displayName(b)));
      case 'dateAdded':  return copy.sort((a, b) => (b.dateAdded  ?? 0) - (a.dateAdded  ?? 0));
      case 'dateOpened': return copy.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
      default:           return copy.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    }
  }

  function matchesQuery(e: LibraryEntry, q: string): boolean {
    return e.name.toLowerCase().includes(q)
      || (e.title  ?? '').toLowerCase().includes(q)
      || (e.artist ?? '').toLowerCase().includes(q);
  }

  $: filtered = sortEntries(
    $libraryStore.entries.filter(e => matchesQuery(e, searchQuery.toLowerCase())),
    $settingsStore.librarySortField,
  );

  function handleSortChange(e: Event) {
    const field = (e.currentTarget as HTMLSelectElement).value as LibrarySortField;
    updateSettings({ librarySortField: field });
  }

  const EXT_COLOR: Record<string, string> = {
    gp:  '#8b7cf6', gp3: '#fb7185', gp4: '#4ade80',
    gp5: '#D98A52', gpx: '#fbbf24',
  };

  function thumbColor(ext: string): string {
    return EXT_COLOR[ext] ?? '#aeb2bc';
  }

  async function openFileDialog() {
    try {
      const selected = await tauriOpen({
        multiple: true,
        filters: [{ name: 'Guitar Pro', extensions: ['gp', 'gp3', 'gp4', 'gp5', 'gpx'] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      // Extra selections join the library; the first one loads.
      if (paths.length > 1) {
        const rest: LibraryEntry[] = [];
        for (const path of paths.slice(1)) {
          const importedPath = await importFileToLibrary(path);
          rest.push(await invoke('file_metadata', { path: importedPath }));
        }
        mergeScannedEntries(rest);
        toast('success', `Added ${paths.length} files to the library.`);
      }
      await loadEntry(paths[0]);
    } catch (err) {
      console.error('[Sidebar] Open dialog error:', err);
      toast('error', `Could not open file: ${err}`);
    }
  }

  async function loadEntry(path: string) {
    try {
      const importedPath = await importFileToLibrary(path);
      const meta: LibraryEntry = await invoke('file_metadata', { path: importedPath });
      recordOpen(meta);
      dispatch('load', importedPath);
    } catch (err) {
      console.error('[Sidebar] load error:', err);
      toast('error', `Could not load file: ${err}`);
    }
  }

  function handleCardKeyDown(e: KeyboardEvent, path: string) {
    if (editingPath) return;
    if (e.key === 'Enter') loadEntry(path);
  }

  // ── Inline rename ────────────────────────────────────────────────────────────

  let editingPath: string | null = null;
  let editingName = '';
  let renameInputEl: HTMLInputElement | null = null;

  function useFocus(node: HTMLInputElement) {
    node.focus();
    // Use a tiny timeout to ensure the DOM is ready for selection in WebKitGTK
    setTimeout(() => node.select(), 10);
    return {};
  }

  async function startEdit(e: Event, entry: LibraryEntry) {
    e.stopPropagation();
    editingPath = entry.path;
    editingName = entry.name;
    await tick();
    renameInputEl?.focus();
    renameInputEl?.select();
  }

  function cancelEdit() {
    editingPath = null;
    editingName = '';
  }

  // ── Context menu ─────────────────────────────────────────────────────────────

  let contextMenu: { x: number; y: number; entry: LibraryEntry } | null = null;
  let contextMenuAddMode = false;
  let ctxMenuEl: HTMLDivElement | null = null;

  async function openContextMenu(e: MouseEvent, entry: LibraryEntry) {
    e.preventDefault();
    e.stopPropagation();
    if (!contextMenu) overlayOpened(); // re-opening on another entry keeps the count at 1
    contextMenu = { x: e.clientX, y: e.clientY, entry };
    contextMenuAddMode = false;
    // Right-clicking doesn't move DOM focus, and in the Tauri webview that can
    // leave the very next keydown (Escape) undelivered until something is
    // clicked. Force focus onto the menu itself so Escape works immediately.
    await tick();
    clampContextMenu();
    ctxMenuEl?.focus();
  }

  /** Keep the menu fully inside the viewport (it opens at the pointer). */
  function clampContextMenu() {
    if (!contextMenu || !ctxMenuEl) return;
    const rect = ctxMenuEl.getBoundingClientRect();
    const x = Math.min(contextMenu.x, window.innerWidth  - rect.width  - 8);
    const y = Math.min(contextMenu.y, window.innerHeight - rect.height - 8);
    if (x !== contextMenu.x || y !== contextMenu.y) {
      contextMenu = { ...contextMenu, x: Math.max(8, x), y: Math.max(8, y) };
    }
  }

  function closeContextMenu() {
    if (contextMenu) overlayClosed();
    contextMenu = null;
    contextMenuAddMode = false;
  }

  /** Arrow-key navigation between the menu's items; Escape closes. */
  function handleCtxMenuKeyDown(e: KeyboardEvent) {
    if (!ctxMenuEl) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(ctxMenuEl.querySelectorAll<HTMLButtonElement>('.ctx-item'));
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown'
      ? (idx === -1 || idx === items.length - 1 ? 0 : idx + 1)
      : (idx <= 0 ? items.length - 1 : idx - 1);
    items[next].focus();
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && contextMenu) closeContextMenu();
  }

  function ctxRemoveFromLibrary() {
    if (!contextMenu) return;
    removeEntry(contextMenu.entry.path);
    closeContextMenu();
  }

  function ctxAddToPlaylist(playlistId: string) {
    if (!contextMenu) return;
    addToPlaylist(playlistId, contextMenu.entry.path);
    closeContextMenu();
  }

  function ctxAddToNewPlaylist() {
    if (!contextMenu) return;
    const playlist = createPlaylist('New Playlist');
    addToPlaylist(playlist.id, contextMenu.entry.path);
    closeContextMenu();
  }

  async function ctxDeleteFromDisk() {
    if (!contextMenu) return;
    const entry = contextMenu.entry;
    closeContextMenu();
    const yes = await confirmDialog({
      title: 'Delete file from disk?',
      message: `"${entry.name}" will be permanently deleted.\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await invoke('delete_gp_file', { path: entry.path });
      removeEntry(entry.path);
      toast('success', `Deleted "${entry.name}".`);
    } catch (err) {
      toast('error', `Could not delete file: ${err}`);
    }
  }

  async function commitEdit(entry: LibraryEntry) {
    const name = editingName.trim();
    if (!name || name === entry.name) {
      cancelEdit();
      return;
    }
    try {
      const newEntry: LibraryEntry = await invoke('rename_gp_file', {
        oldPath: entry.path,
        newName: name,
      });
      renameEntry(entry.path, newEntry);
    } catch (err) {
      console.error('[Sidebar] rename error:', err);
      toast('error', `Could not rename: ${err}`);
      // Keep the edit open with the typed name so the user can correct it
      // instead of silently discarding their input.
      renameInputEl?.focus();
      return;
    }
    editingPath = null;
    editingName = '';
  }
</script>

<svelte:window on:keydown={handleWindowKeyDown} />

<aside class="sidebar" role="navigation" aria-label="File library">
  <!-- Search bar -->
  <div class="search-wrap">
    <div class="search-bar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
      </svg>
      <input
        type="search"
        placeholder="Search library…"
        bind:value={searchQuery}
        on:dragstart|preventDefault
        on:keydown={(e) => {
          if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
            e.stopPropagation();
            e.preventDefault();
            e.currentTarget.select();
          }
        }}
        aria-label="Search library files"
      />
    </div>

    <div class="action-btns">
      <button class="action-btn primary full-row" on:click={openFileDialog}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 3v5h5"/><path d="M6 3h8l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>
        </svg>
        Open
      </button>
      <button class="action-btn" on:click={() => dispatch('open-browser')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <path d="M20 20l-3-3"/>
          <path d="M11 8v6M8 11h6"/>
        </svg>
        Songsterr
      </button>
      <button class="action-btn" on:click={() => dispatch('open-playlists')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 18V6l10-2v12"/>
          <circle cx="6.5" cy="18" r="2.5"/>
          <circle cx="16.5" cy="16" r="2.5"/>
        </svg>
        Playlists
      </button>
    </div>
  </div>

  <!-- Library / Playlist toggle -->
  <div class="lib-header">
    <div class="view-toggle" role="tablist" aria-label="Library view">
      <button
        class="view-tab"
        class:active={viewMode === 'library'}
        role="tab"
        aria-selected={viewMode === 'library'}
        on:click={() => viewMode = 'library'}
      >
        Library
      </button>
      <button
        class="view-tab"
        class:active={viewMode === 'playlist'}
        role="tab"
        aria-selected={viewMode === 'playlist'}
        on:click={() => viewMode = 'playlist'}
      >
        Playlist
      </button>
    </div>
    <div class="lib-header-right">
      {#if viewMode === 'library'}
        <span class="sort-label">Sort by:</span>
        <select
          class="sort-select"
          value={$settingsStore.librarySortField}
          on:change={handleSortChange}
          aria-label="Sort library by"
        >
          <option value="name">Name</option>
          <option value="artist">Artist</option>
          <option value="dateAdded">Date added</option>
          <option value="dateOpened">Date opened</option>
          <option value="type">Type</option>
        </select>
      {/if}
      {#if viewMode === 'playlist' && activePlaylist}
        <button
          class="queue-mode-btn"
          class:active={$activeQueueStore.shuffle}
          on:click={() => setQueueShuffle(!$activeQueueStore.shuffle)}
          title="Shuffle (pick the next song at random)"
          aria-pressed={$activeQueueStore.shuffle}
          aria-label="Shuffle"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 3h5v5"/><path d="M4 20L21 3"/>
            <path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>
          </svg>
        </button>
        <button
          class="queue-mode-btn"
          class:active={$activeQueueStore.repeat}
          on:click={() => setQueueRepeat(!$activeQueueStore.repeat)}
          title="Repeat playlist (start over after the last song)"
          aria-pressed={$activeQueueStore.repeat}
          aria-label="Repeat playlist"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
            <path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
          </svg>
        </button>
      {/if}
      <span class="lib-count">{viewMode === 'library' ? filtered.length : activePlaylistItems.length}</span>
    </div>
  </div>

  {#if viewMode === 'playlist'}
    {#if !activePlaylist}
      <div class="empty-msg">
        <p>No playlist is currently playing.</p>
        <p>Open Playlists to start one.</p>
      </div>
    {:else}
      <PlaylistSongList
        playlist={activePlaylist}
        items={activePlaylistItems}
        currentPath={$activeQueueStore.currentPath}
        on:play={(e) => playActivePlaylistPath(e.detail)}
        on:remove={(e) => activePlaylist && removeFromPlaylist(activePlaylist.id, e.detail)}
      />
    {/if}
  {:else}

  <!-- Loading -->
  {#if $libraryStore.isLoading}
    <div class="loading-bar"><div class="loading-shimmer"></div></div>
  {/if}

  <!-- Error -->
  {#if $libraryStore.error}
    <p class="error-msg" role="alert">{$libraryStore.error}</p>
  {/if}

  <!-- File list -->
  <!-- Cards act as buttons, so no list semantics (role=list requires listitem children) -->
  <div class="file-list">
    {#if filtered.length === 0}
      <div class="empty-msg">
        {#if searchQuery}
          <p>No results for "<em>{searchQuery}</em>"</p>
        {:else}
          <p>No files yet.</p>
          <p>Open a file or scan a folder.</p>
        {/if}
      </div>
    {:else}
      {#each filtered as entry (entry.path)}
        {@const color = thumbColor(entry.ext)}
        {@const active = $libraryStore.currentPath === entry.path}
        {@const isEditing = editingPath === entry.path}
        <!-- svelte-ignore a11y-interactive-supports-focus a11y-no-noninteractive-tabindex -->
        <div
          class="file-card"
          class:active
          class:editing={isEditing}
          draggable="false"
          role={isEditing ? undefined : 'button'}
          tabindex={isEditing ? -1 : 0}
          on:click={(e) => { if (!isEditing) { loadEntry(entry.path); e.currentTarget.blur(); } }}
          on:contextmenu={(e) => openContextMenu(e, entry)}
          on:keydown={(e) => handleCardKeyDown(e, entry.path)}
          title={entry.path}
        >
          {#if active}
            <div class="active-stripe" aria-hidden="true"></div>
          {/if}

          <!-- Thumbnail -->
          <div class="thumb"
               style="background: linear-gradient(140deg, {color}, color-mix(in srgb, {color} 38%, var(--thumb-mix)));"
               aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.92">
              <path d="M9 18V6l10-2v12"/>
              <circle cx="6.5" cy="18" r="2.5"/>
              <circle cx="16.5" cy="16" r="2.5"/>
            </svg>
          </div>

          <!-- Info -->
          <div class="file-info">
            {#if isEditing}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <input
                class="rename-input"
                use:useFocus
                bind:value={editingName}
                bind:this={renameInputEl}
                on:dragstart|preventDefault
                on:mousedown|stopPropagation
                on:pointerdown|stopPropagation
                on:keydown|stopPropagation={(e) => {
                  if (e.key === 'Enter') commitEdit(entry);
                  else if (e.key === 'Escape') cancelEdit();
                  else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.currentTarget.select();
                  }
                }}
                on:blur={() => commitEdit(entry)}
                aria-label="Rename file"
              />
            {:else}
              <div class="file-name">{displayName(entry)}</div>
            {/if}
            <div class="file-meta">
              <span class="file-fmt"
                    style="color:{color};background:color-mix(in srgb,{color} 13%,transparent);">
                {entry.ext.toUpperCase()}
              </span>
              {#if entry.artist}
                <span class="file-artist">{entry.artist}</span>
              {/if}
            </div>
          </div>

          <!-- Rename button (shown on hover) -->
          {#if !isEditing}
            <button
              class="rename-btn"
              on:click={(e) => startEdit(e, entry)}
              title="Rename"
              aria-label="Rename {entry.name}"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  {/if}

  <!-- Import hint -->
  <div class="import-hint">
    <div class="import-hint-chip">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 15V3m0 0L8 7m4-4l4 4"/>
        <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>
      </svg>
      <span>Drag &amp; drop</span>
      <span class="hint-sep">·</span>
      <kbd>Ctrl</kbd><span class="hint-plus">+</span><kbd>O</kbd>
    </div>
  </div>

  <!-- Context menu -->
  {#if contextMenu}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="ctx-backdrop" on:click={closeContextMenu}></div>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="ctx-menu"
      style="left:{contextMenu.x}px;top:{contextMenu.y}px"
      role="menu"
      tabindex="-1"
      bind:this={ctxMenuEl}
      on:keydown={handleCtxMenuKeyDown}
    >
      {#if !contextMenuAddMode}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <button class="ctx-item" role="menuitem" on:click={() => contextMenuAddMode = true}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add to playlist
        </button>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <button class="ctx-item" role="menuitem" on:click={ctxRemoveFromLibrary}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
          Remove from library
        </button>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <button class="ctx-item danger" role="menuitem" on:click={ctxDeleteFromDisk}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
          Delete file from disk
        </button>
      {:else}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <button class="ctx-item" role="menuitem" on:click={() => contextMenuAddMode = false}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6"/>
          </svg>
          Back
        </button>
        {#each $playlistsStore as playlist (playlist.id)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <button class="ctx-item" role="menuitem" on:click={() => ctxAddToPlaylist(playlist.id)}>
            {playlist.name}
          </button>
        {/each}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <button class="ctx-item" role="menuitem" on:click={ctxAddToNewPlaylist}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New playlist…
        </button>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    grid-area: s;
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .search-wrap {
    padding: 14px 14px 10px;
    flex-shrink: 0;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 9px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 9px 11px;
    color: var(--text-muted);
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  .search-bar:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
    color: var(--text-secondary);
  }
  .search-bar input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 13px;
  }
  .search-bar input::placeholder { color: var(--text-muted); }

  .action-btns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }
  .action-btn.full-row {
    grid-column: 1 / -1;
  }
  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px;
    border-radius: 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition), color var(--transition), border-color var(--transition);
  }
  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .action-btn.primary {
    background: var(--accent-dim);
    border-color: rgba(217, 138, 82, 0.32);
    color: var(--accent);
  }
  .action-btn.primary:hover {
    background: rgba(217, 138, 82, 0.24);
    border-color: rgba(217, 138, 82, 0.50);
  }

  .lib-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 18px 8px;
    flex-shrink: 0;
  }

  .view-toggle {
    display: flex;
    background: var(--overlay-subtle);
    border-radius: 7px;
    padding: 2px;
    gap: 2px;
  }
  .view-tab {
    padding: 3px 9px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .view-tab:hover { color: var(--text-secondary); }
  .view-tab.active {
    background: var(--bg-elevated);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }

  .lib-header-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .queue-mode-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .queue-mode-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .queue-mode-btn.active {
    background: var(--accent-dim);
    color: var(--accent);
    border-color: var(--accent-glow);
  }

  .lib-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .sort-label {
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .sort-select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-color: var(--bg-elevated);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239e9180' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 7px center;
    background-size: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 22px 2px 7px;
    color: var(--text-secondary);
    font-size: 10.5px;
    font-family: inherit;
    cursor: pointer;
    outline: none;
  }
  .sort-select:hover {
    border-color: var(--border-hover);
    color: var(--text-primary);
  }
  .sort-select:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-dim);
  }

  .loading-bar {
    height: 2px;
    margin: 0 14px 6px;
    background: var(--border);
    border-radius: 1px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .loading-shimmer {
    height: 100%;
    width: 40%;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: shimmer 1.2s ease-in-out infinite;
  }

  .error-msg {
    font-size: 0.75rem;
    color: var(--red);
    padding: 4px 16px;
    flex-shrink: 0;
  }

  .file-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .empty-msg {
    padding: 24px 16px;
    text-align: center;
  }
  .empty-msg p {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  /* File card — div with button role to allow nested rename button */
  .file-card {
    position: relative;
    display: flex;
    gap: 11px;
    padding: 10px;
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    transition: background var(--transition), border-color var(--transition);
    animation: fadeInUp 0.3s var(--ease-out) backwards;
    align-items: center;
    user-select: none;
    -webkit-user-select: none;
  }
  .file-card:hover {
    background: var(--overlay-subtle);
  }
  .file-card.active {
    background: var(--bg-elevated);
    border-color: var(--border-hover);
  }
  .file-card.editing {
    cursor: text;
    user-select: text !important;
    -webkit-user-select: text !important;
  }
  .file-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .active-stripe {
    position: absolute;
    left: 0;
    top: 13px;
    bottom: 13px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }

  .thumb {
    width: 42px;
    height: 42px;
    border-radius: 10px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
  }

  .file-info {
    flex: 1;
    min-width: 0;
  }
  .file-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  .file-artist {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .file-meta {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 5px;
  }
  .file-fmt {
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    border-radius: 4px;
    padding: 1.5px 5px;
  }

  /* Inline rename input */
  .rename-input {
    width: 100%;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 2px 6px;
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-dim);
  }

  /* Rename pencil button — hidden by default, shown on card hover */
  .rename-btn {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--transition), background var(--transition), color var(--transition);
  }
  .file-card:hover .rename-btn,
  .rename-btn:focus-visible {
    opacity: 1;
  }
  .rename-btn:hover {
    background: var(--bg-hover);
    color: var(--accent);
  }

  /* Import hint */
  .import-hint {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    padding: 10px 14px 12px;
  }
  .import-hint-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    box-shadow: 0 0 20px var(--accent-dim), 0 0 8px var(--accent-dim);
    color: var(--text-muted);
    font-size: 10.5px;
    white-space: nowrap;
  }
  .hint-sep {
    color: var(--border-hover);
  }
  .hint-plus {
    font-size: 9px;
    color: var(--text-muted);
  }
  .import-hint kbd {
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--bg-hover);
    border: 1px solid var(--border-hover);
    color: var(--text-secondary);
  }

  /* Context menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 299;
  }
  .ctx-menu {
    position: fixed;
    /* Above the panel resize handles (z 100), below modal backdrops (900) */
    z-index: 300;
    min-width: 190px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    outline: none;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border-radius: 7px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background var(--transition), color var(--transition);
  }
  .ctx-item:hover {
    background: var(--bg-hover);
  }
  .ctx-item.danger { color: var(--red); }
  .ctx-item.danger:hover { background: var(--red-dim); }
</style>
