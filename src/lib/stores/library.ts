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
import { join } from '@tauri-apps/api/path';
import { get } from 'svelte/store';
import { settingsStore } from './settings';

/** Copy an external file into the app's library directory if it's not already there */
export async function importFileToLibrary(path: string): Promise<string> {
  try {
    let destDir = get(settingsStore).libraryDir;
    if (!destDir) {
      destDir = await invoke<string>('get_app_data_dir');
    }
    if (!destDir) return path;

    const cleanPath = path.replace(/\\/g, '/');
    const cleanDest = destDir.replace(/\\/g, '/');

    if (cleanPath.toLowerCase().startsWith(cleanDest.toLowerCase())) {
      return path;
    }

    const filename = path.split(/[/\\]/).pop() || 'imported_tab.gp';
    const destPath = await join(destDir, filename);

    const bytes: number[] = await invoke('read_gp_file', { path });
    await invoke('save_gp_file', { path: destPath, bytes: Array.from(bytes) });

    return destPath;
  } catch (err) {
    console.error('[LibraryStore] Failed to import file to library:', err);
    return path;
  }
}
