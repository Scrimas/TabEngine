<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { focusTrap } from '$lib/actions/focusTrap';

  export let open = false;
  const dispatch = createEventDispatcher<{ close: void }>();

  interface Shortcut { keys: string[]; label: string; }
  interface ShortcutGroup { title: string; items: Shortcut[]; }

  const GROUPS: ShortcutGroup[] = [
    {
      title: 'Playback',
      items: [
        { keys: ['Space'],  label: 'Play / pause' },
        { keys: ['Esc'],    label: 'Stop' },
        { keys: ['['],      label: 'Loop start at current bar' },
        { keys: [']'],      label: 'Loop end at current bar' },
      ],
    },
    {
      title: 'Navigation',
      items: [
        { keys: ['←', '→'], label: 'Previous / next bar' },
        { keys: ['↑', '↓'], label: 'Row above / below' },
        { keys: ['Ctrl', '↑↓'], label: 'Reorder playlist row (focused)' },
      ],
    },
    {
      title: 'Panels & views',
      items: [
        { keys: ['Ctrl', 'B'],          label: 'Toggle library sidebar' },
        { keys: ['Ctrl', 'M'],          label: 'Toggle mixer' },
        { keys: ['Ctrl', 'Shift', 'F'], label: 'Songsterr browser' },
        { keys: ['Ctrl', 'Shift', 'P'], label: 'Playlists' },
        { keys: ['Ctrl', ','],          label: 'Settings' },
        { keys: ['F11'],                label: 'Fullscreen' },
        { keys: ['?'],                  label: 'This cheat sheet' },
      ],
    },
    {
      title: 'Files',
      items: [
        { keys: ['Ctrl', 'O'], label: 'Open file' },
      ],
    },
    {
      title: 'Tempo popover',
      items: [
        { keys: ['+', '−'], label: 'Adjust speed' },
        { keys: ['0'],      label: 'Reset to 100%' },
      ],
    },
  ];

  function handleKeyDown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dispatch('close');
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="shortcuts-backdrop" on:click={() => dispatch('close')}></div>
  <div
    class="shortcuts-panel"
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    use:focusTrap
  >
    <div class="shortcuts-header">
      <h2>Keyboard shortcuts</h2>
      <button class="close-btn press" on:click={() => dispatch('close')} title="Close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="shortcuts-grid">
      {#each GROUPS as group (group.title)}
        <section class="shortcut-group">
          <h3>{group.title}</h3>
          {#each group.items as item}
            <div class="shortcut-row">
              <span class="shortcut-label">{item.label}</span>
              <span class="shortcut-keys">
                {#each item.keys as key, i}
                  {#if i > 0}<span class="key-sep">+</span>{/if}
                  <kbd>{key}</kbd>
                {/each}
              </span>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </div>
{/if}

<style>
  .shortcuts-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 1000;
    animation: fadeIn 0.15s var(--ease-out);
  }

  .shortcuts-panel {
    position: fixed;
    z-index: 1010;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - 48px));
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 20px 24px 24px;
    animation: panelIn 0.18s var(--ease-spring);
  }
  .shortcuts-panel:focus { outline: none; }

  @keyframes panelIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .shortcuts-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .shortcuts-header h2 {
    font-size: 15px;
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

  .shortcuts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
  }
  @media (max-width: 560px) {
    .shortcuts-grid { grid-template-columns: 1fr; }
  }

  .shortcut-group h3 {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
  }
  .shortcut-label {
    font-size: 13px;
    color: var(--text-secondary);
  }
  .shortcut-keys {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .key-sep {
    font-size: 11px;
    color: var(--text-muted);
  }
  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
  }
</style>
