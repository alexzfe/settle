// A titled part of a page, with an optional action (a link or AskAgent) beside the title.

import type { ReactNode } from "react";
import styles from "./ui.module.css";

/** A section with an h2 title in the serif; `id` makes it a link target. */
export function Section({
  title,
  action,
  id,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <section className={styles.section} id={id}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {action && <div className={styles.sectionAction}>{action}</div>}
      </div>
      {children}
    </section>
  );
}
