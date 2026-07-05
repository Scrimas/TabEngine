// canvasCoords.ts — pure coordinate conversions shared by score overlays
// (tuning labels, playhead pick, loop handles) that need to translate between
// alphaTab's canvas coordinate space and viewport-relative / client px.

/**
 * Convert alphaTab canvas coordinates → `.at-viewport`-element-relative px.
 * Adds back the viewport's current scroll offset so the result is the
 * position within the *unscrolled* content box — overlay elements are normal
 * (scrolling) children of `.at-viewport`, so the browser's native scroll
 * already moves them; re-deriving from live (scrolled) bounding rects
 * without this would double-count the scroll offset and drift at 2x speed.
 */
export function canvasToViewport(
  cx: number,
  cy: number,
  viewportEl: HTMLElement | null,
  atMainEl: HTMLElement | null,
): { x: number; y: number } {
  if (!viewportEl || !atMainEl) return { x: cx, y: cy };
  const vr = viewportEl.getBoundingClientRect();
  const mr = atMainEl.getBoundingClientRect();
  return {
    x: cx + (mr.left - vr.left) + viewportEl.scrollLeft,
    y: cy + (mr.top - vr.top) + viewportEl.scrollTop,
  };
}

/** Convert a mouse/pointer client position → alphaTab canvas coordinates. */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  atMainEl: HTMLElement | null,
): { x: number; y: number } {
  if (!atMainEl) return { x: 0, y: 0 };
  const mr = atMainEl.getBoundingClientRect();
  return { x: clientX - mr.left, y: clientY - mr.top };
}
