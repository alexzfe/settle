// A set-off note in running text: a tip (olive), something important (ochre), or a warning (red).

import { type ReactNode, useId } from "react";
import styles from "./ui.module.css";

export type CalloutTone = "tip" | "important" | "warning";

const TONE_LABEL: Record<CalloutTone, string> = {
  tip: "Tip",
  important: "Important",
  warning: "Warning",
};

/**
 * A callout with a title, which defaults to the tone's name ("Tip"). A note named by its title,
 * not an aside: a page with several would fill the landmark list with identical entries.
 */
export function Callout({
  tone,
  title,
  children,
}: {
  tone: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div role="note" aria-labelledby={id} className={`${styles.callout} ${styles[tone]}`}>
      <p id={id} className={styles.calloutTitle}>
        {title ?? TONE_LABEL[tone]}
      </p>
      {children && <div className={styles.calloutBody}>{children}</div>}
    </div>
  );
}
