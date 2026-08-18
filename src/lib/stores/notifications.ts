// stores/notifications.ts — in-app toasts and confirm dialogs.
//
// Replaces the webview's native alert()/confirm(): those block the whole
// process, ignore the app's theme, and look foreign next to the custom
// titlebar. Toasts also give a home to feedback that used to be silent
// (console-only errors, silent successes).

import { writable } from 'svelte/store';

// ── Toasts ───────────────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export const toastsStore = writable<Toast[]>([]);

let nextToastId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Show a toast. Errors/warnings linger longer so they can actually be read. */
export function toast(kind: ToastKind, message: string, timeoutMs?: number): void {
  const id = nextToastId++;
  const ms = timeoutMs ?? (kind === 'error' || kind === 'warning' ? 8000 : 4000);
  toastsStore.update(list => [...list, { id, kind, message }]);
  timers.set(id, setTimeout(() => dismissToast(id), ms));
}

export function dismissToast(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  toastsStore.update(list => list.filter(x => x.id !== id));
}

// ── Confirm dialog ───────────────────────────────────────────────────────────

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Styles the confirm button red for destructive actions. */
  danger: boolean;
  resolve: (confirmed: boolean) => void;
}

export const confirmStore = writable<ConfirmRequest | null>(null);

/**
 * Ask the user to confirm an action via the in-app dialog. Resolves true on
 * confirm, false on cancel/Escape/backdrop. Only one dialog at a time — a
 * second request while one is open auto-cancels the first.
 */
export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise(resolve => {
    confirmStore.update(current => {
      current?.resolve(false);
      return {
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        resolve: (confirmed: boolean) => {
          confirmStore.set(null);
          resolve(confirmed);
        },
      };
    });
  });
}
