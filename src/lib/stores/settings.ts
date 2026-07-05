// stores/settings.ts — Svelte store for managing persisted user settings

import { writable } from 'svelte/store';
import type { LibrarySortField } from '$lib/types';

export interface AppSettings {
  theme:            'parchment' | 'dark';
  metronomeVolume:  number; // 0–100
  countInBars:      number; // 1 or 2
  libraryDir:       string | null;
  librarySortField: LibrarySortField;
}

const SETTINGS_KEY = 'tabengine:settings';

const DEFAULT_SETTINGS: AppSettings = {
  theme:            'parchment',
  metronomeVolume:  80,
  countInBars:      1,
  libraryDir:       null,
  librarySortField: 'name',
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = writable<AppSettings>(loadSettings());

export function updateSettings(updates: Partial<AppSettings>) {
  settingsStore.update(s => {
    const next = { ...s, ...updates };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {}
    return next;
  });
}
