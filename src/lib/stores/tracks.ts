// stores/tracks.ts — reactive track/mixer state

import { writable, derived } from 'svelte/store';
import type { TrackState } from '$lib/types';

export const tracksStore = writable<TrackState[]>([]);

/** True when any track is soloed (affects how mute rendering works) */
export const anySoloed = derived(
  tracksStore,
  $tracks => $tracks.some(t => t.soloed),
);

/** Update a single property of a single track by index */
export function updateTrack(index: number, patch: Partial<TrackState>): void {
  tracksStore.update(tracks =>
    tracks.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  );
}

/** Replace the entire track list (called on scoreLoaded) */
export function setTracks(tracks: TrackState[]): void {
  tracksStore.set(tracks);
}

/** Reset all mute/solo state */
export function clearMixerState(): void {
  tracksStore.update(tracks =>
    tracks.map(t => ({ ...t, muted: false, soloed: false, volume: 16, pan: 0 })),
  );
}
