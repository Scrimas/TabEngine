<script lang="ts">
  // PlaylistSongList — reorderable song list for a single playlist.
  // Reordering is pointer-driven (grip handle), not native HTML5 drag-and-drop:
  // the native drag ghost is an oversized, semi-transparent snapshot we don't
  // want. Instead the dragged row follows the pointer directly via a
  // translateY transform, swapping live with `reorderPlaylist` as it crosses
  // a neighboring row's midpoint.
  import { createEventDispatcher } from 'svelte';
  import { reorderPlaylist } from '$lib/stores/playlists';
  import type { Playlist, LibraryEntry } from '$lib/types';

  interface PlaylistItem {
    path:  string;
    entry: LibraryEntry | null; // null = file no longer in the library (missing)
  }

  export let playlist: Playlist;
  export let items: PlaylistItem[]; // resolved from playlist.paths, same order
  export let currentPath: string | null = null;

  const dispatch = createEventDispatcher<{ play: string; remove: string }>();

  function rowName(item: PlaylistItem): string {
    if (item.entry) return item.entry.title || item.entry.name;
    return item.path.split('/').pop() ?? item.path;
  }

  let rowEls: (HTMLElement | null)[] = [];
  let draggingIndex: number | null = null;
  let dragOffsetY = 0;

  function handleGripPointerDown(e: PointerEvent, index: number) {
    draggingIndex = index;
    dragOffsetY = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleGripPointerMove(e: PointerEvent, index: number) {
    if (draggingIndex !== index) return;
    dragOffsetY += e.movementY;

    const rowEl = rowEls[draggingIndex];
    if (!rowEl) return;
    const rowStep = rowEl.offsetHeight + 3; // row height + list gap
    if (Math.abs(dragOffsetY) >= rowStep / 2) {
      const direction = dragOffsetY > 0 ? 1 : -1;
      const targetIndex = draggingIndex + direction;
      if (targetIndex >= 0 && targetIndex < items.length) {
        reorderPlaylist(playlist.id, draggingIndex, targetIndex);
        draggingIndex = targetIndex;
        dragOffsetY -= direction * rowStep;
      }
    }
  }

  function handleGripPointerUp() {
    draggingIndex = null;
    dragOffsetY = 0;
  }
</script>

{#if items.length === 0}
  <div class="empty-state">
    <p>No songs yet. Right-click a file in the library and choose "Add to playlist".</p>
  </div>
{:else}
  <div class="song-list" role="list">
    {#each items as item, i (item.path)}
      {@const missing = !item.entry}
      <!-- svelte-ignore a11y-interactive-supports-focus a11y-no-noninteractive-tabindex a11y-no-static-element-interactions -->
      <div
        class="song-row"
        class:current={item.path === currentPath}
        class:dragging={draggingIndex === i}
        class:missing
        bind:this={rowEls[i]}
        style={draggingIndex === i ? `transform: translateY(${dragOffsetY}px)` : ''}
        role="button"
        tabindex="0"
        aria-disabled={missing}
        title={missing ? `File not found: ${item.path}` : undefined}
        on:click={() => { if (!missing) dispatch('play', item.path); }}
        on:keydown={(e) => { if (e.key === 'Enter' && !missing) dispatch('play', item.path); }}
      >
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <span
          class="grip"
          aria-hidden="true"
          on:pointerdown|stopPropagation={(e) => handleGripPointerDown(e, i)}
          on:pointermove|stopPropagation={(e) => handleGripPointerMove(e, i)}
          on:pointerup|stopPropagation={handleGripPointerUp}
          on:pointercancel|stopPropagation={handleGripPointerUp}
          on:click|stopPropagation
        >⠿</span>
        <span class="song-index">{i + 1}</span>
        <span class="song-name">{rowName(item)}</span>
        {#if missing}
          <span class="song-missing">missing</span>
        {:else if item.entry}
          <span class="song-ext">{item.entry.ext.toUpperCase()}</span>
        {/if}
        <button
          class="remove-btn"
          title="Remove from playlist"
          aria-label="Remove {rowName(item)} from playlist"
          on:click|stopPropagation={() => dispatch('remove', item.path)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  .empty-state p {
    font-size: 0.82rem;
    color: var(--text-muted);
    max-width: 320px;
  }

  .song-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .song-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 10px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background var(--transition), border-color var(--transition);
    touch-action: none;
  }
  .song-row:hover { background: var(--overlay-subtle); }
  .song-row.current {
    background: var(--accent-dim);
    border-color: rgba(217, 138, 82, 0.32);
  }
  .song-row.dragging {
    z-index: 5;
    position: relative;
    background: var(--bg-elevated);
    border-color: var(--border-hover);
    box-shadow: var(--shadow-sm);
  }

  .grip {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
    cursor: grab;
    touch-action: none;
  }
  .song-row.dragging .grip { cursor: grabbing; }

  .song-index {
    flex-shrink: 0;
    width: 18px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    text-align: right;
  }

  .song-name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .song-ext {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .song-row.missing { cursor: default; }
  .song-row.missing .song-name {
    color: var(--text-muted);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .song-missing {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 99px;
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--red);
    background: var(--red-dim);
  }

  .remove-btn {
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
  .remove-btn:hover { background: var(--red-dim); color: var(--red); }
</style>
