// types/index.ts — shared domain types for TabEngine

// ── Player ────────────────────────────────────────────────────────────────────

export interface PlayerState {
  isPlaying:       boolean;
  isReady:         boolean;   // soundfont loaded, can play
  sfLoaded:        boolean;
  sfLoadProgress:  number;    // 0–1

  currentTime:     number;    // ms
  totalTime:       number;    // ms
  currentTick:     number;
  totalTicks:      number;

  tempo:           number;    // BPM from score
  playbackSpeed:   number;    // multiplier, 0.25–2.0

  isLooping:       boolean;
  loopHighlight:   LoopHighlightBounds | null;

  metronomeEnabled: boolean;
  masterVolume:    number;    // 0–100
  countInEnabled:  boolean;

  beatCanvasX: number;
  beatCanvasY: number;
  beatCanvasH: number;
}

/** Canvas-space bounds of the two beats bounding the active loop selection,
 *  used to position the draggable edge handles. Mirrors alphaTab's
 *  `PlaybackHighlightChangeEventArgs`, projected down to plain numbers so the
 *  store stays serializable. */
export interface LoopHighlightBounds {
  startX: number; startY: number; startH: number;
  endX:   number; endY: number;   endH: number;
}

export const DEFAULT_PLAYER_STATE: PlayerState = {
  isPlaying:       false,
  isReady:         false,
  sfLoaded:        false,
  sfLoadProgress:  0,
  currentTime:     0,
  totalTime:       0,
  currentTick:     0,
  totalTicks:      0,
  tempo:           120,
  playbackSpeed:   1.0,
  isLooping:       false,
  loopHighlight:   null,
  metronomeEnabled: false,
  masterVolume:    100,
  countInEnabled:  false,
  beatCanvasX: 0,
  beatCanvasY: 0,
  beatCanvasH: 0,
};

// ── Tracks / Mixer ────────────────────────────────────────────────────────────

export interface TrackState {
  index:      number;
  name:       string;
  shortName:  string;
  instrument: string; // General MIDI instrument name (or "Percussion")
  color:      string;   // hex accent color per track
  volume:     number;   // 0–16 (alphaTab's internal scale)
  pan:        number;   // -1.0 to 1.0
  muted:      boolean;
  soloed:     boolean;
  tuning:     number[]; // MIDI note numbers, top string (highest pitch) first; empty if not stringed
}

// ── Library ───────────────────────────────────────────────────────────────────

export interface LibraryEntry {
  path:     string;
  name:     string;
  ext:      string;
  size:     number;   // bytes
  lastOpened?: number; // unix timestamp ms
}

export interface LibraryState {
  entries:              LibraryEntry[];
  currentPath:          string | null;
  currentSongsterrSong: SongsterrSong | null;
  currentSongsterrBytes: Uint8Array | null;
  isLoading:            boolean;
  error:                string | null;
}

// ── Songsterr API ─────────────────────────────────────────────────────────

export interface SongsterrArtist {
  id:                     number;
  name:                   string;
  nameWithoutThePrefix?:  string;
}

export interface SongsterrTrack {
  instrumentId:  number;
  instrument:    string;
  name:          string;
  tuning:        number[];
  difficulty?:   number;
  views?:        number;
}

export interface SongsterrSong {
  id:                 number;
  title:              string;
  artist:             SongsterrArtist;
  chordsPresent?:     boolean;
  tracks:             SongsterrTrack[];
  hasPlayer?:         boolean;
  defaultTrack?:      number;
  revisionId?:        number;
  restrictionStatus?: 'loading' | 'unrestricted' | 'restricted' | 'unpublished' | 'error';
}

export interface SongsterrSearchState {
  query:        string;
  results:      SongsterrSong[];
  isSearching:  boolean;
  isFetching:   boolean;   // loading a specific tab
  error:        string | null;
  hasMore:      boolean;
  offset:       number;
  selected:     SongsterrSong | null;
}

/** Map Songsterr instrumentId ranges to human-readable categories */
export function instrumentCategory(instrumentId: number): 'guitar' | 'bass' | 'drums' | 'keys' | 'other' {
  if (instrumentId >= 1000 && instrumentId < 2000) return 'drums';
  if (instrumentId >= 30 && instrumentId < 40)     return 'bass';
  if (instrumentId >= 24 && instrumentId < 30)     return 'guitar';
  if (instrumentId >= 40 && instrumentId < 50)     return 'keys';
  return 'other';
}

/** Format MIDI note numbers to a tuning string like "E A D G B E" */
export function formatTuning(midiNotes: number[]): string {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return midiNotes.map(n => NOTE_NAMES[n % 12]).join(' ');
}

/** Format a view count to human-readable (e.g. 1.5M, 340K) */
export function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000)     return `${(views / 1_000).toFixed(0)}K`;
  return String(views);
}

// ── UI ────────────────────────────────────────────────────────────────────────

export interface UiState {
  sidebarOpen:    boolean;
  mixerOpen:      boolean;
  isRendering:    boolean;  // alphaTab is re-rendering score
  scoreLoaded:    boolean;
  dragOver:       boolean;  // drag-and-drop highlight
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Format milliseconds as m:ss */
export function formatTime(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Format a file size in human-readable form */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The 10-colour palette rotated per track index */
export const TRACK_COLORS = [
  '#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#14b8a6',
  '#8b5cf6', '#ef4444', '#3b82f6', '#f97316', '#06b6d4',
] as const;
