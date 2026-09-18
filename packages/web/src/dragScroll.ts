// Scrolling a wide board sideways by dragging its ground with the mouse, the way a sheet of paper
// is pulled along a desk. The scrollbar stays: it is the hint that there is more to the right.

import { type PointerEvent, useRef, useState } from "react";

/** How far a press must travel sideways before it is a drag; anything shorter is still a click. */
export const DRAG_THRESHOLD = 6;

/** What a press is left alone on: the things that do something when pressed. */
const CONTROLS = "button, a, input, select, textarea, label";

/**
 * Handlers for a horizontally scrolling element, and whether it is being dragged right now.
 *
 * Only a mouse drags: touch already scrolls natively, and a pen is usually drawing or selecting.
 * A press on a control, or inside anything matching `leaveAlone`, is never taken, so a click on a
 * button behaves exactly as it did. No click is ever swallowed either — the press never started
 * on something that acts on a click.
 */
export function useDragScroll<T extends HTMLElement>(leaveAlone?: string) {
  const press = useRef<{ pointer: number; x: number; left: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const ignored = leaveAlone ? `${CONTROLS}, ${leaveAlone}` : CONTROLS;

  function end(event: PointerEvent<T>) {
    const current = press.current;
    if (!current || current.pointer !== event.pointerId) return;
    press.current = null;
    if (current.moved) setDragging(false);
  }

  return {
    dragging,
    handlers: {
      onPointerDown(event: PointerEvent<T>) {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        const element = event.currentTarget;
        if (element.scrollWidth <= element.clientWidth) return;
        if (event.target instanceof Element && event.target.closest(ignored)) return;
        press.current = {
          pointer: event.pointerId,
          x: event.clientX,
          left: element.scrollLeft,
          moved: false,
        };
      },
      onPointerMove(event: PointerEvent<T>) {
        const current = press.current;
        if (!current || current.pointer !== event.pointerId) return;
        // Released somewhere the board never heard about: the press is over.
        if ((event.buttons & 1) === 0) {
          end(event);
          return;
        }
        const dx = event.clientX - current.x;
        if (!current.moved) {
          if (Math.abs(dx) < DRAG_THRESHOLD) return;
          current.moved = true;
          setDragging(true);
          // Keep the drag when the mouse leaves the board, and drop any text the first few pixels
          // of the press began to select.
          event.currentTarget.setPointerCapture?.(event.pointerId);
          window.getSelection()?.removeAllRanges();
        }
        event.currentTarget.scrollLeft = current.left - dx;
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}
