// stores/songsterr.ts — Songsterr search & fetch state

import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import type { SongsterrSearchState, SongsterrSong } from '$lib/types';

const PAGE_SIZE = 20;

const DEFAULT_STATE: SongsterrSearchState = {
  query:       '',
  results:     [],
  isSearching: false,
  isFetching:  false,
  error:       null,
  hasMore:     true,
  offset:      0,
  selected:    null,
};

export const songsterrStore = writable<SongsterrSearchState>({ ...DEFAULT_STATE });

// ── Debounced search ─────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Trigger a debounced search. Resets results and offset.
 * Waits 300ms after the last keystroke before hitting the API.
 */
export function searchDebounced(query: string): void {
  songsterrStore.update(s => ({
    ...s,
    query,
    error: null,
  }));

  if (debounceTimer) clearTimeout(debounceTimer);

  const trimmed = query.trim();
  if (!trimmed) {
    songsterrStore.update(s => ({
      ...s,
      results: [],
      hasMore: true,
      offset: 0,
      isSearching: false,
    }));
    return;
  }

  songsterrStore.update(s => ({ ...s, isSearching: true }));

  debounceTimer = setTimeout(() => {
    executeSearch(trimmed, 0, true);
  }, 300);
}

/**
 * Load the next page of results (called on infinite scroll).
 */
export function loadMore(): void {
  const state = get(songsterrStore);
  if (state.isSearching || !state.hasMore || !state.query.trim()) return;

  songsterrStore.update(s => ({ ...s, isSearching: true }));
  executeSearch(state.query.trim(), state.offset, false);
}

async function executeSearch(
  query: string,
  from: number,
  reset: boolean,
): Promise<void> {
  try {
    const results: SongsterrSong[] = await invoke('songsterr_search', {
      query,
      instrument: null,
      size: PAGE_SIZE,
      from,
    });

    songsterrStore.update(s => ({
      ...s,
      results:     reset ? results : [...s.results, ...results],
      isSearching: false,
      error:       null,
      hasMore:     results.length >= PAGE_SIZE,
      offset:      (reset ? 0 : s.offset) + results.length,
    }));
  } catch (err) {
    songsterrStore.update(s => ({
      ...s,
      isSearching: false,
      error:       String(err),
    }));
  }
}

// ── Selection ────────────────────────────────────────────────────────────────

export function selectSong(song: SongsterrSong | null): void {
  if (!song) {
    songsterrStore.update(s => ({ ...s, selected: null }));
    return;
  }

  // Set loading status immediately
  songsterrStore.update(s => ({
    ...s,
    selected: { ...song, restrictionStatus: 'loading' },
  }));

  // Fetch from Rust backend
  invoke<string>('songsterr_check_restriction', { songId: song.id })
    .then((status) => {
      songsterrStore.update(s => {
        // Ensure the user hasn't switched selections in the meantime
        if (s.selected && s.selected.id === song.id) {
          return {
            ...s,
            selected: {
              ...s.selected,
              restrictionStatus: status as any,
            },
          };
        }
        return s;
      });
    })
    .catch((err) => {
      console.error('[Songsterr Store] Restriction check failed:', err);
      songsterrStore.update(s => {
        if (s.selected && s.selected.id === song.id) {
          return {
            ...s,
            selected: {
              ...s.selected,
              restrictionStatus: 'error',
            },
          };
        }
        return s;
      });
    });
}

// ── Fetch tab bytes ──────────────────────────────────────────────────────────

/**
 * Fetch the raw Guitar Pro bytes for a song from Songsterr.
 * Returns a Uint8Array ready for AlphaTabManager.loadFromBytes().
 */
export async function fetchTabBytes(songId: number): Promise<Uint8Array> {
  songsterrStore.update(s => ({ ...s, isFetching: true, error: null }));
  try {
    const bytes: number[] = await invoke('songsterr_fetch_tab', { songId });
    songsterrStore.update(s => ({ ...s, isFetching: false }));
    return new Uint8Array(bytes);
  } catch (err) {
    songsterrStore.update(s => ({
      ...s,
      isFetching: false,
      error:      `Failed to load tab: ${err}`,
    }));
    throw err;
  }
}

// ── Reset ────────────────────────────────────────────────────────────────────

export function resetSongsterr(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  songsterrStore.set({ ...DEFAULT_STATE });
}
