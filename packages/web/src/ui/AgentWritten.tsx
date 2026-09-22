// Text the Agent wrote (Guides, Session summaries, Decision statements, Requirement text), under a
// label saying so and set in the serif at reading size, apart from recorded facts and the user's
// own words. No tint: the type is the signal.

import type { ReactNode } from "react";
import styles from "./ui.module.css";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** A date as the label reads it, in the reader's time zone: "14 Sep". Undefined when unreadable. */
export function shortDate(at: string): string | undefined {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** The authorship block: "Written by the Agent · Purchase Session · 14 Sep", then the prose. */
export function AgentWritten({
  source,
  date,
  children,
}: {
  /** Where it was written, e.g. "Purchase Session". */
  source?: ReactNode;
  /** An ISO date or timestamp. */
  date?: string | undefined;
  children: ReactNode;
}) {
  const when = date === undefined ? undefined : shortDate(date);
  return (
    <div className={styles.agentWritten}>
      <p className={styles.agentLabel}>
        Written by the Agent
        {source && <> · {source}</>}
        {when && <> · {when}</>}
      </p>
      <div className={styles.agentBody}>{children}</div>
    </div>
  );
}
