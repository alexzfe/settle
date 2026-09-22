// A titled part of a page, with an optional action (a link or AskAgent) beside the title.

import type { ReactNode } from "react";
import styles from "./ui.module.css";

/**
 * A section with an h2 title and a hairline under it; `id` makes it a link target. The title is
 * the serif by default, and a small-caps label where the part is a utility one, as the Room
 * Sheet's parts are ("Walls", "Items").
 */
export function Section({
  title,
  action,
  id,
  heading = "serif",
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  id?: string;
  heading?: "serif" | "label";
  children?: ReactNode;
}) {
  return (
    <section className={styles.section} id={id}>
      <div className={styles.sectionHeader}>
        <h2 className={heading === "label" ? `label ${styles.sectionLabel}` : styles.sectionTitle}>
          {title}
        </h2>
        {action && <div className={styles.sectionAction}>{action}</div>}
      </div>
      {children}
    </section>
  );
}
