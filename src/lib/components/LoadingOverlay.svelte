<script lang="ts">
  import { playerStore } from '$lib/stores/player';

  $: progress = $playerStore.sfLoadProgress;
  $: loaded   = $playerStore.sfLoaded;
  $: scoreLoaded = false; // injected via prop

  export let scoreReady = false;

  $: show = !$playerStore.isReady || !scoreReady;
</script>

{#if show}
  <div class="overlay" role="status" aria-label="Loading">
    <div class="panel glass">
      <!-- Logo mark -->
      <div class="logo-mark" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="rgba(76,201,192,0.15)"/>
          <path d="M14 34 L14 14 L20 14 L20 26 L28 14 L34 14 L34 34 L28 34 L28 22 L20 34 Z"
                fill="#4cc9c0"/>
          <path d="M20 26 L28 22" stroke="#6fe0d7" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>

      <h2 class="title">TabEngine</h2>

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
    background: rgba(246,241,231,0.85);
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
    box-shadow: 0 24px 64px rgba(90,75,55,0.22);
    animation: scaleIn 0.4s var(--ease-out);
  }

  .logo-mark {
    margin-bottom: 4px;
    filter: drop-shadow(0 0 16px rgba(76,201,192,0.5));
  }

  .title {
    font-size: 1.4rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
  }

  .subtitle {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .progress-track {
    width: 200px;
    height: 4px;
    background: rgba(43,40,35,0.10);
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
