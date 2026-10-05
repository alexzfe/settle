// A modal box over the page, the find box's shape made shared: a dimmed backdrop that closes it
// on a click outside, Escape that closes it from the keyboard, and focus moved into it on opening
// and given back to whatever had it on closing.

import { type ReactNode, useEffect, useRef } from "react";
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
  const panel = useRef<HTMLDivElement>(null);
  // The latest onClose, so a parent re-rendering does not re-run the effect and steal focus.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return (
    // The backdrop is a pointer convenience: Escape closes the box for the keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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
