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
  } from '$lib/stores/library';
  import type { LibraryEntry } from '$lib/types';

  const dispatch = createEventDispatcher<{ load: string; 'open-browser': void }>();

  let searchQuery = '';

  $: filtered = $libraryStore.entries.filter(e =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const EXT_COLOR: Record<string, string> = {
    gp:  '#8b7cf6', gp3: '#fb7185', gp4: '#4ade80',
    gp5: '#c07838', gpx: '#fbbf24',
  };

  function thumbColor(ext: string): string {
    return EXT_COLOR[ext] ?? '#aeb2bc';
  }

  async function openFileDialog() {
    try {
      const selected = await tauriOpen({
        multiple: false,
        filters: [{ name: 'Guitar Pro', extensions: ['gp', 'gp3', 'gp4', 'gp5', 'gpx'] }],
      });
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : selected[0];
      if (!path) return;
      await loadEntry(path);
    } catch (err) {
      console.error('[Sidebar] Open dialog error:', err);
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
    }
  }

  function handleCardKeyDown(e: KeyboardEvent, path: string) {
    if (editingPath) return;
    if (e.key === 'Enter' || e.key === ' ') loadEntry(path);
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

  function openContextMenu(e: MouseEvent, entry: LibraryEntry) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, entry };
  }

  function closeContextMenu() { contextMenu = null; }

  function ctxRemoveFromLibrary() {
    if (!contextMenu) return;
    removeEntry(contextMenu.entry.path);
    closeContextMenu();
  }

  async function ctxDeleteFromDisk() {
    if (!contextMenu) return;
    const entry = contextMenu.entry;
    closeContextMenu();
    const yes = confirm(`Delete "${entry.name}" from disk?\nThis cannot be undone.`);
    if (!yes) return;
    try {
      await invoke('delete_gp_file', { path: entry.path });
      removeEntry(entry.path);
    } catch (err) {
      alert(`Could not delete file: ${err}`);
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
      alert(`Could not rename: ${err}`);
    }
    editingPath = null;
    editingName = '';
  }
</script>

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
        on:keydown|stopPropagation={(e) => {
          if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.select();
          }
        }}
        aria-label="Search library files"
      />
    </div>

    <div class="action-btns">
      <button class="action-btn primary" on:click={openFileDialog}>
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
    </div>
  </div>

  <!-- Library label -->
  <div class="lib-header">
    <span class="lib-label">Library</span>
    <span class="lib-count">{filtered.length}</span>
  </div>

  <!-- Loading -->
  {#if $libraryStore.isLoading}
    <div class="loading-bar"><div class="loading-shimmer"></div></div>
  {/if}

  <!-- Error -->
  {#if $libraryStore.error}
    <p class="error-msg" role="alert">{$libraryStore.error}</p>
  {/if}

  <!-- File list -->
  <div class="file-list" role="list">
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
          on:click={() => { if (!isEditing) loadEntry(entry.path); }}
          on:contextmenu={(e) => openContextMenu(e, entry)}
          on:keydown={(e) => handleCardKeyDown(e, entry.path)}
          title={entry.path}
        >
          {#if active}
            <div class="active-stripe" aria-hidden="true"></div>
          {/if}

          <!-- Thumbnail -->
          <div class="thumb"
               style="background: linear-gradient(140deg, {color}, color-mix(in srgb, {color} 38%, #e8e2d2));"
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
              <div class="file-name">{entry.name}</div>
            {/if}
            <div class="file-meta">
              <span class="file-fmt"
                    style="color:{color};background:color-mix(in srgb,{color} 13%,transparent);">
                {entry.ext.toUpperCase()}
              </span>
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

  <!-- Context menu -->
  {#if contextMenu}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="ctx-backdrop" on:click={closeContextMenu}></div>
    <div
      class="ctx-menu"
      style="left:{contextMenu.x}px;top:{contextMenu.y}px"
      role="menu"
    >
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
    border-color: rgba(192, 120, 56, 0.32);
    color: var(--accent);
  }
  .action-btn.primary:hover {
    background: rgba(192, 120, 56, 0.24);
    border-color: rgba(192, 120, 56, 0.50);
  }

  .lib-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 18px 8px;
    flex-shrink: 0;
  }
  .lib-label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 1.2px;
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .lib-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
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
    scrollbar-color: rgba(43,40,35,0.10) transparent;
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
    background: rgba(43,40,35,0.05);
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
  .file-card:hover .rename-btn {
    opacity: 1;
  }
  .rename-btn:hover {
    background: var(--bg-hover);
    color: var(--accent);
  }

  /* Context menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .ctx-menu {
    position: fixed;
    z-index: 100;
    min-width: 190px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.16);
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
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
  .ctx-item.danger:hover { background: rgba(176,58,46,0.10); }
</style>
