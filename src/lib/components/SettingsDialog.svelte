<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { invoke } from '@tauri-apps/api/core';
  import { getVersion } from '@tauri-apps/api/app';
  import { settingsStore, updateSettings } from '$lib/stores/settings';
  import { setLibrary, mergeScannedEntries, resolveLibraryDir } from '$lib/stores/library';
  import { toast, confirmDialog } from '$lib/stores/notifications';
  import type { LibraryEntry } from '$lib/types';

  export let open = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  let activeTab: 'general' | 'library' | 'about' = 'general';

  let appVersion = '';
  onMount(async () => {
    try { appVersion = await getVersion(); } catch { appVersion = '?'; }
  });

  function handleClose()         { dispatch('close'); }
  function handleBackdropClick() { dispatch('close'); }
  function handleKeyDown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') dispatch('close');
  }

  // ── General ────────────────────────────────────────────────────────────────
  function setTheme(theme: 'parchment' | 'dark') {
    updateSettings({ theme });
  }

  // ── Library ────────────────────────────────────────────────────────────────
  let scanning = false;

  async function chooseLibraryDir() {
    try {
      const selected = await tauriOpen({ directory: true, multiple: false });
      if (!selected || typeof selected !== 'string') return;
      updateSettings({ libraryDir: selected });
      toast('success', 'Library folder updated.');
    } catch (err) {
      toast('error', `Could not choose folder: ${err}`);
    }
  }

  function resetLibraryDir() {
    updateSettings({ libraryDir: null });
    toast('info', 'Library folder reset to the app data directory.');
  }

  async function scanLibraryFolder() {
    if (scanning) return;
    scanning = true;
    try {
      const dir = await resolveLibraryDir();
      if (!dir) throw new Error('No library folder is configured.');
      const found: LibraryEntry[] = await invoke('scan_directory_for_gp', { dir });
      const added = mergeScannedEntries(found);
      toast('success', `Scan complete — ${found.length} Guitar Pro file${found.length === 1 ? '' : 's'} found, ${added} new.`);
    } catch (err) {
      toast('error', `Scan failed: ${err}`);
    } finally {
      scanning = false;
    }
  }

  async function clearRecentFiles() {
    const yes = await confirmDialog({
      title: 'Clear library list?',
      message: 'This clears the sidebar file list (no files on disk are touched). Files can be re-added by opening them or scanning the library folder.',
      confirmLabel: 'Clear list',
      danger: true,
    });
    if (!yes) return;
    localStorage.removeItem('tabengine:recent');
    setLibrary([]);
    toast('success', 'Library list cleared.');
  }

  // ── About / update check ───────────────────────────────────────────────────
  interface UpdateCheck {
    current: string;
    latest:  string;
    isNewer: boolean;
    url:     string;
  }

  let updateStatus: 'idle' | 'checking' | 'done' | 'error' = 'idle';
  let updateResult: UpdateCheck | null = null;
  let updateError = '';

  async function checkForUpdates() {
    if (updateStatus === 'checking') return;
    updateStatus = 'checking';
    updateError = '';
    try {
      updateResult = await invoke<UpdateCheck>('check_latest_release');
      updateStatus = 'done';
    } catch (err) {
      updateError = String(err);
      updateStatus = 'error';
    }
  }

  function openUrl(url: string) {
    shellOpen(url).catch((err) => toast('error', `Could not open link: ${err}`));
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="settings-backdrop"
    on:click={handleBackdropClick}
    on:keydown={handleKeyDown}
    role="presentation"
  ></div>

  <!-- Dialog -->
  <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
    <header class="settings-header">
      <div class="header-title">
        <svg class="gear-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <h1>Settings</h1>
      </div>
      <button class="close-btn press" on:click={handleClose} title="Close" aria-label="Close settings">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </header>

    <div class="settings-body">
      <nav class="settings-nav" aria-label="Settings categories">
        <button class="nav-tab" class:active={activeTab === 'general'} on:click={() => activeTab = 'general'}>
          General
        </button>
        <button class="nav-tab" class:active={activeTab === 'library'} on:click={() => activeTab = 'library'}>
          Library
        </button>
        <button class="nav-tab" class:active={activeTab === 'about'} on:click={() => activeTab = 'about'}>
          About
        </button>
      </nav>

      <div class="settings-content">
        {#if activeTab === 'general'}
          <section class="settings-section">
            <h2>General</h2>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Theme</span>
                <span class="desc">Parchment is the warm light look; Dark is easier on the eyes at night.</span>
              </div>
              <div class="segmented" role="group" aria-label="Theme">
                <button
                  class="segment"
                  class:selected={$settingsStore.theme === 'parchment'}
                  on:click={() => setTheme('parchment')}
                  aria-pressed={$settingsStore.theme === 'parchment'}
                >
                  Parchment
                </button>
                <button
                  class="segment"
                  class:selected={$settingsStore.theme === 'dark'}
                  on:click={() => setTheme('dark')}
                  aria-pressed={$settingsStore.theme === 'dark'}
                >
                  Dark
                </button>
              </div>
            </div>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Playback controls</span>
                <span class="desc">Tempo, metronome, count-in, zoom and the speed trainer live in the control bar; layout and notation toggles in the titlebar. Everything persists automatically.</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Keyboard shortcuts</span>
                <span class="desc">Press <kbd>?</kbd> anywhere to open the cheat sheet.</span>
              </div>
            </div>
          </section>
        {:else if activeTab === 'library'}
          <section class="settings-section">
            <h2>Library</h2>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Library folder</span>
                <span class="desc">New and downloaded files are stored here.
                  Currently: <code class="dir-path">{$settingsStore.libraryDir ?? 'app data folder (default)'}</code></span>
              </div>
              <div class="row-actions">
                {#if $settingsStore.libraryDir}
                  <button class="action-btn press" on:click={resetLibraryDir}>Reset</button>
                {/if}
                <button class="action-btn press" on:click={chooseLibraryDir}>Choose…</button>
              </div>
            </div>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Scan library folder</span>
                <span class="desc">Find every Guitar Pro file in the library folder (including subfolders) and add it to the list.</span>
              </div>
              <button class="action-btn press" on:click={scanLibraryFolder} disabled={scanning}>
                {scanning ? 'Scanning…' : 'Scan'}
              </button>
            </div>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Clear library list</span>
                <span class="desc">Empties the sidebar file list. No files on disk are touched.</span>
              </div>
              <button class="action-btn danger press" on:click={clearRecentFiles}>
                Clear list
              </button>
            </div>
          </section>
        {:else}
          <section class="settings-section">
            <h2>About</h2>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">TabEngine</span>
                <span class="desc">Version {appVersion || '…'} — an offline-first Guitar Pro player.</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Updates</span>
                <span class="desc">
                  {#if updateStatus === 'idle'}
                    Checks the GitHub releases page. Nothing is contacted until you click.
                  {:else if updateStatus === 'checking'}
                    Checking…
                  {:else if updateStatus === 'error'}
                    Check failed: {updateError}
                  {:else if updateResult}
                    {#if updateResult.isNewer}
                      Version {updateResult.latest} is available (you have {updateResult.current}).
                    {:else}
                      You're up to date ({updateResult.current}).
                    {/if}
                  {/if}
                </span>
              </div>
              <div class="row-actions">
                {#if updateStatus === 'done' && updateResult?.isNewer}
                  <button class="action-btn press" on:click={() => updateResult && openUrl(updateResult.url)}>
                    Open release
                  </button>
                {/if}
                <button class="action-btn press" on:click={checkForUpdates} disabled={updateStatus === 'checking'}>
                  {updateStatus === 'checking' ? 'Checking…' : 'Check for updates'}
                </button>
              </div>
            </div>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Links</span>
                <span class="desc">Source code, releases, and the issue tracker.</span>
              </div>
              <div class="row-actions">
                <button class="action-btn press" on:click={() => openUrl('https://github.com/Scrimas/TabEngine')}>
                  GitHub
                </button>
                <button class="action-btn press" on:click={() => openUrl('https://github.com/Scrimas/TabEngine/issues')}>
                  Report an issue
                </button>
              </div>
            </div>
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 1000;
    animation: fadeIn 0.15s var(--ease-out);
  }

  .settings-modal {
    position: fixed;
    z-index: 1010;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(700px, calc(100vw - 48px));
    height: min(460px, calc(100vh - 96px));
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: settingsIn 0.18s var(--ease-spring);
  }

  @keyframes settingsIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .header-title {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .gear-icon { color: var(--accent); }
  .header-title h1 {
    font-size: 14.5px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }
  .close-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition), color var(--transition), border-color var(--transition);
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  /* ── Body layout ────────────────────────────────────────────────────────── */
  .settings-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .settings-nav {
    width: 148px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 14px 10px;
    border-right: 1px solid var(--border);
  }
  .nav-tab {
    padding: 8px 12px;
    border-radius: var(--radius);
    text-align: left;
    font-size: 13px;
    font-weight: 600;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .nav-tab:hover {
    background: var(--overlay-subtle);
    color: var(--text-primary);
  }
  .nav-tab.active {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .settings-content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 18px 22px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  /* ── Sections & rows ────────────────────────────────────────────────────── */
  .settings-section h2 {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0 0 6px;
  }

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 13px 0;
    border-bottom: 1px solid var(--border);
  }
  .settings-row:last-child { border-bottom: none; }

  .setting-label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .setting-label .title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .setting-label .desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .dir-path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    word-break: break-all;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    padding: 0 5px;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-primary);
  }

  /* ── Controls ───────────────────────────────────────────────────────────── */
  .row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .action-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: var(--radius);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
    white-space: nowrap;
  }
  .action-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .action-btn.danger {
    background: var(--red-dim);
    border-color: transparent;
    color: var(--red);
  }
  .action-btn.danger:hover:not(:disabled) {
    background: var(--red);
    color: #fff;
  }

  .segmented {
    display: flex;
    padding: 3px;
    gap: 2px;
    background: var(--overlay-subtle);
    border-radius: var(--radius);
    flex-shrink: 0;
  }
  .segment {
    padding: 6px 13px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12.5px;
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .segment:hover { color: var(--text-primary); }
  .segment.selected {
    background: var(--bg-elevated);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }
</style>
