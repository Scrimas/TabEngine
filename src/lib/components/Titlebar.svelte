<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  export let sidebarOpen = true;
  export let mixerOpen   = true;
  export let theme: 'parchment' | 'dark' = 'parchment';

  const win = getCurrentWindow();
  const dispatch = createEventDispatcher();

  function minimize()   { win.minimize(); }
  function toggleMax()  { win.toggleMaximize(); }
  function close()      { win.close(); }
</script>

<header class="titlebar">
  <div class="titlebar-left" data-tauri-drag-region>
    <!-- Logo: three stave lines -->
    <div class="logo-icon" aria-hidden="true">
      <div class="stave-line"></div>
      <div class="stave-line short"></div>
      <div class="stave-line"></div>
    </div>
    <span class="app-name">TabEngine</span>
    <span class="studio-badge">STUDIO</span>

    <div class="tb-sep" aria-hidden="true"></div>

    <!-- Sidebar toggle -->
    <button
      class="tb-btn"
      class:active={sidebarOpen}
      on:click={() => dispatch('toggle-sidebar')}
      title="Toggle library panel (Ctrl+B)"
      aria-label="Toggle library panel"
      aria-pressed={sidebarOpen}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
      </svg>
    </button>

    <!-- Mixer toggle -->
    <button
      class="tb-btn"
      class:active={mixerOpen}
      on:click={() => dispatch('toggle-mixer')}
      title="Toggle mixer panel (Ctrl+M)"
      aria-label="Toggle mixer panel"
      aria-pressed={mixerOpen}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="15" y1="3" x2="15" y2="21"/>
      </svg>
    </button>
  </div>

  <div class="titlebar-right">
    <!-- Theme toggle — shows CURRENT theme (sun = parchment, moon = dark) -->
    <button
      class="tb-btn theme-btn"
      on:click={() => dispatch('toggle-theme')}
      title="Switch theme (currently {theme === 'parchment' ? 'parchment' : 'dark'})"
      aria-label="Toggle theme"
    >
      {#if theme === 'parchment'}
        <!-- Sun icon — currently in light/parchment mode -->
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2"  x2="12" y2="4"/>
          <line x1="12" y1="20" x2="12" y2="22"/>
          <line x1="4.22" y1="4.22"  x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="2"  y1="12" x2="4"  y2="12"/>
          <line x1="20" y1="12" x2="22" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
        </svg>
      {:else}
        <!-- Moon icon — currently in dark mode -->
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      {/if}
    </button>

    <!-- Settings -->
    <button class="tb-btn" on:click={() => dispatch('toggle-settings')}
            title="Settings (Ctrl+,)" aria-label="Settings">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round">
        <path d="M4 8h9"/><path d="M17 8h3"/><circle cx="15" cy="8" r="2"/>
        <path d="M4 16h3"/><path d="M11 16h9"/><circle cx="9" cy="16" r="2"/>
      </svg>
    </button>

    <div class="tb-sep" aria-hidden="true"></div>

    <button class="tb-btn" on:click={minimize} title="Minimize" aria-label="Minimize">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round">
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
    <button class="tb-btn" on:click={toggleMax} title="Maximize" aria-label="Maximize">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8">
        <rect x="6" y="6" width="12" height="12" rx="2"/>
      </svg>
    </button>
    <button class="tb-btn close" on:click={close} title="Close" aria-label="Close">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round">
        <line x1="7" y1="7" x2="17" y2="17"/>
        <line x1="17" y1="7" x2="7" y2="17"/>
      </svg>
    </button>
  </div>
</header>

<style>
  .titlebar {
    grid-area: t;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    height: 48px;
    flex-shrink: 0;
    user-select: none;
  }

  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
  }

  .logo-icon {
    width: 27px;
    height: 27px;
    border-radius: 8px;
    background: rgba(45, 212, 191, 0.14);
    border: 1px solid rgba(45, 212, 191, 0.32);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3.5px;
    padding: 0 6px;
    flex-shrink: 0;
    margin-right: 5px;
  }

  .stave-line {
    height: 1.6px;
    border-radius: 2px;
    background: #c07838;
  }
  .stave-line.short {
    width: 66%;
    opacity: 0.55;
  }

  .app-name {
    font-weight: 700;
    font-size: 14.5px;
    letter-spacing: 0.2px;
    color: var(--text-primary);
    margin-right: 4px;
  }

  .studio-badge {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 2px 5px;
    margin-right: 4px;
  }

  .titlebar-right {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .tb-sep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 3px;
  }

  .tb-btn {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .tb-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .tb-btn.active {
    background: var(--accent-dim);
    color: var(--accent);
  }
  .tb-btn.close:hover {
    background: rgba(176, 58, 46, 0.12);
    color: var(--red);
  }
  .tb-btn.theme-btn:hover {
    background: var(--accent-dim);
    color: var(--accent);
  }
</style>
