// A Decision's state as the mark, the one state indicator in the app: 17px, the fill level is the
// state. Ink while it is being worked out, olive once Settled, a stone ring once Rejected.

import type { DecisionState } from "../api";
import { STATE_LABEL } from "../decisions";
import { type Level, SettleIcon } from "./SettleIcon";
import styles from "./ui.module.css";

/** How full each state's mark is: Rejected empty, Candidate low, Leaning half, Settled full. */
export const STATE_LEVEL: Record<DecisionState, Level> = {
  rejected: 0,
  candidate: 1,
  leaning: 2,
  settled: 3,
};

/** The mark for `state`, named for a screen reader ("Leaning"). */
export function StateMark({ state, className }: { state: DecisionState; className?: string }) {
  return (
    <span
      className={[styles.stateMark, styles[`mark-${state}`], className].filter(Boolean).join(" ")}
      role="img"
      aria-label={STATE_LABEL[state]}
      title={STATE_LABEL[state]}
    >
      <SettleIcon level={STATE_LEVEL[state]} size={17} />
    </span>
  );
}
