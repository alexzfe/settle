// Whether the pages are receiving the Agent's changes as they happen.

import type { LiveState } from "../liveUpdates";
import styles from "./ui.module.css";

const LABEL: Record<LiveState, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  stopped: "Updates stopped",
};

/** "● Live", "Reconnecting", or "Updates stopped" with a Reload button. */
export function LivePill({ state }: { state: LiveState }) {
  return (
    <span className={`${styles.live} ${styles[`live-${state}`]}`} aria-live="polite">
      <span className={styles.liveDot} aria-hidden />
      {LABEL[state]}
      {state === "stopped" && (
        <button type="button" className="secondary" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
    </span>
  );
}
