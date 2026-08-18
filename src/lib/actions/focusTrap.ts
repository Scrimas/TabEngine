// actions/focusTrap.ts — modal focus management.
//
// Svelte action for modal dialogs: moves focus inside on mount, keeps Tab
// cycling within the container, and restores focus to whatever had it when
// the modal closes. Apply to the modal's root element:
//
//   <div class="my-modal" use:focusTrap>

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusTrap(node: HTMLElement) {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const focusables = () =>
    Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      // offsetParent is null for display:none subtrees (but not for children
      // of the position:fixed modal itself, whose offsetParent is the modal).
      el => el.offsetParent !== null || el === document.activeElement,
    );

  // Move focus inside: first control, or the container itself as a fallback.
  const first = focusables()[0];
  if (first) {
    first.focus();
  } else {
    node.tabIndex = -1;
    node.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const els = focusables();
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const idx = els.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const next = e.shiftKey
      ? (idx <= 0 ? els.length - 1 : idx - 1)
      : (idx === -1 || idx === els.length - 1 ? 0 : idx + 1);
    els[next].focus();
  }

  node.addEventListener('keydown', handleKeyDown);
  return {
    destroy() {
      node.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    },
  };
}
