<script lang="ts">
  import { playerStore } from '$lib/stores/player';
  import { canvasToViewport, clientToCanvas } from '$lib/alphatab/canvasCoords';
  import { getBeatAtCanvasPos, dragLoopHandle, commitLoopHandleDrag } from '$lib/alphatab/AlphaTabManager';

  export let atMainEl: HTMLElement | null;
  export let viewportEl: HTMLDivElement;

  let dragging: 'start' | 'end' | null = null;

  // Handle geometry copied verbatim from Songsterr's own loop-handle SVG
  // (rail + a rounded "grip" lobe bulging outward from the loop, holding the
  // chevron). The rail is a plain full-height 2-unit-wide bar; the bulge is
  // drawn separately, in its own LOCAL coordinate space (attachment point at
  // the origin), and positioned via a <g transform>. When the row is tall
  // enough, the bulge renders at Songsterr's exact fixed size and only the
  // rail stretches to fill the rest of H — matching Songsterr's own rows,
  // which are much taller than the bulge. When H is too short for that (a
  // dense single-track view here can be shorter than Songsterr's rows), the
  // bulge itself is uniformly Y-scaled down to fit instead of letting the
  // rails clamp to a minimum — clamping the rails alone left almost no rail
  // visible and made the bulge dominate the whole handle like a solid blob.
  const HANDLE_W  = 18;
  const BULGE_H   = 37.84;  // sum of |dy| across the bulge's curve commands below
  const RAIL_MIN  = 4;

  function geometry(h: number): { r: number; bulgeScale: number } {
    const idealR = (h - BULGE_H) / 2;
    if (idealR >= RAIL_MIN) return { r: idealR, bulgeScale: 1 };
    const bulgeH = Math.max(4, h - 2 * RAIL_MIN);
    return { r: RAIL_MIN, bulgeScale: bulgeH / BULGE_H };
  }

  function railPath(h: number): string {
    return `M0,0 h2 v${h} h-2 Z`;
  }

  // Local frame: origin sits where the bulge meets the rail (rail's right
  // edge). Curve deltas are Songsterr's exact numbers — dx sums to 0 and dy
  // sums to -BULGE_H, so `Z` closes the shape with a straight vertical edge
  // back down to the origin, flush against the rail.
  const BULGE_LOCAL_D = 'M0,0 '
    + 'c0.06,-5.44 5.85,-8.4 9.97,-9.82 '
    + 'c2.29,-0.8 4.03,-2.87 4.03,-5.29 '
    + 'l0,-7.63 '
    + 'c0,-2.42 -1.74,-4.49 -4.03,-5.28 '
    + 'c-4.12,-1.42 -9.91,-4.39 -9.97,-9.82 Z';

  function bulgeTransform(h: number): string {
    const { r, bulgeScale } = geometry(h);
    return `translate(2, ${h - r}) scale(1, ${bulgeScale.toFixed(4)})`;
  }

  // Songsterr's exact chevron icon path (unflipped/right-handle orientation),
  // whose own local bounding box is centered at (7.38, 75.28). Nested inside
  // the same <g> as the bulge (see template), so it inherits the bulge's
  // translate+scale automatically — the transform below is now a constant:
  // it only needs to shift the icon's own center to the bulge's LOCAL center
  // (x: bulge's fixed horizontal midpoint; y: -BULGE_H/2, since the bulge's
  // local span is 0 to -BULGE_H).
  const ICON_D = 'M10,69.5 c-0.43,-0.35 -1.06,-0.28 -1.4,0.16 l-4,5 c-0.29,0.36 -0.29,0.88 0,1.24 '
    + 'l4,5 c0.34,0.44 0.97,0.51 1.4,0.16 c0.44,-0.34 0.51,-0.97 0.16,-1.4 l-3.5,-4.38 l3.5,-4.38 '
    + 'c0.35,-0.43 0.28,-1.06 -0.16,-1.4 Z';
  const ICON_TRANSFORM = `translate(1.62, ${(-BULGE_H / 2 - 75.28).toFixed(2)})`;

  $: highlight = $playerStore.isLooping ? $playerStore.loopHighlight : null;
  $: startHandle = highlight
    ? { ...canvasToViewport(highlight.startX, highlight.startY, viewportEl, atMainEl), h: highlight.startH }
    : null;
  $: endHandle = highlight
    ? { ...canvasToViewport(highlight.endX, highlight.endY, viewportEl, atMainEl), h: highlight.endH }
    : null;

  function onPointerDown(e: PointerEvent, which: 'start' | 'end') {
    e.preventDefault();
    e.stopPropagation();
    dragging = which;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const canvas = clientToCanvas(e.clientX, e.clientY, atMainEl);
    const beat = getBeatAtCanvasPos(canvas.x, canvas.y);
    if (beat) dragLoopHandle(dragging, beat);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = null;
    commitLoopHandleDrag();
  }

  // Defensive: if pointer capture is ever lost without a pointerup reaching
  // us (e.g. the browser cancels it), the browser fires pointercancel
  // instead — without this, `dragging` would stay stuck truthy and the
  // handle would keep "dragging" on every subsequent mouse move even with
  // the button released.
  function onPointerCancel() {
    if (!dragging) return;
    dragging = null;
    commitLoopHandleDrag();
  }
</script>

{#if startHandle}
  <!-- Start (left) handle: mirrored via scaleX(-1) so the bulge points left
       (outward, away from the loop) and the chevron points right (inward) —
       exactly how Songsterr derives its left handle from the same base path. -->
  <div
    class="loop-handle loop-handle-flipped"
    style="left:{startHandle.x - HANDLE_W}px; top:{startHandle.y}px; height:{startHandle.h}px; width:{HANDLE_W}px"
    on:pointerdown={(e) => onPointerDown(e, 'start')}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerCancel}
    title="Drag to move loop start"
    aria-label="Loop start handle"
  >
    <svg width={HANDLE_W} height={startHandle.h} viewBox="0 0 {HANDLE_W} {startHandle.h}">
      <path d={railPath(startHandle.h)} class="loop-handle-shape" />
      <g transform={bulgeTransform(startHandle.h)}>
        <path d={BULGE_LOCAL_D} class="loop-handle-shape" />
        <path d={ICON_D} transform={ICON_TRANSFORM} class="loop-handle-icon" />
      </g>
    </svg>
  </div>
{/if}

{#if endHandle}
  <!-- End (right) handle: base (unflipped) orientation — bulge points right
       (outward, away from the loop), chevron points left (inward). -->
  <div
    class="loop-handle"
    style="left:{endHandle.x}px; top:{endHandle.y}px; height:{endHandle.h}px; width:{HANDLE_W}px"
    on:pointerdown={(e) => onPointerDown(e, 'end')}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerCancel}
    title="Drag to move loop end"
    aria-label="Loop end handle"
  >
    <svg width={HANDLE_W} height={endHandle.h} viewBox="0 0 {HANDLE_W} {endHandle.h}">
      <path d={railPath(endHandle.h)} class="loop-handle-shape" />
      <g transform={bulgeTransform(endHandle.h)}>
        <path d={BULGE_LOCAL_D} class="loop-handle-shape" />
        <path d={ICON_D} transform={ICON_TRANSFORM} class="loop-handle-icon" />
      </g>
    </svg>
  </div>
{/if}

<style>
  .loop-handle {
    position: absolute;
    cursor: ew-resize;
    z-index: 20;
    user-select: none;
    touch-action: none;
  }
  .loop-handle-flipped {
    transform: scaleX(-1);
  }

  .loop-handle-shape {
    fill: var(--accent);
    filter: drop-shadow(0 2px 4px rgba(192,120,56,0.40));
  }
  .loop-handle:hover .loop-handle-shape {
    fill: var(--accent-bright);
  }
  .loop-handle-icon {
    fill: #fff;
    pointer-events: none;
  }
</style>
