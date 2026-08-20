// stores/library.ts — local file library state

import { writable } from 'svelte/store';
import type { LibraryState, LibraryEntry, SongsterrSong } from '$lib/types';
import { renamePathInPlaylists, removePathFromPlaylists } from './playlists';

const RECENT_KEY = 'tabengine:recent';

function loadRecent(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as LibraryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(entries: LibraryEntry[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries));
  } catch { /* quota exceeded — silently ignore */ }
}

export const libraryStore = writable<LibraryState>({
  entries:              loadRecent(),
  currentPath:          null,
  currentSongsterrSong: null,
  currentSongsterrBytes: null,
  isLoading:            false,
  error:                null,
});

/** Mark a file as recently opened and update the library list */
export function recordOpen(entry: LibraryEntry): void {
  libraryStore.update(state => {
    const ts = Date.now();
    const existing = state.entries.find(e => e.path === entry.path);
    const updated: LibraryEntry = { ...entry, dateAdded: existing?.dateAdded ?? ts, lastOpened: ts };
    const filtered = state.entries.filter(e => e.path !== entry.path);
    const entries = [updated, ...filtered];
    saveRecent(entries);
    return {
      ...state,
      entries,
      currentPath: entry.path,
      currentSongsterrSong: null,
      currentSongsterrBytes: null,
    };
  });
}

/** Replace the whole library list with a scanned directory result */
export function setLibrary(entries: LibraryEntry[]): void {
  libraryStore.update(state => ({ ...state, entries }));
}

/**
 * Cache score-authored metadata (title/artist) onto a library entry once its
 * file has actually been parsed — lets the sidebar show "Title — Artist"
 * instead of just the filename.
 */
export function updateEntryMeta(path: string, title: string, artist: string): void {
  libraryStore.update(state => {
    let changed = false;
    const t = title.trim() || undefined;
    const a = artist.trim() || undefined;
    const entries = state.entries.map(e => {
      if (e.path !== path || (e.title === t && e.artist === a)) return e;
      changed = true;
      return { ...e, title: t, artist: a };
    });
    if (!changed) return state;
    saveRecent(entries);
    return { ...state, entries };
  });
}

/**
 * Merge a folder-scan result into the library without dropping metadata on
 * entries that are already known. Returns the number of newly added files.
 */
export function mergeScannedEntries(scanned: LibraryEntry[]): number {
  let added = 0;
  libraryStore.update(state => {
    const byPath = new Map(state.entries.map(e => [e.path, e]));
    const ts = Date.now();
    for (const s of scanned) {
      const existing = byPath.get(s.path);
      if (existing) {
        byPath.set(s.path, { ...existing, name: s.name, ext: s.ext, size: s.size });
      } else {
        byPath.set(s.path, { ...s, dateAdded: ts });
        added++;
      }
    }
    const entries = [...byPath.values()];
    saveRecent(entries);
    return { ...state, entries };
  });
  return added;
}

export function setCurrentSongsterr(song: SongsterrSong | null, bytes: Uint8Array | null): void {
  libraryStore.update(state => ({
    ...state,
    currentPath: null,
    currentSongsterrSong: song,
    currentSongsterrBytes: bytes,
  }));
}

export function setCurrentPath(path: string | null): void {
  libraryStore.update(state => ({
    ...state,
    currentPath: path,
    currentSongsterrSong: null,
    currentSongsterrBytes: null,
  }));
}

export function setLoading(isLoading: boolean): void {
  libraryStore.update(state => ({ ...state, isLoading }));
}

export function setError(error: string | null): void {
  libraryStore.update(state => ({ ...state, error }));
}

export function removeEntry(path: string): void {
  libraryStore.update(state => {
    const entries = state.entries.filter(e => e.path !== path);
    saveRecent(entries);
    const currentPath = state.currentPath === path ? null : state.currentPath;
    return { ...state, entries, currentPath };
  });
  removePathFromPlaylists(path);
}

export function renameEntry(oldPath: string, newEntry: LibraryEntry): void {
  libraryStore.update(state => {
    const entries = state.entries.map(e =>
      e.path === oldPath ? { ...newEntry, dateAdded: e.dateAdded, lastOpened: e.lastOpened } : e,
    );
    saveRecent(entries);
    const currentPath = state.currentPath === oldPath ? newEntry.path : state.currentPath;
    return { ...state, entries, currentPath };
  });
  renamePathInPlaylists(oldPath, newEntry.path);
}

import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { settingsStore } from './settings';

/** Resolve the library directory: the configured one, or the app data dir. */
export async function resolveLibraryDir(): Promise<string | null> {
  const configured = get(settingsStore).libraryDir;
  if (configured) return configured;
  try {
    return await invoke<string>('get_app_data_dir');
  } catch {
    return null;
  }
}

/**
 * Save `bytes` under `filename` in `destDir` without clobbering existing
 * files. Collision handling (reuse when the content is identical, otherwise
 * a "name (1).ext" style suffix) happens atomically in Rust. Returns the
 * library entry for the file actually written/reused.
 */
export async function saveBytesToLibrary(
  destDir: string,
  filename: string,
  bytes: Uint8Array,
): Promise<LibraryEntry> {
  // Raw-bytes IPC body (same pattern as export_file) — `Array.from(bytes)`
  // used to send a JSON number array 4-5x the file size.
  return invoke<LibraryEntry>('save_gp_file_to_dir', bytes, {
    headers: {
      'x-dest-dir': encodeURIComponent(destDir),
      'x-filename': encodeURIComponent(filename),
    },
  });
}

/** Copy an external file into the app's library directory if it's not already there */
export async function importFileToLibrary(path: string): Promise<string> {
  try {
    const destDir = await resolveLibraryDir();
    if (!destDir) return path;
    const entry = await invoke<LibraryEntry>('import_gp_file', { srcPath: path, destDir });
    return entry.path;
  } catch (err) {
    console.error('[LibraryStore] Failed to import file to library:', err);
    return path;
  }
}
