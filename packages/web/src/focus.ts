// Where keyboard focus goes when the control that had it goes away: a button that unmounts on
// press, a form that closes. Without this, focus falls to the page body and a keyboard or
// screen-reader user starts again from the top of the page.

import { useCallback, useEffect, useRef } from "react";

/** Whether focus has been lost: nothing has it, or only the page body does. */
export function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/** Focuses `element`, making it focusable from script first if it is not, when focus was lost. */
export function rescueFocus(element: HTMLElement | null | undefined): void {
  if (!element?.isConnected || !focusLost()) return;
  if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.focus();
}

const CONTROLS = "button:not(:disabled), input:not([type=hidden]), select, textarea, a[href]";

/** The first control in `region`, or the region itself when it has none. */
export function firstControl(region: HTMLElement): HTMLElement {
  return region.querySelector<HTMLElement>(CONTROLS) ?? region;
}

/**
 * A ref for a region that appears in place of the control just pressed: when it mounts and focus
 * was lost with that control, focus moves to the region's first control. Not on the component's
 * first render, when nothing was pressed.
 */
export function useFocusArrival<T extends HTMLElement>(): (element: T | null) => void {
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  return useCallback((element: T | null) => {
    if (element && settled.current) rescueFocus(firstControl(element));
  }, []);
}

/**
 * Focuses what `find` returns once it is on the page and focus has been lost, as when a refetch
 * removes the control that had it. Gives up after about a second, and never takes focus from
 * where the user has since put it.
 */
export function rescueFocusSoon(find: () => HTMLElement | null, tries = 20): void {
  const target = find();
  if (target && focusLost()) {
    rescueFocus(firstControl(target));
    return;
  }
  if (tries > 0) setTimeout(() => rescueFocusSoon(find, tries - 1), 50);
}

/**
 * Makes inert everything on the page beside `element` and its ancestors, and returns what it
 * changed, so closing undoes only that and leaves alone what was inert already.
 */
export function inertAround(element: HTMLElement): HTMLElement[] {
  const changed: HTMLElement[] = [];
  for (let at: HTMLElement | null = element; at && at !== document.body; at = at.parentElement) {
    for (const sibling of at.parentElement?.children ?? []) {
      if (sibling === at || !(sibling instanceof HTMLElement) || sibling.hasAttribute("inert")) {
        continue;
      }
      sibling.setAttribute("inert", "");
      changed.push(sibling);
    }
  }
  return changed;
}
