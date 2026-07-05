// stores/playlists.ts — user-defined playlists (ordered lists of library file paths)

import { writable, get } from 'svelte/store';
import type { Playlist } from '$lib/types';

const PLAYLISTS_KEY = 'tabengine:playlists';

function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    return raw ? (JSON.parse(raw) as Playlist[]) : [];
  } catch {
    return [];
  }
}

function savePlaylists(playlists: Playlist[]): void {
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch { /* quota exceeded — silently ignore */ }
}

export const playlistsStore = writable<Playlist[]>(loadPlaylists());

export function createPlaylist(name: string): Playlist {
  const playlist: Playlist = { id: crypto.randomUUID(), name, paths: [] };
  playlistsStore.update(playlists => {
    const next = [...playlists, playlist];
    savePlaylists(next);
    return next;
  });
  return playlist;
}

export function renamePlaylist(id: string, name: string): void {
  playlistsStore.update(playlists => {
    const next = playlists.map(p => (p.id === id ? { ...p, name } : p));
    savePlaylists(next);
    return next;
  });
}

export function deletePlaylist(id: string): void {
  playlistsStore.update(playlists => {
    const next = playlists.filter(p => p.id !== id);
    savePlaylists(next);
    return next;
  });
  if (get(activeQueueStore).playlistId === id) clearQueue();
}

/** Add a path to a playlist. No-op if it's already in there (no duplicate entries). */
export function addToPlaylist(id: string, path: string): void {
  playlistsStore.update(playlists => {
    const next = playlists.map(p =>
      p.id === id && !p.paths.includes(path) ? { ...p, paths: [...p.paths, path] } : p,
    );
    savePlaylists(next);
    return next;
  });
}

export function removeFromPlaylist(id: string, path: string): void {
  playlistsStore.update(playlists => {
    const next = playlists.map(p =>
      p.id === id ? { ...p, paths: p.paths.filter(x => x !== path) } : p,
    );
    savePlaylists(next);
    return next;
  });
}

export function reorderPlaylist(id: string, fromIndex: number, toIndex: number): void {
  playlistsStore.update(playlists => {
    const next = playlists.map(p => {
      if (p.id !== id) return p;
      const paths = [...p.paths];
      const [moved] = paths.splice(fromIndex, 1);
      paths.splice(toIndex, 0, moved);
      return { ...p, paths };
    });
    savePlaylists(next);
    return next;
  });
}

/** Keep playlists in sync when a library file is renamed (called from stores/library.ts) */
export function renamePathInPlaylists(oldPath: string, newPath: string): void {
  playlistsStore.update(playlists => {
    const next = playlists.map(p => ({
      ...p,
      paths: p.paths.map(x => (x === oldPath ? newPath : x)),
    }));
    savePlaylists(next);
    return next;
  });
  const queue = get(activeQueueStore);
  if (queue.currentPath === oldPath) activeQueueStore.set({ ...queue, currentPath: newPath });
}

/** Keep playlists in sync when a library file is removed (called from stores/library.ts) */
export function removePathFromPlaylists(path: string): void {
  playlistsStore.update(playlists => {
    const next = playlists.map(p => ({ ...p, paths: p.paths.filter(x => x !== path) }));
    savePlaylists(next);
    return next;
  });
}

// ── Active playback queue ────────────────────────────────────────────────────
// Tracks which playlist (if any) is currently driving auto-advance in the main
// score viewer, and which song within it is loaded right now.

export interface ActiveQueue {
  playlistId:  string | null;
  currentPath: string | null;
}

export const activeQueueStore = writable<ActiveQueue>({ playlistId: null, currentPath: null });

/** Start a playlist playing from a given path (defaults to its first song). Returns the path to load. */
export function startQueue(playlistId: string, fromPath?: string): string | null {
  const playlist = get(playlistsStore).find(p => p.id === playlistId);
  if (!playlist || playlist.paths.length === 0) return null;
  const path = fromPath ?? playlist.paths[0];
  activeQueueStore.set({ playlistId, currentPath: path });
  return path;
}

export function clearQueue(): void {
  activeQueueStore.set({ playlistId: null, currentPath: null });
}

/**
 * Called whenever any file is loaded into the score viewer (manually or via
 * auto-advance). If the path belongs to the active queue's playlist, keeps
 * the queue's position in sync; otherwise silently exits the queue.
 */
export function noteLoadedPath(path: string): void {
  const queue = get(activeQueueStore);
  if (!queue.playlistId) return;
  const playlist = get(playlistsStore).find(p => p.id === queue.playlistId);
  if (playlist && playlist.paths.includes(path)) {
    activeQueueStore.set({ ...queue, currentPath: path });
  } else {
    clearQueue();
  }
}

/** The next path in the active queue's playlist, or null if there is none / no queue is active. */
export function peekNextInQueue(): string | null {
  const queue = get(activeQueueStore);
  if (!queue.playlistId || !queue.currentPath) return null;
  const playlist = get(playlistsStore).find(p => p.id === queue.playlistId);
  if (!playlist) return null;
  const idx = playlist.paths.indexOf(queue.currentPath);
  if (idx === -1 || idx + 1 >= playlist.paths.length) return null;
  return playlist.paths[idx + 1];
}
