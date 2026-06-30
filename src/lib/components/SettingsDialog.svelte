<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { settingsStore, updateSettings } from '$lib/stores/settings';
  import { libraryStore, setLibrary } from '$lib/stores/library';

  export let open = false;

  const dispatch = createEventDispatcher<{ close: void }>();

  let activeTab: 'playback' | 'library' = 'playback';

  function handleClose() {
    dispatch('close');
  }

  function handleBackdropClick() {
    dispatch('close');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      dispatch('close');
    }
  }

  function clearRecentFiles() {
    if (confirm('Are you sure you want to clear your recently opened files list?')) {
      localStorage.removeItem('tabengine:recent');
      setLibrary([]);
    }
  }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="settings-backdrop"
    on:click={handleBackdropClick}
    on:keydown={handleKeyDown}
    role="presentation"
  ></div>

  <!-- Dialog Window -->
  <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Application Settings">
    <!-- Header -->
    <header class="settings-header">
      <div class="header-title">
        <svg class="gear-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <h1>Settings</h1>
      </div>
      <button class="close-btn press" on:click={handleClose} aria-label="Close settings">
        <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
          <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </header>

    <!-- Main Container -->
    <div class="settings-body">
      <!-- Tabs Sidebar -->
      <nav class="settings-nav" aria-label="Settings categories">
        <button
          class="nav-tab"
          class:active={activeTab === 'playback'}
          on:click={() => activeTab = 'playback'}
        >
          Playback
        </button>
        <button
          class="nav-tab"
          class:active={activeTab === 'library'}
          on:click={() => activeTab = 'library'}
        >
          Library
        </button>
      </nav>

      <!-- Content Area -->
      <div class="settings-content">
        {#if activeTab === 'playback'}
          <section class="settings-section">
            <h2>Playback & Sound</h2>
            
            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Metronome Volume</span>
                <span class="desc">Adjust the volume of the tick count metronome.</span>
              </div>
              <div class="slider-control">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={$settingsStore.metronomeVolume}
                  on:input={(e) => updateSettings({ metronomeVolume: parseInt(e.currentTarget.value) })}
                />
                <span class="value-display">{$settingsStore.metronomeVolume}%</span>
              </div>
            </div>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Count-In Bars</span>
                <span class="desc">Number of empty bars to count in before starting playback.</span>
              </div>
              <div class="option-picker">
                <button
                  class="pick-opt"
                  class:selected={$settingsStore.countInBars === 1}
                  on:click={() => updateSettings({ countInBars: 1 })}
                >
                  1 Bar
                </button>
                <button
                  class="pick-opt"
                  class:selected={$settingsStore.countInBars === 2}
                  on:click={() => updateSettings({ countInBars: 2 })}
                >
                  2 Bars
                </button>
              </div>
            </div>
          </section>
        {:else if activeTab === 'library'}
          <section class="settings-section">
            <h2>Library Administration</h2>

            <div class="settings-row">
              <div class="setting-label">
                <span class="title">Clear Recents</span>
                <span class="desc">Flush recently opened items and scan caches.</span>
              </div>
              <button class="action-btn danger press" on:click={clearRecentFiles}>
                Flush Cache
              </button>
            </div>
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Overlay Layout ──────────────────────────────────────────────────────── */
  .settings-backdrop {
    position: fixed !important;
    inset: 0 !important;
    background: rgba(28, 26, 23, 0.40) !important;
    backdrop-filter: blur(12px) !important;
    z-index: 1000 !important;
  }

  .settings-modal {
    position: fixed !important;
    z-index: 1010 !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    width: 680px !important;
    height: 420px !important;
    background: var(--bg-elevated) !important;
    border: 1px solid var(--border) !important;
    border-radius: var(--radius-lg) !important;
    box-shadow: var(--shadow-lg) !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    animation: scaleIn 0.22s var(--ease-spring) !important;
  }

  @keyframes scaleIn {
    from { transform: translate(-50%, -50%) scale(0.96); opacity: 0; }
    to   { transform: translate(-50%, -50%) scale(1.0);  opacity: 1; }
  }

  /* ── Header ──────────────────────────────────────────────────────────────── */
  .settings-header {
    height: 56px !important;
    padding: 0 20px !important;
    border-bottom: 1px solid var(--border) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    flex-shrink: 0 !important;
    background: rgba(0, 0, 0, 0.02) !important;
  }

  .header-title {
    display: flex !important;
    align-items: center !important;
    gap: 10px !important;
  }

  .gear-icon {
    color: var(--accent) !important;
  }

  .settings-header h1 {
    font-size: 16px !important;
    font-weight: 600 !important;
    color: var(--text-primary) !important;
  }

  .close-btn {
    width: 28px !important;
    height: 28px !important;
    border-radius: 50% !important;
    border: none !important;
    background: transparent !important;
    color: var(--text-muted) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer !important;
    transition: var(--transition) !important;
  }

  .close-btn:hover {
    background: var(--bg-hover) !important;
    color: var(--text-primary) !important;
  }

  /* ── Split Body Layout ───────────────────────────────────────────────────── */
  .settings-body {
    flex: 1 !important;
    display: flex !important;
    overflow: hidden !important;
  }

  .settings-nav {
    width: 160px !important;
    border-right: 1px solid var(--border) !important;
    padding: 16px 8px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 6px !important;
    background: rgba(0, 0, 0, 0.01) !important;
    flex-shrink: 0 !important;
  }

  .nav-tab {
    width: 100% !important;
    text-align: left !important;
    padding: 10px 14px !important;
    border: none !important;
    border-radius: var(--radius-sm) !important;
    background: transparent !important;
    color: var(--text-secondary) !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    transition: var(--transition) !important;
  }

  .nav-tab:hover {
    background: var(--bg-hover) !important;
    color: var(--text-primary) !important;
  }

  .nav-tab.active {
    background: var(--accent-dim) !important;
    color: var(--accent) !important;
    font-weight: 600 !important;
  }

  /* ── Content & Settings Items ────────────────────────────────────────────── */
  .settings-content {
    flex: 1 !important;
    padding: 24px 28px !important;
    overflow-y: auto !important;
  }

  .settings-section h2 {
    font-size: 12px !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.8px !important;
    color: var(--text-muted) !important;
    margin-bottom: 18px !important;
  }

  .settings-row {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 16px 0 !important;
    border-bottom: 1px solid rgba(43, 40, 35, 0.05) !important;
    gap: 20px !important;
  }

  .settings-row:last-child {
    border-bottom: none !important;
  }

  .setting-label {
    display: flex !important;
    flex-direction: column !important;
    gap: 4px !important;
    max-width: 320px !important;
  }

  .setting-label .title {
    font-size: 14px !important;
    font-weight: 600 !important;
    color: var(--text-primary) !important;
  }

  .setting-label .desc {
    font-size: 12px !important;
    color: var(--text-secondary) !important;
    line-height: 1.4 !important;
  }

  /* ── Interactive Input Widgets ───────────────────────────────────────────── */
  
  /* Range Slider */
  .slider-control {
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
  }

  .slider-control input[type="range"] {
    width: 140px !important;
    accent-color: var(--accent) !important;
    cursor: pointer !important;
  }

  .value-display {
    font-size: 13px !important;
    font-weight: 600 !important;
    color: var(--text-primary) !important;
    min-width: 36px !important;
    text-align: right !important;
  }

  /* Option pickers */
  .option-picker {
    display: flex !important;
    background: rgba(0, 0, 0, 0.05) !important;
    border-radius: var(--radius) !important;
    padding: 3px !important;
  }

  .pick-opt {
    padding: 6px 14px !important;
    border: none !important;
    background: transparent !important;
    color: var(--text-secondary) !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    border-radius: var(--radius-sm) !important;
    cursor: pointer !important;
    transition: var(--transition) !important;
  }

  .pick-opt:hover {
    color: var(--text-primary) !important;
  }

  .pick-opt.selected {
    background: var(--bg-elevated) !important;
    color: var(--accent) !important;
    box-shadow: var(--shadow-sm) !important;
  }

  /* Button Actions */
  .action-btn {
    height: 36px !important;
    padding: 0 16px !important;
    border: none !important;
    border-radius: var(--radius) !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: var(--transition) !important;
  }

  .action-btn.danger {
    background: var(--red-dim) !important;
    color: var(--red) !important;
  }

  .action-btn.danger:hover {
    background: var(--red) !important;
    color: #fff !important;
  }
</style>
