// A modal box over the page, the find box's shape made shared: a dimmed backdrop that closes it
// on a click outside, Escape that closes it from the keyboard, and focus moved into it on opening
// and given back to whatever had it on closing. While it is open the rest of the page is inert, so
// Tab stays in the box and a screen reader reads only the box.

import { type ReactNode, useEffect, useRef } from "react";
import { inertAround } from "../focus";
import styles from "./ui.module.css";

export function Dialog({
  label,
  onClose,
  className,
  children,
}: {
  /** What a screen reader announces the box as. */
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Whether the press now ending began on the backdrop: a drag out of a field is not a click outside.
  const pressedOutside = useRef(false);
  // The latest onClose, so a parent re-rendering does not re-run the effect and steal focus.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    const madeInert = backdrop.current ? inertAround(backdrop.current) : [];
    panel.current?.focus();
    // Each field's text when focus reached it: what it held then is saved, not typing to keep.
    const onArrival = new WeakMap<EventTarget, string>();
    const onFocus = (event: FocusEvent) => {
      if (event.target && isTextField(event.target))
        onArrival.set(event.target, event.target.value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const field = event.target;
      if (field && isTextField(field) && field.value !== (onArrival.get(field) ?? "")) return;
      close.current();
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey);
      for (const element of madeInert) element.removeAttribute("inert");
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return (
    // The backdrop is a pointer convenience: Escape closes the box for the keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
    <div
      ref={backdrop}
      className={styles.backdrop}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOutside.current) onClose();
        pressedOutside.current = false;
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={className ? `${styles.dialog} ${className}` : styles.dialog}
      >
        {children}
      </div>
    </div>
  );
}

/** A field Escape could throw typing away from. */
function isTextField(target: EventTarget): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
