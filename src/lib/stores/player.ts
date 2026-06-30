// stores/player.ts — reactive player state (Svelte writable store)

import { writable, derived, get } from 'svelte/store';
import { DEFAULT_PLAYER_STATE } from '$lib/types';
import type { PlayerState } from '$lib/types';

export const playerStore = writable<PlayerState>({ ...DEFAULT_PLAYER_STATE });

// Convenience derived values for components that only need one field
export const isPlaying       = derived(playerStore, $s => $s.isPlaying);
export const isReady         = derived(playerStore, $s => $s.isReady);
export const playbackSpeed   = derived(playerStore, $s => $s.playbackSpeed);
export const sfLoadProgress  = derived(playerStore, $s => $s.sfLoadProgress);
export const progressPct     = derived(
  playerStore,
  $s => $s.totalTicks > 0 ? $s.currentTick / $s.totalTicks : 0,
);

/** Partial-update helper so callers don't need to spread the whole state */
export function updatePlayer(patch: Partial<PlayerState>): void {
  playerStore.update(s => ({ ...s, ...patch }));
}

/**
 * Reset playback counters while preserving user-configurable settings.
 * Called automatically on scoreLoaded so position/state resets cleanly.
 */
export function resetPlayer(): void {
  const current = get(playerStore);
  playerStore.set({
    ...DEFAULT_PLAYER_STATE,
    // preserve user preferences across file loads
    playbackSpeed:    current.playbackSpeed,
    metronomeEnabled: current.metronomeEnabled,
    masterVolume:     current.masterVolume,
    countInEnabled:   current.countInEnabled,
  });
}
