<script lang="ts">
  import { confirmStore } from '$lib/stores/notifications';

  // Focus the cancel button on open (safe default for destructive dialogs)
  // and restore focus to whatever had it before the dialog appeared.
  let previouslyFocused: HTMLElement | null = null;
  let cancelBtn: HTMLButtonElement | null = null;
  let dialogEl: HTMLDivElement | null = null;

  $: if ($confirmStore && cancelBtn) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    cancelBtn.focus();
  } else if (!$confirmStore && previouslyFocused) {
    previouslyFocused.focus?.();
    previouslyFocused = null;
  }

  function handleKeyDown(e: KeyboardEvent) {
    const req = $confirmStore;
    if (!req) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      req.resolve(false);
    } else if (e.key === 'Tab') {
      // Two-control focus trap: keep Tab cycling between Cancel and Confirm.
      e.preventDefault();
      const buttons = dialogEl?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons || buttons.length === 0) return;
      const focused = document.activeElement;
      const next = focused === buttons[0] ? buttons[buttons.length - 1] : buttons[0];
      next.focus();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if $confirmStore}
  {@const req = $confirmStore}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="confirm-backdrop" on:click={() => req.resolve(false)}></div>
  <div
    class="confirm-dialog"
    role="alertdialog"
    aria-modal="true"
    aria-label={req.title}
    bind:this={dialogEl}
  >
    <h2 class="confirm-title">{req.title}</h2>
    <p class="confirm-message">{req.message}</p>
    <div class="confirm-actions">
      <button class="confirm-btn cancel press" bind:this={cancelBtn} on:click={() => req.resolve(false)}>
        {req.cancelLabel}
      </button>
      <button class="confirm-btn ok press" class:danger={req.danger} on:click={() => req.resolve(true)}>
        {req.confirmLabel}
      </button>
    </div>
  </div>
{/if}

<style>
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 1100;             /* above every other modal */
    animation: fadeIn 0.15s var(--ease-out);
  }

  .confirm-dialog {
    position: fixed;
    z-index: 1110;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(400px, calc(100vw - 48px));
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 20px;
    animation: confirmIn 0.18s var(--ease-spring);
  }

  @keyframes confirmIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .confirm-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 8px;
  }

  .confirm-message {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0 0 18px;
    white-space: pre-line;
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .confirm-btn {
    height: 34px;
    padding: 0 16px;
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .confirm-btn.cancel {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }
  .confirm-btn.cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .confirm-btn.ok {
    background: var(--accent);
    border: 1px solid transparent;
    color: #fff;
  }
  .confirm-btn.ok:hover { background: var(--accent-bright); }
  .confirm-btn.ok.danger { background: var(--red); }
  .confirm-btn.ok.danger:hover { filter: brightness(1.1); }
</style>
