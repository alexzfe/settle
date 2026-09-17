// Text the Agent wrote (Guides, Session summaries, Decision statements, Requirement text), set on
// a light tint with a label saying so, apart from recorded facts and the user's own words.

import type { ReactNode } from "react";
import styles from "./ui.module.css";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** A date as the label reads it, in the reader's time zone: "14 Sep". Undefined when unreadable. */
export function shortDate(at: string): string | undefined {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** The tinted authorship block: "Written by the Agent · Purchase Session · 14 Sep". */
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
