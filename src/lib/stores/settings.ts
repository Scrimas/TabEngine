// stores/settings.ts — Svelte store for managing persisted user settings

import { writable } from 'svelte/store';
import type { LibrarySortField } from '$lib/types';

export interface AppSettings {
  theme:            'parchment' | 'dark';
  metronomeVolume:  number; // 0–100
  libraryDir:       string | null;
  librarySortField: LibrarySortField;
  // Layout — restored on launch
  sidebarOpen:      boolean;
  mixerOpen:        boolean;
  sidebarWidth:     number; // px
  mixerWidth:       number; // px
  // Playback preferences — seeded into the player store and applied to the
  // alphaTab api at startup (AlphaTabManager.initAlphaTab)
  masterVolume:     number;  // 0–100
  playbackSpeed:    number;  // multiplier, 0.25–2.0
  metronomeEnabled: boolean;
  countInEnabled:   boolean;
  displayScale:     number;  // score zoom, 0.25–2.0
  // View
  staveProfile:     'tab' | 'scoretab';    // tab only, or standard notation + tab
  layoutMode:       'page' | 'horizontal';
  // Session restore
  lastOpenedFile:   string | null;
}

const SETTINGS_KEY = 'tabengine:settings';

const DEFAULT_SETTINGS: AppSettings = {
  theme:            'parchment',
  metronomeVolume:  80,
  libraryDir:       null,
  librarySortField: 'name',
  sidebarOpen:      true,
  mixerOpen:        true,
  sidebarWidth:     288,
  mixerWidth:       332,
  masterVolume:     100,
  playbackSpeed:    1.0,
  metronomeEnabled: false,
  countInEnabled:   false,
  displayScale:     0.95,
  staveProfile:     'tab',
  layoutMode:       'page',
  lastOpenedFile:   null,
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
