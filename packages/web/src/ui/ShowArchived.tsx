// The clutter rule: lists show live records by default, with a switch for the old ones. The switch
// starts off and is remembered per browser, when the browser lets it be.

import { useState } from "react";
import styles from "./ui.module.css";

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) === "on";
  } catch {
    return false;
  }
}

/** A switch remembered in this browser under `key`, off until turned on. */
export function useRememberedSwitch(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => stored(key));
  const set = (next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(key, "on");
      else localStorage.removeItem(key);
    } catch {
      // Not remembered, then: the switch still works for this page.
    }
  };
  return [on, set];
}

/** "Show Archived (2)": a checkbox switch, rendered only when there is something to show. */
export function ShowSwitch({
  label,
  count,
  on,
  onChange,
}: {
  label: string;
  count: number;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  if (count === 0) return null;
  return (
    <label className={styles.showSwitch}>
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} />{" "}
      {label} ({count})
    </label>
  );
}
