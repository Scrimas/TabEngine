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
    <!-- Logo: pick mark with tab-staff lines -->
    <div class="logo-icon" aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 123 100">
        <defs>
          <clipPath id="titlebar-pick-clip">
            <path d="M122.66,54.07 C121.77,56.36 120.1,58.29 116.91,60.69 C115.84,61.5 113.85,63.06 112.5,64.16 C111.14,65.26 108.59,67.18 106.85,68.42 C102.95,71.19 91.67,78.2 89.44,79.24 C88.54,79.66 87.26,80.36 86.59,80.8 C83.53,82.8 68.51,89.78 63.86,91.36 C63.3,91.55 62.71,91.8 62.56,91.91 C61.41,92.77 53.56,95.43 45.67,97.65 C38.82,99.58 31.52,100 26.47,98.76 C20.94,97.41 16.46,95.03 12.31,91.22 C8.97,88.16 6.57,84.66 4.85,80.33 C3.55,77.08 1.75,70.05 0.87,64.79 C0.05,59.86 0.03,59.6 0.02,51.39 C0,42.66 0.07,41.82 1.33,35.01 C2.12,30.75 3.11,27.1 4.69,22.57 C6.75,16.65 8.9,13.22 12.81,9.63 C20,3.03 29.6,0 38.93,1.39 C43.89,2.14 53.73,5.32 64.21,9.58 C76.64,14.63 89.85,21.67 99.75,28.53 C101.38,29.66 103.19,30.9 103.77,31.29 C108.11,34.15 117.42,41.64 119.87,44.22 C122.22,46.71 122.95,48.21 123.06,50.78 C123.12,52.32 123.02,53.13 122.66,54.07 Z"></path>
          </clipPath>
        </defs>
        <path d="M122.66,54.07 C121.77,56.36 120.1,58.29 116.91,60.69 C115.84,61.5 113.85,63.06 112.5,64.16 C111.14,65.26 108.59,67.18 106.85,68.42 C102.95,71.19 91.67,78.2 89.44,79.24 C88.54,79.66 87.26,80.36 86.59,80.8 C83.53,82.8 68.51,89.78 63.86,91.36 C63.3,91.55 62.71,91.8 62.56,91.91 C61.41,92.77 53.56,95.43 45.67,97.65 C38.82,99.58 31.52,100 26.47,98.76 C20.94,97.41 16.46,95.03 12.31,91.22 C8.97,88.16 6.57,84.66 4.85,80.33 C3.55,77.08 1.75,70.05 0.87,64.79 C0.05,59.86 0.03,59.6 0.02,51.39 C0,42.66 0.07,41.82 1.33,35.01 C2.12,30.75 3.11,27.1 4.69,22.57 C6.75,16.65 8.9,13.22 12.81,9.63 C20,3.03 29.6,0 38.93,1.39 C43.89,2.14 53.73,5.32 64.21,9.58 C76.64,14.63 89.85,21.67 99.75,28.53 C101.38,29.66 103.19,30.9 103.77,31.29 C108.11,34.15 117.42,41.64 119.87,44.22 C122.22,46.71 122.95,48.21 123.06,50.78 C123.12,52.32 123.02,53.13 122.66,54.07 Z" fill="var(--logo-ink)"></path>
        <g clip-path="url(#titlebar-pick-clip)">
          <rect x="-15" y="10.25" width="160" height="7.5" fill="var(--accent)"></rect>
          <rect x="-15" y="34.25" width="160" height="7.5" fill="var(--accent)"></rect>
          <rect x="-15" y="58.25" width="160" height="7.5" fill="var(--accent)"></rect>
          <rect x="-15" y="82.25" width="160" height="7.5" fill="var(--accent)"></rect>
        </g>
      </svg>
    </div>
    <span class="app-name"><span class="app-name-tab">Tab</span><span class="app-name-engine">Engine</span></span>

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
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--accent);
    flex-shrink: 0;
    margin-right: 5px;
    padding: 3px;
    box-sizing: border-box;
  }

  .app-name {
    font-family: var(--font-logo);
    font-size: 19px;
    letter-spacing: 0.01em;
    color: var(--text-primary);
    margin-right: 4px;
  }

  .app-name-tab {
    font-weight: 500;
  }

  .app-name-engine {
    font-weight: 700;
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
