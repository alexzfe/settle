// The theme picker in the header: follow the system, or always light, or always dark. A pick is
// saved in this browser and set as data-theme on <html>, which tokens.css reads. index.html applies
// the saved pick before the first paint, with the same storage key, so the page never flashes.

import { useState } from "react";
import styles from "./ui.module.css";

export type ThemeChoice = "system" | "light" | "dark";

/** The localStorage key. index.html's inline script reads the same one. */
export const THEME_KEY = "settle-theme";

const CHOICES: [ThemeChoice, string][] = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

/** The saved pick, or "system" when nothing usable is saved or storage cannot be read. */
export function savedTheme(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Shows the pick on <html> and saves it; "system" clears both. Storage failures only skip saving. */
export function applyTheme(
  choice: ThemeChoice,
  root: HTMLElement = document.documentElement,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    // Private windows and blocked site data: the pick holds for this page only.
  }
}

/** window.localStorage, or undefined where even reading the property throws. */
function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** System / Light / Dark, as three small pressed-or-not buttons. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => savedTheme());
  return (
    <fieldset className={styles.themeToggle} aria-label="Theme">
      {CHOICES.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="secondary"
          aria-pressed={choice === value}
          onClick={() => {
            applyTheme(value);
            setChoice(value);
          }}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
