<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    stop, playPause,
    setMetronomeEnabled, setCountInEnabled, setPlaybackSpeed, setDisplayScale,
    seekToFraction, setLooping, setSpeedTrainerEnabled,
    getScoreSections, getBarCount, seekToBar,
    exportMidi, exportGp, exportWav, printScore,
  } from '$lib/alphatab/AlphaTabManager';
  import type { ScoreSection } from '$lib/alphatab/AlphaTabManager';
  import { save as tauriSave } from '@tauri-apps/plugin-dialog';
  import { invoke } from '@tauri-apps/api/core';
  import { toast } from '$lib/stores/notifications';
  import { playerStore, positionStore, speedTrainerStore } from '$lib/stores/player';
  import { libraryStore } from '$lib/stores/library';
  import { overlayOpened, overlayClosed } from '$lib/stores/overlays';
  import { settingsStore, updateSettings } from '$lib/stores/settings';
  import { formatTime } from '$lib/types';

  const dispatch = createEventDispatcher<{ download: void }>();

  let draggingScrubber = false;
  let scrubberPreview  = 0;

  function onScrubInput(e: Event) {
    draggingScrubber = true;
    scrubberPreview = Number((e.target as HTMLInputElement).value) / 1000;
  }
  function onScrubChange(e: Event) {
    const frac = Number((e.target as HTMLInputElement).value) / 1000;
    seekToFraction(frac);
    draggingScrubber = false;
  }

  $: displayProgress = draggingScrubber
    ? scrubberPreview
    : ($positionStore.totalTicks > 0 ? $positionStore.currentTick / $positionStore.totalTicks : 0);

  $: displayTime  = formatTime($positionStore.currentTime);
  $: displayTotal = formatTime($positionStore.totalTime);

  function toggleMetronome() { setMetronomeEnabled(!$playerStore.metronomeEnabled); }
  function toggleCountIn()   { setCountInEnabled(!$playerStore.countInEnabled); }
  function toggleLoop()      { setLooping(!$playerStore.isLooping); }
  function triggerDownload() { dispatch('download'); }

  // ── Score zoom ────────────────────────────────────────────────────────────
  const ZOOM_MIN = 25, ZOOM_MAX = 200, ZOOM_STEP = 10, ZOOM_DEFAULT = 95;
  $: zoomPct = Math.round($settingsStore.displayScale * 100);
  function nudgeZoom(delta: number) {
    setDisplayScale(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomPct + delta)) / 100);
  }
  function resetZoom() { setDisplayScale(ZOOM_DEFAULT / 100); }

  $: canPlay = $playerStore.isReady;

  // Popovers are position:fixed and anchored via getBoundingClientRect() rather
  // than CSS position:absolute — the control bar (and its ancestors) use
  // overflow:hidden for layout clipping, which would otherwise clip/occlude an
  // absolutely-positioned popover under sibling panels like the Mixer.
  function anchoredStyle(el: HTMLElement): string {
    const rect = el.getBoundingClientRect();
    const bottom = window.innerHeight - rect.top + 10;
    const right  = window.innerWidth - rect.right;
    return `position: fixed; bottom: ${bottom}px; right: ${right}px;`;
  }

  // ── Metronome volume popover ──────────────────────────────────────────────
  let showMetronomePopover = false;
  let metronomePopoverStyle = '';
  let metronomeAnchorEl: HTMLDivElement;
  function toggleMetronomePopover() {
    showTempoPopover  = false;
    showGotoPopover   = false;
    showExportPopover = false;
    showMetronomePopover = !showMetronomePopover;
    if (showMetronomePopover) metronomePopoverStyle = anchoredStyle(metronomeAnchorEl);
  }

  // ── Go to bar / section popover ───────────────────────────────────────────
  let showGotoPopover  = false;
  let gotoPopoverStyle = '';
  let gotoAnchorEl: HTMLDivElement;
  let gotoSections: ScoreSection[] = [];
  let gotoBarCount = 0;
  let gotoBarInput = '';
  function toggleGotoPopover() {
    showTempoPopover     = false;
    showMetronomePopover = false;
    showExportPopover    = false;
    showGotoPopover = !showGotoPopover;
    if (showGotoPopover) {
      gotoSections = getScoreSections();
      gotoBarCount = getBarCount();
      gotoBarInput = '';
      gotoPopoverStyle = anchoredStyle(gotoAnchorEl);
    }
  }
  function closeGotoPopover() { showGotoPopover = false; }
  function gotoTypedBar() {
    const n = parseInt(gotoBarInput, 10);
    if (!Number.isFinite(n) || n < 1) return;
    seekToBar(n - 1);
    showGotoPopover = false;
  }
  function gotoSection(s: ScoreSection) {
    seekToBar(s.barIndex);
    showGotoPopover = false;
  }

  // ── Export popover ────────────────────────────────────────────────────────
  let showExportPopover  = false;
  let exportPopoverStyle = '';
  let exportAnchorEl: HTMLDivElement;
  let exportingWav = false;
  function toggleExportPopover() {
    showTempoPopover     = false;
    showMetronomePopover = false;
    showGotoPopover      = false;
    showExportPopover = !showExportPopover;
    if (showExportPopover) exportPopoverStyle = anchoredStyle(exportAnchorEl);
  }
  function closeExportPopover() { showExportPopover = false; }

  /** Suggested filename stem for exports: current file, or Songsterr song. */
  function suggestedStem(): string {
    const p = $libraryStore.currentPath;
    if (p) {
      const base = p.split(/[\\/]/).pop() ?? 'score';
      return base.replace(/\.[^.]+$/, '');
    }
    const song = $libraryStore.currentSongsterrSong;
    if (song) return `${song.artist.name} - ${song.title}`.replace(/[<>:"/\\|?*]/g, '_');
    return 'score';
  }

  /** Ask for a destination, then write the bytes through the Rust backend. */
  async function saveExport(bytes: Uint8Array, ext: 'mid' | 'wav' | 'gp', label: string) {
    const path = await tauriSave({
      defaultPath: `${suggestedStem()}.${ext}`,
      filters: [{ name: label, extensions: [ext] }],
    });
    if (!path) return;
    await invoke('export_file', bytes, {
      headers: { 'x-export-path': encodeURIComponent(path) },
    });
    toast('success', `Exported "${path.split(/[\\/]/).pop()}".`);
  }

  async function handleExportMidi() {
    showExportPopover = false;
    try {
      const bytes = exportMidi();
      if (bytes) await saveExport(bytes, 'mid', 'MIDI file');
    } catch (err) {
      console.error('[ControlBar] MIDI export failed:', err);
      toast('error', `MIDI export failed: ${err}`);
    }
  }

  async function handleExportGp() {
    showExportPopover = false;
    try {
      const bytes = exportGp();
      if (bytes) await saveExport(bytes, 'gp', 'Guitar Pro file');
    } catch (err) {
      console.error('[ControlBar] GP export failed:', err);
      toast('error', `Guitar Pro export failed: ${err}`);
    }
  }

  async function handleExportWav() {
    if (exportingWav) return;
    showExportPopover = false;
    // Pick the destination first so the (slow) offline render only runs when
    // the user actually committed to a file.
    try {
      const path = await tauriSave({
        defaultPath: `${suggestedStem()}.wav`,
        filters: [{ name: 'WAV audio', extensions: ['wav'] }],
      });
      if (!path) return;
      exportingWav = true;
      toast('info', 'Rendering audio — this can take a moment…');
      const bytes = await exportWav();
      if (!bytes) return;
      await invoke('export_file', bytes, {
        headers: { 'x-export-path': encodeURIComponent(path) },
      });
      toast('success', `Exported "${path.split(/[\\/]/).pop()}".`);
    } catch (err) {
      console.error('[ControlBar] WAV export failed:', err);
      toast('error', `Audio export failed: ${err}`);
    } finally {
      exportingWav = false;
    }
  }

  function handlePrint() {
    showExportPopover = false;
    printScore();
  }

  // ── Speed trainer field handlers ──────────────────────────────────────────
  function onTrainerToggle(e: Event) {
    setSpeedTrainerEnabled((e.currentTarget as HTMLInputElement).checked);
  }

  function onTrainerField(field: 'startPct' | 'stepPct' | 'targetPct', e: Event) {
    const raw = Math.round(Number((e.currentTarget as HTMLInputElement).value));
    if (!Number.isFinite(raw)) return;
    const clamped = field === 'stepPct'
      ? Math.max(1, Math.min(50, raw))
      : Math.max(SPEED_MIN, Math.min(SPEED_MAX, raw));
    speedTrainerStore.update(t => ({ ...t, [field]: clamped }));
    (e.currentTarget as HTMLInputElement).value = String(clamped);
  }

  // ── Tempo popover ("Compact strip" design) ─────────────────────────────────
  const SPEED_MIN  = 10;   // % — matches setPlaybackSpeed's 0.1x clamp
  const SPEED_MAX  = 200;  // % — matches setPlaybackSpeed's 2.0x clamp
  const SPEED_STEP = 5;    // % — snap increment for drag / +- / keyboard
  const SPEED_LABELED = [10, 25, 50, 75, 100, 125, 150, 175, 200];

  function pctToLeft(pct: number): number {
    return (pct - SPEED_MIN) / (SPEED_MAX - SPEED_MIN) * 100;
  }
  const SPEED_TICKS = (() => {
    const out: { left: number; h: number; major: boolean }[] = [];
    for (let v = SPEED_MIN; v <= SPEED_MAX; v += 5) {
      const major = SPEED_LABELED.includes(v);
      out.push({ left: pctToLeft(v), h: major ? 16 : 8, major });
    }
    return out;
  })();
  const SPEED_LABELS = SPEED_LABELED.map(v => ({ v, left: pctToLeft(v) }));

  let showTempoPopover = false;
  let tempoPopoverStyle = '';
  let bpmBadgeEl: HTMLButtonElement;
  function toggleTempoPopover() {
    showMetronomePopover = false;
    showGotoPopover      = false;
    showExportPopover    = false;
    showTempoPopover = !showTempoPopover;
    if (showTempoPopover) tempoPopoverStyle = anchoredStyle(bpmBadgeEl);
  }

  $: speedPct     = Math.round($playerStore.playbackSpeed * 100);
  $: effectiveBpm = Math.round($positionStore.tempo * $playerStore.playbackSpeed);
  $: rulerLeft    = pctToLeft(speedPct);

  function snapToStep(pct: number): number {
    return Math.round(pct / SPEED_STEP) * SPEED_STEP;
  }
  function applySpeedPct(pct: number, snap = false) {
    const value = snap ? snapToStep(pct) : pct;
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, value));
    setPlaybackSpeed(clamped / 100);
  }
  function nudgeSpeedPct(delta: number) { applySpeedPct(speedPct + delta, true); }
  function resetSpeed() { applySpeedPct(100); }

  function onMetronomeVolumeInput(e: Event) {
    updateSettings({ metronomeVolume: Number((e.target as HTMLInputElement).value) });
  }
  function onBpmInput(e: Event) {
    const bpm = Number((e.currentTarget as HTMLInputElement).value);
    if (!bpm || $positionStore.tempo <= 0) return;
    applySpeedPct((bpm / $positionStore.tempo) * 100);
  }

  let draggingRuler = false;
  function applyRulerPointer(e: PointerEvent, ruler: HTMLElement) {
    const rect = ruler.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    applySpeedPct(SPEED_MIN + frac * (SPEED_MAX - SPEED_MIN), true);
  }
  function onRulerPointerDown(e: PointerEvent) {
    const ruler = e.currentTarget as HTMLElement;
    draggingRuler = true;
    ruler.setPointerCapture?.(e.pointerId);
    applyRulerPointer(e, ruler);
  }
  function onRulerPointerMove(e: PointerEvent) {
    if (draggingRuler) applyRulerPointer(e, e.currentTarget as HTMLElement);
  }
  function onRulerPointerUp() { draggingRuler = false; }

  // Attached to the popover container (not just the ruler) so +/- work as
  // soon as the popover opens, without requiring an extra click to focus the
  // ruler first. Ignores keydowns from the BPM input so typing e.g. "120"
  // isn't hijacked by the '0' reset shortcut.
  function onTempoKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    // Arrow keys are reserved for scrubbing the playback position elsewhere in
    // the app, so tempo stepping only responds to +/- (not arrows).
    if (e.key === '+' || e.key === '=') {
      e.preventDefault(); nudgeSpeedPct(SPEED_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault(); nudgeSpeedPct(-SPEED_STEP);
    } else if (e.key === '0') {
      e.preventDefault(); resetSpeed();
    }
  }
  function autofocus(node: HTMLElement) { node.focus(); }

  // ── Popover ↔ global-Escape coordination ────────────────────────────────────
  // Report to the overlays store so App.svelte's Escape handler skips
  // stopping playback while a popover is open (first Escape closes it).
  $: anyPopoverOpen = showTempoPopover || showMetronomePopover
    || showGotoPopover || showExportPopover;
  let prevPopoverOpen = false;
  $: if (anyPopoverOpen !== prevPopoverOpen) {
    prevPopoverOpen = anyPopoverOpen;
    if (anyPopoverOpen) overlayOpened(); else overlayClosed();
  }

  function closeAllPopovers() {
    showTempoPopover     = false;
    showMetronomePopover = false;
    showGotoPopover      = false;
    showExportPopover    = false;
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && anyPopoverOpen) closeAllPopovers();
  }

  // The popovers are anchored with fixed coordinates measured at open time —
  // stale after a window resize, so just close them.
  function handleWindowResize() {
    if (anyPopoverOpen) closeAllPopovers();
  }

  // ── Scrubber hover time preview ─────────────────────────────────────────────
  let hoverFrac: number | null = null;
  function onScrubberPointerMove(e: PointerEvent) {
    if (!canPlay) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverFrac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }
  function onScrubberPointerLeave() { hoverFrac = null; }

  // ── Shared popover dismissal ────────────────────────────────────────────────
  function clickOutside(node: HTMLElement, onOutside: () => void) {
    function handleClick(e: MouseEvent) {
      if (!node.contains(e.target as Node)) onOutside();
    }
    document.addEventListener('mousedown', handleClick, true);
    return {
      destroy() { document.removeEventListener('mousedown', handleClick, true); },
    };
  }
  function closeMetronomePopover() { showMetronomePopover = false; }
  function closeTempoPopover()     { showTempoPopover = false; }
</script>

<svelte:window on:keydown={handleWindowKeyDown} on:resize={handleWindowResize} />

<footer class="control-bar" aria-label="Playback controls">

  <!-- Stop + Play -->
  <div class="transport">
    <button class="stop-btn" on:click={stop} disabled={!canPlay}
            title="Stop" aria-label="Stop">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2.5"/>
      </svg>
    </button>

    <button
      class="play-btn"
      class:playing={$playerStore.isPlaying}
      on:click={playPause}
      disabled={!canPlay}
      title={$playerStore.isPlaying ? 'Pause' : 'Play'}
      aria-label={$playerStore.isPlaying ? 'Pause' : 'Play'}
    >
      {#if $playerStore.isPlaying}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1.3"/>
          <rect x="14" y="5" width="4" height="14" rx="1.3"/>
        </svg>
      {:else}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-left:2px" aria-hidden="true">
          <path d="M8 5v14l11-7z"/>
        </svg>
      {/if}
    </button>
  </div>

  <!-- Elapsed time -->
  <span class="time-display" aria-live="off" aria-label="Elapsed time">{displayTime}</span>

  <!-- Scrubber -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="scrubber-wrap"
    on:pointermove={onScrubberPointerMove}
    on:pointerleave={onScrubberPointerLeave}
  >
    {#if hoverFrac !== null && canPlay}
      <div class="scrub-preview" style="left:{hoverFrac * 100}%">
        {formatTime(hoverFrac * $positionStore.totalTime)}
      </div>
    {/if}
    <div class="scrubber-fill" style="width:{displayProgress * 100}%"></div>
    <input
      type="range"
      min="0"
      max="1000"
      step="1"
      value={Math.round(displayProgress * 1000)}
      on:input={onScrubInput}
      on:change={onScrubChange}
      disabled={!canPlay}
      aria-label="Playback position"
      aria-valuetext="{displayTime} of {displayTotal}"
    />
  </div>

  <!-- Total time -->
  <span class="time-display total" aria-label="Total duration">{displayTotal}</span>

  <!-- Right controls -->
  <div class="right-ctrl">
    <!-- Go to bar / section -->
    <div class="popover-anchor" use:clickOutside={closeGotoPopover} bind:this={gotoAnchorEl}>
      <button
        class="icon-toggle"
        class:active={showGotoPopover}
        on:click={toggleGotoPopover}
        disabled={!canPlay}
        title="Go to bar or section"
        aria-label="Go to bar or section"
        aria-expanded={showGotoPopover}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="7"/>
          <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
        </svg>
      </button>

      {#if showGotoPopover}
        <div class="popover goto-popover" style={gotoPopoverStyle} role="group" aria-label="Go to bar or section">
          <span class="popover-title">Go to</span>
          <form class="goto-bar-row" on:submit|preventDefault={gotoTypedBar}>
            <label class="goto-bar-label" for="goto-bar-input">Bar</label>
            <input
              id="goto-bar-input"
              class="goto-bar-input"
              type="number"
              min="1"
              max={gotoBarCount}
              placeholder="1–{gotoBarCount}"
              bind:value={gotoBarInput}
              use:autofocus
            />
            <button class="goto-go-btn press" type="submit">Go</button>
          </form>
          {#if gotoSections.length > 0}
            <div class="goto-sections">
              {#each gotoSections as section (section.barIndex)}
                <button class="goto-section" on:click={() => gotoSection(section)}>
                  <span class="goto-section-name">{section.name}</span>
                  <span class="goto-section-bar">bar {section.barNumber}</span>
                </button>
              {/each}
            </div>
          {:else}
            <span class="goto-empty">No section markers in this song.</span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Score zoom -->
    <div class="zoom-group" role="group" aria-label="Score zoom">
      <button class="zoom-btn" on:click={() => nudgeZoom(-ZOOM_STEP)} disabled={zoomPct <= ZOOM_MIN}
              title="Zoom out" aria-label="Zoom out">−</button>
      <button class="zoom-pct" on:click={resetZoom} title="Reset zoom" aria-label="Zoom {zoomPct} percent, click to reset">{zoomPct}%</button>
      <button class="zoom-btn" on:click={() => nudgeZoom(ZOOM_STEP)} disabled={zoomPct >= ZOOM_MAX}
              title="Zoom in" aria-label="Zoom in">+</button>
    </div>

    <!-- BPM badge (opens tempo popover) -->
    <div class="popover-anchor" use:clickOutside={closeTempoPopover}>
      <button
        class="bpm-badge"
        class:active={showTempoPopover}
        on:click={toggleTempoPopover}
        bind:this={bpmBadgeEl}
        title="Tempo"
        aria-label="Tempo: {effectiveBpm} BPM"
        aria-expanded={showTempoPopover}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 4h4l3 16H7z"/><line x1="12" y1="20" x2="15.5" y2="8"/>
        </svg>
        <span class="bpm-val">{effectiveBpm}</span>
        <span class="bpm-unit">BPM</span>
      </button>

      {#if showTempoPopover}
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div
          class="popover tempo-popover"
          style={tempoPopoverStyle}
          tabindex="-1"
          role="group"
          aria-label="Tempo controls"
          use:autofocus
          on:keydown={onTempoKeydown}
        >
          <div class="strip-header">
            <button class="strip-btn" on:click={() => nudgeSpeedPct(-SPEED_STEP)} aria-label="Decrease tempo">−</button>
            <div class="strip-bpm">
              <input
                class="strip-bpm-input"
                type="number"
                min={Math.round($positionStore.tempo * SPEED_MIN / 100)}
                max={Math.round($positionStore.tempo * SPEED_MAX / 100)}
                value={effectiveBpm}
                on:change={onBpmInput}
                aria-label="Tempo in BPM"
              />
              <span class="strip-bpm-unit">bpm</span>
              <span class="strip-bpm-song">/ {$positionStore.tempo}</span>
            </div>
            <button class="strip-btn" on:click={() => nudgeSpeedPct(SPEED_STEP)} aria-label="Increase tempo">+</button>
            <div class="strip-spacer"></div>
            <div class="strip-pct-chip">{speedPct}%</div>
            <button class="strip-btn" on:click={resetSpeed} title="Reset to 100%" aria-label="Reset tempo to 100%">↺</button>
          </div>

          <div
            class="strip-ruler"
            role="slider"
            aria-valuemin={SPEED_MIN}
            aria-valuemax={SPEED_MAX}
            aria-valuenow={speedPct}
            aria-label="Playback speed percentage"
            on:pointerdown={onRulerPointerDown}
            on:pointermove={onRulerPointerMove}
            on:pointerup={onRulerPointerUp}
          >
            <div class="strip-track"></div>
            <div class="strip-track-fill" style="width:{rulerLeft}%"></div>
            {#each SPEED_TICKS as tick}
              <div class="strip-tick" class:major={tick.major} style="left:{tick.left}%; height:{tick.h}px;"></div>
            {/each}
            {#each SPEED_LABELS as label}
              <div class="strip-tick-label" class:base={label.v === 100} style="left:{label.left}%">{label.v}</div>
            {/each}
            <div class="strip-thumb-pin" style="left:{rulerLeft}%"></div>
            <div class="strip-thumb-dot" style="left:{rulerLeft}%"></div>
          </div>

          <!-- Speed trainer: bump speed each loop pass until the target -->
          <div class="trainer-row" title="With loop on, each completed pass raises the speed by the step until the target is reached.">
            <label class="trainer-toggle">
              <input
                type="checkbox"
                checked={$speedTrainerStore.enabled}
                on:change={onTrainerToggle}
              />
              <span>Speed trainer</span>
            </label>
            <div class="trainer-fields" class:dimmed={!$speedTrainerStore.enabled}>
              <input class="trainer-input" type="number" min={SPEED_MIN} max={SPEED_MAX}
                     value={$speedTrainerStore.startPct}
                     on:change={(e) => onTrainerField('startPct', e)}
                     aria-label="Trainer start speed percent" />
              <span class="trainer-sep">% +</span>
              <input class="trainer-input narrow" type="number" min="1" max="50"
                     value={$speedTrainerStore.stepPct}
                     on:change={(e) => onTrainerField('stepPct', e)}
                     aria-label="Trainer step percent" />
              <span class="trainer-sep">% →</span>
              <input class="trainer-input" type="number" min={SPEED_MIN} max={SPEED_MAX}
                     value={$speedTrainerStore.targetPct}
                     on:change={(e) => onTrainerField('targetPct', e)}
                     aria-label="Trainer target speed percent" />
              <span class="trainer-sep">%</span>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Metronome toggle + volume popover -->
    <div class="popover-anchor metronome-group" use:clickOutside={closeMetronomePopover} bind:this={metronomeAnchorEl}>
      <button
        class="icon-toggle"
        class:active={$playerStore.metronomeEnabled}
        on:click={toggleMetronome}
        title="Metronome"
        aria-pressed={$playerStore.metronomeEnabled}
        aria-label="Metronome"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 4h4l3 16H7z"/><line x1="12" y1="20" x2="15.5" y2="8"/>
        </svg>
      </button>
      <button
        class="caret-btn"
        class:active={showMetronomePopover}
        on:click={toggleMetronomePopover}
        title="Metronome volume"
        aria-label="Metronome volume"
        aria-expanded={showMetronomePopover}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {#if showMetronomePopover}
        <div class="popover volume-popover" style={metronomePopoverStyle}>
          <span class="popover-title">Metronome Volume</span>
          <div class="volume-row">
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={$settingsStore.metronomeVolume}
              on:input={onMetronomeVolumeInput}
              aria-label="Metronome volume"
            />
            <span class="value-display">{$settingsStore.metronomeVolume}%</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Count-in toggle -->
    <button
      class="icon-toggle"
      class:active={$playerStore.countInEnabled}
      on:click={toggleCountIn}
      title="Count-in (one bar of clicks before playback)"
      aria-pressed={$playerStore.countInEnabled}
      aria-label="Count-in"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="14" r="7.5"/>
        <line x1="12" y1="14" x2="12" y2="10"/>
        <line x1="9" y1="2.5" x2="15" y2="2.5"/>
        <line x1="12" y1="2.5" x2="12" y2="6"/>
      </svg>
    </button>

    <!-- Loop toggle -->
    <button
      class="icon-toggle"
      class:active={$playerStore.isLooping}
      on:click={toggleLoop}
      title="Toggle loop"
      aria-pressed={$playerStore.isLooping}
      aria-label="Loop"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a6 6 0 0 1 6-6h9"/>
        <path d="M15 3l3 3-3 3"/>
        <path d="M21 12a6 6 0 0 1-6 6H6"/>
        <path d="M9 21l-3-3 3-3"/>
      </svg>
    </button>

    <!-- Export -->
    <div class="popover-anchor" use:clickOutside={closeExportPopover} bind:this={exportAnchorEl}>
      <button
        class="icon-toggle"
        class:active={showExportPopover}
        on:click={toggleExportPopover}
        disabled={!canPlay || exportingWav}
        title="Export (MIDI, audio, Guitar Pro, print)"
        aria-label="Export"
        aria-expanded={showExportPopover}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 15V3"/>
          <path d="M7 8l5-5 5 5"/>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        </svg>
      </button>

      {#if showExportPopover}
        <div class="popover export-popover" style={exportPopoverStyle} role="menu" aria-label="Export options">
          <button class="export-item" role="menuitem" on:click={handleExportMidi}>
            <span class="export-name">MIDI</span>
            <span class="export-ext">.mid</span>
          </button>
          <button class="export-item" role="menuitem" on:click={handleExportWav} disabled={exportingWav}>
            <span class="export-name">{exportingWav ? 'Rendering audio…' : 'Audio'}</span>
            <span class="export-ext">.wav</span>
          </button>
          <button class="export-item" role="menuitem" on:click={handleExportGp}>
            <span class="export-name">Guitar Pro</span>
            <span class="export-ext">.gp</span>
          </button>
          <div class="export-sep"></div>
          <button class="export-item" role="menuitem" on:click={handlePrint}>
            <span class="export-name">Print…</span>
          </button>
        </div>
      {/if}
    </div>

    <!-- Download to Library -->
    {#if $libraryStore.currentSongsterrSong}
      <button
        class="icon-toggle download-btn"
        on:click={triggerDownload}
        title="Download to library"
        aria-label="Download tab"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    {/if}
  </div>

</footer>

<style>
  .control-bar {
    grid-area: f;
    height: var(--control-bar-height);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 18px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    overflow: hidden;
  }

  /* ── Transport ──────────────────────────────────────────────────────────── */
  .transport {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  }

  .stop-btn {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition), color var(--transition), border-color var(--transition);
  }
  .stop-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .stop-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .play-btn {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: #fff;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(217, 138, 82, 0.38);
    transition: filter var(--transition), transform 140ms var(--ease-spring),
                box-shadow var(--transition);
    flex-shrink: 0;
  }
  .play-btn:hover:not(:disabled) { filter: brightness(1.08); }
  .play-btn:active:not(:disabled) { transform: scale(0.95); }
  /* No pulsing glow while playing: animating box-shadow re-rasterises the
     button every frame for the whole playback (2026-08 performance pass). */
  .play-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }

  /* ── Timeline ───────────────────────────────────────────────────────────── */
  .time-display {
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 38px;
    text-align: right;
  }
  .time-display.total {
    color: var(--text-secondary);
    text-align: left;
  }

  .scrubber-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .scrubber-fill {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 4px;
    background: linear-gradient(90deg, var(--accent), var(--accent-bright));
    border-radius: 3px;
    pointer-events: none;
    box-shadow: 0 0 8px rgba(217, 138, 82,0.38);
  }
  .scrubber-wrap input[type=range] {
    width: 100%;
    position: relative;
    z-index: 1;
  }
  .scrub-preview {
    position: absolute;
    bottom: calc(100% + 2px);
    transform: translateX(-50%);
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    pointer-events: none;
    white-space: nowrap;
    z-index: 2;
  }
  .scrubber-wrap input[type=range]::-webkit-slider-runnable-track {
    background: var(--slider-track);
  }

  /* ── Right controls ─────────────────────────────────────────────────────── */
  .right-ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .bpm-badge {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border-radius: 9px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background var(--transition), border-color var(--transition);
  }
  .bpm-badge:hover, .bpm-badge.active {
    background: var(--accent-dim);
    border-color: var(--accent-glow);
  }
  .bpm-val {
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .bpm-unit {
    font-size: 11px;
    color: var(--text-muted);
  }

  /* ── Popovers (tempo + metronome volume) ───────────────────────────────────── */
  .popover-anchor {
    position: relative;
  }
  .metronome-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .caret-btn {
    width: 18px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .caret-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .caret-btn.active {
    background: var(--accent-dim);
    color: var(--accent);
    border-color: var(--accent-glow);
  }

  .popover {
    /* position: fixed + inset are set inline (see anchoredStyle in <script>) so
       the popover escapes the control bar's overflow:hidden clipping and paints
       above sibling panels (e.g. the Mixer) instead of underneath them. */
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px 16px;
    /* Below the modal backdrops (900+): a popover left open must not float
       on top of the Songsterr/Playlists/Settings dialogs. */
    z-index: 880;
  }

  /* Metronome volume popover */
  .volume-popover {
    width: 200px;
  }
  .popover-title {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 10px;
  }
  .volume-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .volume-row input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .value-display {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 32px;
    text-align: right;
  }

  /* Tempo popover — "Compact strip" design: one-row header with % chip,
     hanging ticks below the ruler, diamond pin thumb. */
  .tempo-popover {
    width: 340px;
    padding: 16px 20px 14px;
  }
  .tempo-popover:focus {
    /* Autofocused on open so +/- and 0 work immediately — not a
       keyboard-navigated target, so the default focus ring is not useful. */
    outline: none;
  }

  .strip-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .strip-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    transition: background var(--transition), color var(--transition), border-color var(--transition);
  }
  .strip-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }

  .strip-bpm {
    display: flex;
    align-items: baseline;
    justify-content: center;
    min-width: 100px;
  }
  .strip-bpm-input {
    width: 4ch;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    text-align: right;
  }
  .strip-bpm-input:focus {
    outline: none;
  }
  .strip-bpm-input::-webkit-inner-spin-button,
  .strip-bpm-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .strip-bpm-input[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .strip-bpm-unit {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-left: 4px;
  }
  .strip-bpm-song {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 4px;
  }

  .strip-spacer {
    flex: 1;
  }
  .strip-pct-chip {
    padding: 4px 11px;
    border-radius: 99px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    color: var(--accent);
    font-weight: 700;
    font-size: 13px;
    white-space: nowrap;
  }

  .strip-ruler {
    position: relative;
    height: 86px;
    margin-top: 18px;
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }
  .strip-track {
    position: absolute;
    left: 0;
    right: 0;
    top: 36px;
    height: 2px;
    border-radius: 2px;
    background: var(--border);
  }
  .strip-track-fill {
    position: absolute;
    left: 0;
    top: 36px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0.9;
  }
  .strip-tick {
    position: absolute;
    top: 42px;
    width: 1px;
    background: var(--border);
  }
  .strip-tick.major {
    background: var(--border-hover);
  }
  .strip-tick-label {
    position: absolute;
    top: 63px;
    transform: translateX(-50%);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .strip-tick-label.base {
    color: var(--text-primary);
    font-weight: 700;
  }
  .strip-thumb-pin {
    position: absolute;
    top: 16px;
    width: 26px;
    height: 26px;
    transform: translate(-50%, -50%) rotate(45deg);
    border-radius: 50% 50% 0 50%;
    background: var(--bg-elevated);
    border: 1px solid var(--border-hover);
    box-shadow: var(--shadow-sm);
  }
  .strip-thumb-dot {
    position: absolute;
    top: 14px;
    width: 9px;
    height: 9px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--accent);
  }

  /* ── Zoom group ─────────────────────────────────────────────────────────── */
  .zoom-group {
    display: flex;
    align-items: center;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 9px;
    overflow: hidden;
  }
  .zoom-btn {
    width: 24px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .zoom-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .zoom-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .zoom-pct {
    min-width: 42px;
    height: 100%;
    padding: 0 4px;
    background: transparent;
    border: none;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background var(--transition), color var(--transition);
  }
  .zoom-pct:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ── Go-to popover ──────────────────────────────────────────────────────── */
  .goto-popover {
    width: 250px;
  }
  .goto-bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .goto-bar-label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .goto-bar-input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 10px;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .goto-bar-input:focus {
    outline: none;
    border-color: var(--accent-glow);
  }
  .goto-go-btn {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius);
    background: var(--accent);
    border: none;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: filter var(--transition);
  }
  .goto-go-btn:hover { filter: brightness(1.08); }
  .goto-sections {
    margin-top: 10px;
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .goto-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition);
  }
  .goto-section:hover { background: var(--overlay-subtle); }
  .goto-section-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .goto-section-bar {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .goto-empty {
    display: block;
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-muted);
  }

  /* ── Export popover ─────────────────────────────────────────────────────── */
  .export-popover {
    width: 190px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .export-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background var(--transition);
  }
  .export-item:hover:not(:disabled) { background: var(--overlay-subtle); }
  .export-item:disabled { opacity: 0.55; cursor: default; }
  .export-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .export-ext {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
  }
  .export-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }

  /* ── Speed trainer row ──────────────────────────────────────────────────── */
  .trainer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .trainer-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }
  .trainer-toggle input[type='checkbox'] {
    accent-color: var(--accent);
    cursor: pointer;
  }
  .trainer-fields {
    display: flex;
    align-items: center;
    gap: 4px;
    transition: opacity var(--transition);
  }
  .trainer-fields.dimmed { opacity: 0.45; }
  .trainer-input {
    width: 40px;
    height: 26px;
    padding: 0 4px;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: center;
  }
  .trainer-input.narrow { width: 32px; }
  .trainer-input:focus {
    outline: none;
    border-color: var(--accent-glow);
  }
  .trainer-input::-webkit-inner-spin-button,
  .trainer-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .trainer-sep {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .icon-toggle {
    width: 34px;
    height: 32px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    transition: background var(--transition), color var(--transition),
                border-color var(--transition);
  }
  .icon-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-hover);
  }
  .icon-toggle.active {
    background: var(--accent-dim);
    color: var(--accent);
    border-color: var(--accent-glow);
  }
</style>
