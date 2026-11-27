// Dragging a module (issue #25). A press becomes a drag once the pointer
// travels past a small threshold; until then it stays a click, which the
// click handlers own. A drag picks on its start and drops on whatever sits
// under the pointer at release, so a drag is a pick plus a click through
// the same placement path. The click the browser fires after a drag is
// swallowed so it can't act twice.

const THRESHOLD = 6;

export interface DragHandlers {
  begin: () => void;
  drop: (target: Element | null) => void;
}

export function startDrag(event: PointerEvent, handlers: DragHandlers): void {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  const move = (e: PointerEvent) => {
    if (dragging || Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
    dragging = true;
    handlers.begin();
  };
  const up = (e: PointerEvent) => {
    teardown();
    if (!dragging) return;
    swallowNextClick();
    handlers.drop(document.elementFromPoint(e.clientX, e.clientY));
  };
  const teardown = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", teardown);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", teardown);
}

function swallowNextClick(): void {
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}
