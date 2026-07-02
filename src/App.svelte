<script lang="ts">
  import { onMount } from 'svelte';
  import Titlebar    from '$lib/components/Titlebar.svelte';
  import ScoreViewer from '$lib/components/ScoreViewer.svelte';
  import ControlBar  from '$lib/components/ControlBar.svelte';
  import Mixer       from '$lib/components/Mixer.svelte';
  import Sidebar     from '$lib/components/Sidebar.svelte';
  import SongsterrBrowser from '$lib/components/SongsterrBrowser.svelte';
  import SettingsDialog   from '$lib/components/SettingsDialog.svelte';

  import {
    playPause, stop, seekToPrevBar, seekToNextBar, seekToPrevRow, seekToNextRow,
    setThemeSettings, setMetronomeVolumeLimit, setCountInBarLimit,
  } from '$lib/alphatab/AlphaTabManager';

  import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import {
    libraryStore, recordOpen, importFileToLibrary,
    resolveLibraryDir, saveBytesToLibrary,
  } from '$lib/stores/library';
  import { settingsStore, updateSettings } from '$lib/stores/settings';
  import type { LibraryEntry } from '$lib/types';

  let sidebarOpen  = true;
  let mixerOpen    = true;
  let browserOpen  = false;
  let settingsOpen = false;

  let scoreViewer: ScoreViewer;

  // ── Panel resize ──────────────────────────────────────────────────────────────
  let sidebarWidth = 288;
  let mixerWidth   = 332;
  const MIN_PANEL  = 160;
  const MAX_PANEL  = 600;

  let resizing: 'sidebar' | 'mixer' | null = null;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

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
      sidebarWidth = Math.max(MIN_PANEL, Math.min(MAX_PANEL, resizeStartWidth + delta));
    } else {
      mixerWidth = Math.max(MIN_PANEL, Math.min(MAX_PANEL, resizeStartWidth - delta));
    }
  }

  function stopResize() {
    resizing = null;
  }

  // ── Settings sync ─────────────────────────────────────────────────────────────
  $: {
    const s = $settingsStore;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark-theme', s.theme === 'dark');
    }
    setThemeSettings(s.theme);
    setMetronomeVolumeLimit(s.metronomeVolume);
    setCountInBarLimit(s.countInBars);
  }

  function toggleTheme() {
    updateSettings({ theme: $settingsStore.theme === 'parchment' ? 'dark' : 'parchment' });
  }

  // ── Sidebar load ──────────────────────────────────────────────────────────────
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
    } catch (err) {
      console.error('[App] Quick save file error:', err);
      alert(`Failed to save file: ${err}`);
    }
  }

  // ── Open file dialog ──────────────────────────────────────────────────────────
  async function openFileViaDialog() {
    try {
      const selected = await tauriOpen({
        multiple: false,
        filters: [{ name: 'Guitar Pro', extensions: ['gp', 'gp3', 'gp4', 'gp5', 'gpx'] }],
      });
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : selected[0];
      if (!path) return;
      const importedPath = await importFileToLibrary(path);
      const meta: LibraryEntry = await invoke('file_metadata', { path: importedPath });
      recordOpen(meta);
      await scoreViewer?.loadFile(importedPath);
    } catch (err) {
      console.error('[App] Dialog open error:', err);
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

    switch (true) {
      case e.code === 'Space' && !e.ctrlKey:
        e.preventDefault();
        playPause();
        break;
      case e.code === 'Escape':
        stop();
        break;
      case e.code === 'KeyO' && e.ctrlKey:
        e.preventDefault();
        openFileViaDialog();
        break;
      case e.code === 'KeyB' && e.ctrlKey:
        e.preventDefault();
        sidebarOpen = !sidebarOpen;
        break;
      case e.code === 'KeyM' && e.ctrlKey && !e.shiftKey:
        e.preventDefault();
        mixerOpen = !mixerOpen;
        break;
      case e.code === 'KeyF' && e.ctrlKey && e.shiftKey:
        e.preventDefault();
        browserOpen = !browserOpen;
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
    // Release any stuck resize if the window loses focus (pointer released outside webview)
    const onBlur = () => { resizing = null; };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  });
</script>

<svelte:window on:keydown={handleKeyDown} />

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
    on:toggle-settings={() => settingsOpen = !settingsOpen}
    on:toggle-sidebar={() => sidebarOpen = !sidebarOpen}
    on:toggle-mixer={() => mixerOpen = !mixerOpen}
    on:toggle-theme={toggleTheme}
  />
  <Sidebar on:load={handleSidebarLoad} on:open-browser={() => browserOpen = !browserOpen} />

  <!-- Sidebar drag handle -->
  {#if sidebarOpen}
    <div
      class="resize-handle"
      style="left: {sidebarWidth - 3}px"
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
      class="resize-handle"
      style="right: {mixerWidth - 3}px"
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

<SongsterrBrowser open={browserOpen} on:close={() => browserOpen = false} />
<SettingsDialog open={settingsOpen} on:close={() => settingsOpen = false} />

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

  /* Prevent text selection while dragging a panel border */
  .app-shell.is-resizing {
    cursor: col-resize;
    user-select: none;
  }

  /* Vertical drag handle overlaid at column boundaries */
  .resize-handle {
    position: absolute;
    top: 48px;                      /* below titlebar */
    bottom: var(--control-bar-height);
    width: 6px;
    transform: translateX(-50%);
    cursor: col-resize;
    z-index: 100;
    border-radius: 3px;
    background: transparent;
    transition: background 120ms;
  }
  .resize-handle:hover,
  .app-shell.is-resizing .resize-handle {
    background: var(--accent);
    opacity: 0.35;
  }
</style>
