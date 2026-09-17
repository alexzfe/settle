// Decision states, Fulfilment, and Flags as small marks. A state always pairs a symbol with its
// name and color, so it never relies on color alone.

import type { ReactNode } from "react";
import type { DecisionState } from "../api";
import { STATE_LABEL } from "../decisions";
import styles from "./ui.module.css";

/** Each state's symbol: ○ Candidate, ◐ Leaning, ● Locked, ✕ Rejected (struck through and faded). */
export const STATE_SYMBOL: Record<DecisionState, string> = {
  candidate: "○",
  leaning: "◐",
  locked: "●",
  rejected: "✕",
};

/** A Decision's state as a pill: "◐ Leaning". */
export function StatePill({ state }: { state: DecisionState }) {
  return (
    <span className={`${styles.pill} ${styles[state]}`}>
      <span aria-hidden>{STATE_SYMBOL[state]}</span>
      <span className={styles.pillLabel}>{STATE_LABEL[state]}</span>
    </span>
  );
}

/** "✓ Fulfilled", a small note beside a Locked Decision's state (Fulfilled is not a state). */
export function FulfilledNote({ children = "Fulfilled" }: { children?: ReactNode }) {
  return (
    <span className={styles.fulfilled}>
      <span aria-hidden>✓</span> {children}
    </span>
  );
}

/** A small ochre ⚑ marking a flagged Decision, with the cause as optional text beside it. */
export function FlagMark({ children }: { children?: ReactNode }) {
  return (
    <span className={styles.flagMark}>
      <span role="img" aria-label="Flagged" title="Flagged for review">
        ⚑
      </span>
      {children && <span> {children}</span>}
    </span>
  );
}
