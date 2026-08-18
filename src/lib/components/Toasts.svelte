<script lang="ts">
  import { toastsStore, dismissToast } from '$lib/stores/notifications';
  import type { ToastKind } from '$lib/stores/notifications';

  const ICONS: Record<ToastKind, string> = {
    success: 'M20 6L9 17l-5-5',
    error:   'M12 8v5M12 16.5v.01',
    warning: 'M12 9v4M12 17v.01',
    info:    'M12 11v6M12 7v.01',
  };
</script>

{#if $toastsStore.length > 0}
  <div class="toast-stack" aria-live="polite">
    {#each $toastsStore as t (t.id)}
      <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
        <svg class="toast-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true">
          {#if t.kind === 'success'}
            <path d={ICONS.success}/>
          {:else}
            <circle cx="12" cy="12" r="9"/>
            <path d={ICONS[t.kind]}/>
          {/if}
        </svg>
        <span class="toast-msg">{t.message}</span>
        <button class="toast-close" on:click={() => dismissToast(t.id)} aria-label="Dismiss notification">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    top: 58px;               /* below the titlebar */
    right: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 1200;           /* above every modal (settings sits at 1010) */
    max-width: min(420px, calc(100vw - 28px));
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    box-shadow: var(--shadow);
    animation: toastIn 0.22s var(--ease-out);
  }
  .toast.success { border-left-color: var(--green); }
  .toast.error   { border-left-color: var(--red); }
  .toast.warning { border-left-color: var(--amber); }
  .toast.info    { border-left-color: var(--accent); }

  .toast-icon {
    flex-shrink: 0;
    margin-top: 2px;
  }
  .toast.success .toast-icon { color: var(--green); }
  .toast.error   .toast-icon { color: var(--red); }
  .toast.warning .toast-icon { color: var(--amber); }
  .toast.info    .toast-icon { color: var(--accent); }

  .toast-msg {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .toast-close {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .toast-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
</style>
