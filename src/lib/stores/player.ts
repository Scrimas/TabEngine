// stores/player.ts — reactive player state (Svelte writable store)

import { writable, derived, get } from 'svelte/store';
import { DEFAULT_PLAYER_STATE, DEFAULT_PLAYBACK_POSITION } from '$lib/types';
import type { PlayerState, PlaybackPosition } from '$lib/types';

export const playerStore = writable<PlayerState>({ ...DEFAULT_PLAYER_STATE });

// Transport position — separate store on purpose. alphaTab fires
// playerPositionChanged once per 128-sample audio quantum (~375/s); routing
// that through playerStore re-ran every subscriber (control bar, loop
// overlay, mixer, loading overlay, score viewer) at that rate. Only the
// control bar reads this one, and AlphaTabManager flushes it at most every
// POSITION_FLUSH_MS, aligned to animation frames.
export const positionStore = writable<PlaybackPosition>({ ...DEFAULT_PLAYBACK_POSITION });

// Convenience derived values for components that only need one field
export const isPlaying       = derived(playerStore, $s => $s.isPlaying);
export const isReady         = derived(playerStore, $s => $s.isReady);
export const playbackSpeed   = derived(playerStore, $s => $s.playbackSpeed);
export const sfLoadProgress  = derived(playerStore, $s => $s.sfLoadProgress);
export const progressPct     = derived(
  positionStore,
  $p => $p.totalTicks > 0 ? $p.currentTick / $p.totalTicks : 0,
);

// ── Speed trainer ─────────────────────────────────────────────────────────────
// Progressive-tempo practice: while loop is on, each completed pass bumps the
// playback speed by stepPct until targetPct is reached. Session-only state;
// AlphaTabManager watches loop wraps and applies the bumps.
export interface SpeedTrainerState {
  enabled:   boolean;
  startPct:  number; // speed applied when the trainer is switched on
  stepPct:   number; // added after each completed loop pass
  targetPct: number; // ceiling
}

export const speedTrainerStore = writable<SpeedTrainerState>({
  enabled:   false,
  startPct:  50,
  stepPct:   5,
  targetPct: 100,
});

/** Partial-update helper so callers don't need to spread the whole state */
export function updatePlayer(patch: Partial<PlayerState>): void {
  playerStore.update(s => ({ ...s, ...patch }));
}

export function updatePosition(patch: Partial<PlaybackPosition>): void {
  positionStore.update(p => ({ ...p, ...patch }));
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
  positionStore.set({ ...DEFAULT_PLAYBACK_POSITION });
}
