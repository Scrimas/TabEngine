<script lang="ts">
  import { playerStore } from '$lib/stores/player';
  import { tracksStore } from '$lib/stores/tracks';

  $: progress = $playerStore.sfLoadProgress;
  $: loaded   = $playerStore.sfLoaded;

  export let scoreReady = false;

  // Only block the UI once a score has actually been requested — otherwise this
  // would show "Loading SoundFont…" indefinitely on a fresh launch with nothing
  // open, since the soundfont loads in the background regardless of user action.
  $: show = $tracksStore.length > 0 && (!$playerStore.isReady || !scoreReady);
</script>

{#if show}
  <div class="overlay" role="status" aria-label="Loading">
    <div class="panel glass">
      <!-- Logo mark -->
      <div class="logo-mark" aria-hidden="true">
        <svg width="59" height="48" viewBox="0 0 123 100">
          <defs>
            <clipPath id="loading-pick-clip">
              <path d="M122.66,54.07 C121.77,56.36 120.1,58.29 116.91,60.69 C115.84,61.5 113.85,63.06 112.5,64.16 C111.14,65.26 108.59,67.18 106.85,68.42 C102.95,71.19 91.67,78.2 89.44,79.24 C88.54,79.66 87.26,80.36 86.59,80.8 C83.53,82.8 68.51,89.78 63.86,91.36 C63.3,91.55 62.71,91.8 62.56,91.91 C61.41,92.77 53.56,95.43 45.67,97.65 C38.82,99.58 31.52,100 26.47,98.76 C20.94,97.41 16.46,95.03 12.31,91.22 C8.97,88.16 6.57,84.66 4.85,80.33 C3.55,77.08 1.75,70.05 0.87,64.79 C0.05,59.86 0.03,59.6 0.02,51.39 C0,42.66 0.07,41.82 1.33,35.01 C2.12,30.75 3.11,27.1 4.69,22.57 C6.75,16.65 8.9,13.22 12.81,9.63 C20,3.03 29.6,0 38.93,1.39 C43.89,2.14 53.73,5.32 64.21,9.58 C76.64,14.63 89.85,21.67 99.75,28.53 C101.38,29.66 103.19,30.9 103.77,31.29 C108.11,34.15 117.42,41.64 119.87,44.22 C122.22,46.71 122.95,48.21 123.06,50.78 C123.12,52.32 123.02,53.13 122.66,54.07 Z"></path>
            </clipPath>
          </defs>
          <path d="M122.66,54.07 C121.77,56.36 120.1,58.29 116.91,60.69 C115.84,61.5 113.85,63.06 112.5,64.16 C111.14,65.26 108.59,67.18 106.85,68.42 C102.95,71.19 91.67,78.2 89.44,79.24 C88.54,79.66 87.26,80.36 86.59,80.8 C83.53,82.8 68.51,89.78 63.86,91.36 C63.3,91.55 62.71,91.8 62.56,91.91 C61.41,92.77 53.56,95.43 45.67,97.65 C38.82,99.58 31.52,100 26.47,98.76 C20.94,97.41 16.46,95.03 12.31,91.22 C8.97,88.16 6.57,84.66 4.85,80.33 C3.55,77.08 1.75,70.05 0.87,64.79 C0.05,59.86 0.03,59.6 0.02,51.39 C0,42.66 0.07,41.82 1.33,35.01 C2.12,30.75 3.11,27.1 4.69,22.57 C6.75,16.65 8.9,13.22 12.81,9.63 C20,3.03 29.6,0 38.93,1.39 C43.89,2.14 53.73,5.32 64.21,9.58 C76.64,14.63 89.85,21.67 99.75,28.53 C101.38,29.66 103.19,30.9 103.77,31.29 C108.11,34.15 117.42,41.64 119.87,44.22 C122.22,46.71 122.95,48.21 123.06,50.78 C123.12,52.32 123.02,53.13 122.66,54.07 Z" fill="var(--accent)"></path>
          <g clip-path="url(#loading-pick-clip)">
            <rect x="-15" y="10.25" width="160" height="7.5" fill="var(--logo-ink)"></rect>
            <rect x="-15" y="34.25" width="160" height="7.5" fill="var(--logo-ink)"></rect>
            <rect x="-15" y="58.25" width="160" height="7.5" fill="var(--logo-ink)"></rect>
            <rect x="-15" y="82.25" width="160" height="7.5" fill="var(--logo-ink)"></rect>
          </g>
        </svg>
      </div>

      <h2 class="title"><span class="title-tab">Tab</span><span class="title-engine">Engine</span></h2>

      {#if !$playerStore.sfLoaded}
        <p class="subtitle">Loading SoundFont…</p>
        <div class="progress-track" role="progressbar"
             aria-valuenow={Math.round(progress * 100)} aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill" style="width: {progress * 100}%"></div>
        </div>
        <span class="pct">{Math.round(progress * 100)}%</span>
      {:else if !scoreReady}
        <p class="subtitle">Rendering score…</p>
        <div class="spinner" aria-hidden="true">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-overlay);
    backdrop-filter: blur(10px);
    z-index: 50;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 40px 52px;
    border-radius: 20px;
    min-width: 280px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    animation: scaleIn 0.4s var(--ease-out);
  }

  .logo-mark {
    margin-bottom: 4px;
    filter: drop-shadow(0 0 16px var(--accent-glow));
  }

  .title {
    font-family: var(--font-logo);
    font-size: 2rem;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin: 0;
  }

  .title-tab {
    font-weight: 500;
  }

  .title-engine {
    font-weight: 700;
  }

  .subtitle {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .progress-track {
    width: 200px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-bright));
    border-radius: 2px;
    transition: width 0.2s ease;
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .pct {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }

  /* Three-dot loader */
  .spinner {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: bounce 1.2s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
    40%           { transform: scale(1);   opacity: 1; }
  }
</style>
