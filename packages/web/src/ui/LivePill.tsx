// Whether the pages are receiving the Agent's changes as they happen.

import type { LiveState } from "../liveUpdates";
import styles from "./ui.module.css";

const LABEL: Record<"reconnecting" | "stopped", string> = {
  reconnecting: "Reconnecting",
  stopped: "Updates stopped",
};

/**
 * "Reconnecting", or "Updates stopped" with a Reload button: the states that say the page has
 * stopped following the Agent. Nothing while connecting or live.
 */
export function LivePill({ state }: { state: LiveState }) {
  if (state === "connecting" || state === "live") return null;
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
