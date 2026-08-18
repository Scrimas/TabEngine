// stores/overlays.ts — counts transient overlays (popovers, context menus).
//
// App.svelte's global Escape handler stops playback — but only when nothing
// transient is open, so the first Escape closes the overlay and a second one
// stops playback. Components that own a popover/menu report open/close here.

import { writable, get } from 'svelte/store';

const count = writable(0);

export function overlayOpened(): void {
  count.update(n => n + 1);
}

export function overlayClosed(): void {
  count.update(n => Math.max(0, n - 1));
}

export function anyOverlayOpen(): boolean {
  return get(count) > 0;
}
