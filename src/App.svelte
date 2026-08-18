<script lang="ts">
  import { onMount } from 'svelte';
  import Titlebar    from '$lib/components/Titlebar.svelte';
  import ScoreViewer from '$lib/components/ScoreViewer.svelte';
  import ControlBar  from '$lib/components/ControlBar.svelte';
  import Mixer       from '$lib/components/Mixer.svelte';
  import Sidebar     from '$lib/components/Sidebar.svelte';
  import SongsterrBrowser from '$lib/components/SongsterrBrowser.svelte';
  import SettingsDialog   from '$lib/components/SettingsDialog.svelte';
  import PlaylistsView    from '$lib/components/PlaylistsView.svelte';
  import Toasts           from '$lib/components/Toasts.svelte';
  import ConfirmDialog    from '$lib/components/ConfirmDialog.svelte';
  import ShortcutsOverlay from '$lib/components/ShortcutsOverlay.svelte';

  import {
    playPause, stop, seekToPrevBar, seekToNextBar, seekToPrevRow, seekToNextRow,
    setThemeSettings, setMetronomeVolumeLimit,
    setStaveProfile, setLayoutMode, setLoopBoundAtCurrentBar,
  } from '$lib/alphatab/AlphaTabManager';
  import { anyOverlayOpen } from '$lib/stores/overlays';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import {
    libraryStore, recordOpen, importFileToLibrary,
    resolveLibraryDir, saveBytesToLibrary, mergeScannedEntries,
  } from '$lib/stores/library';
  import { settingsStore, updateSettings } from '$lib/stores/settings';
  import { toast } from '$lib/stores/notifications';
  import type { LibraryEntry } from '$lib/types';

  let sidebarOpen   = $settingsStore.sidebarOpen;
  let mixerOpen     = $settingsStore.mixerOpen;
  let browserOpen   = false;
  let settingsOpen  = false;
  let playlistsOpen = false;
  let shortcutsOpen = false;

  let scoreViewer: ScoreViewer;

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    updateSettings({ sidebarOpen });
    reclampWidths();
  }

  function toggleMixer() {
    mixerOpen = !mixerOpen;
    updateSettings({ mixerOpen });
    reclampWidths();
  }

  // ── Panel resize ──────────────────────────────────────────────────────────────
  const MIN_PANEL = 160;
  const MAX_PANEL = 600;
  const MIN_SCORE = 320; // minimum room left for the score column

  let sidebarWidth = $settingsStore.sidebarWidth;
  let mixerWidth   = $settingsStore.mixerWidth;

  let resizing: 'sidebar' | 'mixer' | null = null;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  /** Widest this panel may get right now, given the window and the other panel. */
  function maxPanelWidth(panel: 'sidebar' | 'mixer'): number {
    const other = panel === 'sidebar'
      ? (mixerOpen ? mixerWidth : 0)
      : (sidebarOpen ? sidebarWidth : 0);
    return Math.min(MAX_PANEL, window.innerWidth - other - MIN_SCORE);
  }

  function clampPanel(width: number, panel: 'sidebar' | 'mixer'): number {
    return Math.max(MIN_PANEL, Math.min(width, maxPanelWidth(panel)));
  }

  /** Re-clamp both panels (window resized, panel reopened, startup restore). */
  function reclampWidths() {
    sidebarWidth = clampPanel(sidebarWidth, 'sidebar');
    mixerWidth   = clampPanel(mixerWidth, 'mixer');
  }
  reclampWidths(); // persisted widths may exceed the current window

  function startResize(e: PointerEvent, panel: 'sidebar' | 'mixer') {
    resizing = panel;
    resizeStartX = e.clientX;
    resizeStartWidth = panel === 'sidebar' ? sidebarWidth : mixerWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!resizing) return;
    const delta = e.clientX - resizeStartX;
    if (resizing === 'sidebar') {
      sidebarWidth = clampPanel(resizeStartWidth + delta, 'sidebar');
    } else {
      mixerWidth = clampPanel(resizeStartWidth - delta, 'mixer');
    }
  }

  function stopResize() {
    if (!resizing) return;
    resizing = null;
    updateSettings({ sidebarWidth, mixerWidth });
  }

  // ── Settings sync ─────────────────────────────────────────────────────────────
  // This block fires on every settings write (e.g. once per step while dragging
  // the metronome-volume slider); setThemeSettings itself skips unchanged themes
  // so no full score re-render is triggered here.
  $: {
    const s = $settingsStore;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark-theme', s.theme === 'dark');
    }
    setThemeSettings(s.theme);
    setMetronomeVolumeLimit(s.metronomeVolume);
  }

  function toggleTheme() {
    updateSettings({ theme: $settingsStore.theme === 'parchment' ? 'dark' : 'parchment' });
  }

  function toggleNotation() {
    setStaveProfile($settingsStore.staveProfile === 'scoretab' ? 'tab' : 'scoretab');
  }

  function toggleLayout() {
    setLayoutMode($settingsStore.layoutMode === 'horizontal' ? 'page' : 'horizontal');
  }

  async function toggleFullscreen() {
    try {
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    } catch (err) {
      console.error('[App] Fullscreen toggle failed:', err);
    }
  }

  // ── Sidebar / Playlists load ─────────────────────────────────────────────────
  async function handleSidebarLoad(e: CustomEvent<string>) {
    await scoreViewer?.loadFile(e.detail);
  }

  // ── Songsterr download ────────────────────────────────────────────────────────
  async function handleDownloadTab() {
    const song  = $libraryStore.currentSongsterrSong;
    const bytes = $libraryStore.currentSongsterrBytes;
    if (!song || !bytes) return;

    try {
      // Default to the XDG app data dir (~/.local/share/tabengine) if no library dir set
      const destDir = await resolveLibraryDir();
      if (!destDir) throw new Error('Could not resolve a library directory.');

      // Mirror the Rust validate_file_stem rules: strip separator/Windows-invalid
      // and control characters, then trailing dots/spaces, so the save can't be
      // rejected by the backend validation.
      const stem = `${song.artist.name} - ${song.title}`
        .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, '_')
        .trim()
        .replace(/[.\s]+$/, '') || 'Songsterr Tab';

      // Collision-safe: never silently overwrites an existing library file
      const meta = await saveBytesToLibrary(destDir, `${stem}.gp5`, bytes);
      recordOpen(meta);
      toast('success', `Saved "${meta.name}" to the library.`);
    } catch (err) {
      console.error('[App] Quick save file error:', err);
      toast('error', `Failed to save file: ${err}`);
    }
  }

  // ── Open file dialog ──────────────────────────────────────────────────────────
  async function openFileViaDialog() {
    try {
      const selected = await tauriOpen({
        multiple: true,
        filters: [{ name: 'Guitar Pro', extensions: ['gp', 'gp3', 'gp4', 'gp5', 'gpx'] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const imported: LibraryEntry[] = [];
      for (const path of paths) {
        const importedPath = await importFileToLibrary(path);
        const meta: LibraryEntry = await invoke('file_metadata', { path: importedPath });
        imported.push(meta);
      }
      // The first selection loads; any others just join the library.
      recordOpen(imported[0]);
      if (imported.length > 1) {
        mergeScannedEntries(imported.slice(1));
        toast('success', `Added ${imported.length} files to the library.`);
      }
      await scoreViewer?.loadFile(imported[0].path);
    } catch (err) {
      console.error('[App] Dialog open error:', err);
      toast('error', `Could not open file: ${err}`);
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

    switch (true) {
      case e.code === 'Space' && !e.ctrlKey: {
        // Don't hijack Space from a focused button/link — let it activate
        // that control natively instead of also toggling playback.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A'
          || t.getAttribute?.('role') === 'button' || t.isContentEditable)) break;
        e.preventDefault();
        playPause();
        break;
      }
      case e.code === 'Escape':
        // Let an open overlay's own Escape handler close it instead of also
        // stopping playback as an unrelated side effect. Popovers and context
        // menus report themselves via the overlays store.
        if (!settingsOpen && !browserOpen && !playlistsOpen && !shortcutsOpen
          && !anyOverlayOpen()) stop();
        break;
      case e.key === '[' && !e.ctrlKey && !e.altKey:
        e.preventDefault();
        setLoopBoundAtCurrentBar('start');
        break;
      case e.key === ']' && !e.ctrlKey && !e.altKey:
        e.preventDefault();
        setLoopBoundAtCurrentBar('end');
        break;
      case (e.key === '?' && !e.ctrlKey && !e.altKey) || (e.key === '/' && e.ctrlKey):
        e.preventDefault();
        shortcutsOpen = !shortcutsOpen;
        break;
      case e.code === 'F11':
        e.preventDefault();
        toggleFullscreen();
        break;
      case e.code === 'KeyO' && e.ctrlKey:
        e.preventDefault();
        openFileViaDialog();
        break;
      case e.code === 'KeyB' && e.ctrlKey:
        e.preventDefault();
        toggleSidebar();
        break;
      case e.code === 'KeyM' && e.ctrlKey && !e.shiftKey:
        e.preventDefault();
        toggleMixer();
        break;
      case e.code === 'KeyF' && e.ctrlKey && e.shiftKey:
        e.preventDefault();
        browserOpen = !browserOpen;
        break;
      case e.code === 'KeyP' && e.ctrlKey && e.shiftKey:
        e.preventDefault();
        playlistsOpen = !playlistsOpen;
        break;
      case e.key === ',' && e.ctrlKey:
        e.preventDefault();
        settingsOpen = !settingsOpen;
        break;
      case e.code === 'ArrowLeft' && !e.ctrlKey && !e.altKey && !e.shiftKey:
        e.preventDefault();
        seekToPrevBar();
        break;
      case e.code === 'ArrowRight' && !e.ctrlKey && !e.altKey && !e.shiftKey:
        e.preventDefault();
        seekToNextBar();
        break;
      case e.code === 'ArrowUp' && !e.ctrlKey && !e.altKey && !e.shiftKey:
        e.preventDefault();
        seekToPrevRow();
        break;
      case e.code === 'ArrowDown' && !e.ctrlKey && !e.altKey && !e.shiftKey:
        e.preventDefault();
        seekToNextRow();
        break;
    }
  }

  onMount(() => {
    // Release any stuck resize if the window loses focus (pointer released
    // outside the webview) — stopResize also persists the final widths.
    const onBlur = () => stopResize();
    window.addEventListener('blur', onBlur);

    // Session restore: reopen the last file. Existence is checked first so a
    // moved/deleted file fails silently instead of toasting on every launch.
    const last = $settingsStore.lastOpenedFile;
    if (last) {
      invoke('file_metadata', { path: last })
        .then(() => scoreViewer?.loadFile(last))
        .catch(() => updateSettings({ lastOpenedFile: null }));
    }

    return () => window.removeEventListener('blur', onBlur);
  });
</script>

<svelte:window on:keydown={handleKeyDown} on:resize={reclampWidths} />

<div
  class="app-shell"
  class:sidebar-collapsed={!sidebarOpen}
  class:mixer-collapsed={!mixerOpen}
  class:is-resizing={!!resizing}
  style="--sidebar-width: {sidebarWidth}px; --mixer-width: {mixerWidth}px;"
>
  <Titlebar
    {sidebarOpen}
    {mixerOpen}
    theme={$settingsStore.theme}
    staveProfile={$settingsStore.staveProfile}
    layoutMode={$settingsStore.layoutMode}
    on:toggle-settings={() => settingsOpen = !settingsOpen}
    on:toggle-sidebar={toggleSidebar}
    on:toggle-mixer={toggleMixer}
    on:toggle-theme={toggleTheme}
    on:toggle-notation={toggleNotation}
    on:toggle-layout={toggleLayout}
  />
  <Sidebar
    on:load={handleSidebarLoad}
    on:open-browser={() => browserOpen = !browserOpen}
    on:open-playlists={() => playlistsOpen = !playlistsOpen}
  />

  <!-- Sidebar drag handle -->
  {#if sidebarOpen}
    <div
      class="resize-handle"
      class:active={resizing === 'sidebar'}
      style="left: {sidebarWidth}px"
      on:pointerdown={(e) => startResize(e, 'sidebar')}
      on:pointermove={onPointerMove}
      on:pointerup={stopResize}
      on:pointercancel={stopResize}
      role="separator"
      aria-label="Resize library panel"
      aria-orientation="vertical"
    />
  {/if}

  <ScoreViewer bind:this={scoreViewer} />

  <!-- Mixer drag handle -->
  {#if mixerOpen}
    <div
      class="resize-handle right"
      class:active={resizing === 'mixer'}
      style="right: {mixerWidth}px"
      on:pointerdown={(e) => startResize(e, 'mixer')}
      on:pointermove={onPointerMove}
      on:pointerup={stopResize}
      on:pointercancel={stopResize}
      role="separator"
      aria-label="Resize mixer panel"
      aria-orientation="vertical"
    />
  {/if}

  <ControlBar on:download={handleDownloadTab} />
  <Mixer />
</div>

<Toasts />
<ConfirmDialog />
<ShortcutsOverlay open={shortcutsOpen} on:close={() => shortcutsOpen = false} />
<SongsterrBrowser open={browserOpen} on:close={() => browserOpen = false} />
<SettingsDialog open={settingsOpen} on:close={() => settingsOpen = false} />
<PlaylistsView
  open={playlistsOpen}
  on:close={() => playlistsOpen = false}
  on:load={handleSidebarLoad}
/>

<style>
  .app-shell {
    width:  100%;
    height: 100%;
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr var(--mixer-width);
    grid-template-rows:    48px 1fr var(--control-bar-height);
    grid-template-areas:
      't t t'
      's main m'
      'f f f';
    overflow: hidden;
    background: var(--bg-base);
    transition: grid-template-columns var(--transition-slow);
    position: relative;
  }

  .app-shell.sidebar-collapsed {
    grid-template-columns: 0 1fr var(--mixer-width);
  }
  .app-shell.mixer-collapsed {
    grid-template-columns: var(--sidebar-width) 1fr 0;
  }
  .app-shell.sidebar-collapsed.mixer-collapsed {
    grid-template-columns: 0 1fr 0;
  }

  /* While dragging: no text selection, and no column animation — the grid
     transition otherwise makes the panel lag behind the pointer. */
  .app-shell.is-resizing {
    cursor: col-resize;
    user-select: none;
    transition: none;
  }

  /* Vertical drag handle overlaid at column boundaries */
  .resize-handle {
    position: absolute;
    top: 48px;                      /* below titlebar */
    bottom: var(--control-bar-height);
    width: 6px;
    transform: translateX(-50%);    /* centered on the column boundary */
    cursor: col-resize;
    z-index: 100;
    border-radius: 3px;
    background: transparent;
    transition: background 120ms;
  }
  .resize-handle.right {
    transform: translateX(50%);     /* `right:` anchors the other edge */
  }
  .resize-handle:hover,
  .resize-handle.active {
    background: var(--accent);
    opacity: 0.35;
  }
</style>
