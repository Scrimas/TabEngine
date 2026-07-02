// stores/library.ts — local file library state

import { writable } from 'svelte/store';
import type { LibraryState, LibraryEntry, SongsterrSong } from '$lib/types';

const RECENT_KEY = 'tabengine:recent';
const MAX_RECENT = 20;

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
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, MAX_RECENT)));
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
    const updated: LibraryEntry = { ...entry, lastOpened: ts };
    const filtered = state.entries.filter(e => e.path !== entry.path);
    const entries = [updated, ...filtered].slice(0, MAX_RECENT);
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
}

export function renameEntry(oldPath: string, newEntry: LibraryEntry): void {
  libraryStore.update(state => {
    const entries = state.entries.map(e =>
      e.path === oldPath ? { ...newEntry, lastOpened: e.lastOpened } : e,
    );
    saveRecent(entries);
    const currentPath = state.currentPath === oldPath ? newEntry.path : state.currentPath;
    return { ...state, entries, currentPath };
  });
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
  return invoke<LibraryEntry>('save_gp_file_to_dir', {
    destDir,
    filename,
    bytes: Array.from(bytes),
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
