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

// Monotonic token identifying the most recent search request. A response is
// only applied if its token still matches — otherwise a slow response for an
// old query would overwrite the results (and offset) of a newer one.
let searchGeneration = 0;

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
    searchGeneration++; // invalidate any in-flight request
    songsterrStore.update(s => ({
      ...s,
      results: [],
      hasMore: true,
      offset: 0,
      isSearching: false,
    }));
    return;
  }

  // Invalidate any in-flight request as soon as the new query is scheduled —
  // otherwise a slow response for the previous query arriving during the
  // debounce window would still be applied.
  searchGeneration++;
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
  const generation = ++searchGeneration;
  try {
    const results: SongsterrSong[] = await invoke('songsterr_search', {
      query,
      instrument: null,
      size: PAGE_SIZE,
      from,
    });

    if (generation !== searchGeneration) return; // stale response — drop it

    songsterrStore.update(s => ({
      ...s,
      results:     reset ? results : [...s.results, ...results],
      isSearching: false,
      error:       null,
      hasMore:     results.length >= PAGE_SIZE,
      offset:      (reset ? 0 : s.offset) + results.length,
    }));
  } catch (err) {
    if (generation !== searchGeneration) return; // stale failure — drop it

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
  searchGeneration++; // invalidate any in-flight request
  songsterrStore.set({ ...DEFAULT_STATE });
}

// ── Downloader Local Integration ─────────────────────────────────────────────
import { SongsterrToAlphaTabConverter } from '$lib/songsterr-downloader/songsterr-to-alphatab.converter';
import type { SongsterrStateMetaCurrent, SongsterrRevisionTrackPayload, SongsterrStateMetaCurrentTrack } from '$lib/songsterr-downloader/types';

const CDN_BASE_URL = 'https://dqsljvtekg760.cloudfront.net';
const CDN_BASE_URL_2 = 'https://d3d3l6a6rcgkaf.cloudfront.net';

/**
 * Fetch a copyright-restricted song from Songsterr and compile it locally using the converter.
 * Returns a Uint8Array ready for AlphaTabManager.loadFromBytes().
 */
export async function fetchRestrictedTabBytes(songUrl: string, songTitle: string): Promise<Uint8Array> {
  songsterrStore.update(s => ({ ...s, isFetching: true, error: null }));
  try {
    // 1. Fetch song HTML page
    const html = await invoke<string>('songsterr_fetch_url', { url: songUrl });

    // 2. Parse HTML and extract state JSON
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const stateScript =
      doc.getElementById('state')?.childNodes?.[0]?.nodeValue ||
      doc.getElementById('state')?.textContent ||
      '';

    if (!stateScript) {
      throw new Error('Unable to find Songsterr state payload in page HTML');
    }

    const parsedState = JSON.parse(stateScript);
    const current = parsedState?.meta?.current;

    if (!current?.songId || !current?.revisionId || !current?.image) {
      throw new Error('Songsterr state payload missing required revision fields');
    }

    const stateMeta: SongsterrStateMetaCurrent = {
      songId: current.songId,
      revisionId: current.revisionId,
      image: current.image,
      title: songTitle || current.title || 'Song',
      artist: current.artist || 'Unknown Artist',
      tracks: Array.isArray(current.tracks) ? current.tracks : [],
    };

    // 3. Fetch each track revision JSON from the CDNs (try primary first, fallback if it returns no revisions)
    const tracksToFetch = stateMeta.tracks.filter(
      (track) => typeof track.partId === 'number'
    );

    let fetchedRevisions = await fetchRevisionsFromCdn(stateMeta, tracksToFetch, CDN_BASE_URL);
    if (fetchedRevisions.length === 0) {
      console.warn('[SongsterrStore] Primary CDN returned no revisions, trying fallback CDN...');
      fetchedRevisions = await fetchRevisionsFromCdn(stateMeta, tracksToFetch, CDN_BASE_URL_2);
    }

    if (fetchedRevisions.length === 0) {
      throw new Error('Failed to fetch any revision payloads from Songsterr CDNs');
    }

    // 4. Run the local alphaTab converter to generate the GP7 binary
    const converter = new SongsterrToAlphaTabConverter();
    const result = converter.toGp7({
      meta: stateMeta,
      revisions: fetchedRevisions,
    });

    songsterrStore.update(s => ({ ...s, isFetching: false }));
    return result.data;
  } catch (err) {
    const errorMsg = String(err);
    songsterrStore.update(s => ({
      ...s,
      isFetching: false,
      error: `Failed to load restricted tab: ${errorMsg}`,
    }));
    throw err;
  }
}

async function fetchRevisionsFromCdn(
  stateMeta: SongsterrStateMetaCurrent,
  tracks: SongsterrStateMetaCurrentTrack[],
  cdnBaseUrl: string
): Promise<{ trackMeta: SongsterrStateMetaCurrentTrack; revision: SongsterrRevisionTrackPayload }[]> {
  const promises = tracks.map(async (track) => {
    const url = `${cdnBaseUrl}/${stateMeta.songId}/${stateMeta.revisionId}/${stateMeta.image}/${track.partId}.json`;
    try {
      const jsonText = await invoke<string>('songsterr_fetch_url', { url });
      const revision = JSON.parse(jsonText) as SongsterrRevisionTrackPayload;
      return { trackMeta: track, revision };
    } catch (err) {
      console.error(`[SongsterrStore] Failed to fetch part ${track.partId} from CDN ${cdnBaseUrl}:`, err);
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter(Boolean) as { trackMeta: SongsterrStateMetaCurrentTrack; revision: SongsterrRevisionTrackPayload }[];
}

