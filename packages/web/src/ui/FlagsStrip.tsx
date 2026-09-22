// What needs the user, above a page's title: the open Flags and Conflicts across the Home, the
// Decisions they sit on, and one way in. Shown on Overview and the Decisions list only, and gone
// at zero: an all-clear never takes the loudest spot on the page.

import { Link } from "react-router";
import type { DecisionSummary } from "../api";
import { useDecisions } from "../queries";
import styles from "./ui.module.css";

/** How many Decisions the strip names before "and n more". */
export const NAMED = 3;

function counted(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** "2 Flags, 1 Conflict" and the Decisions they are on; undefined when nothing is open. */
export function flagsSummary(
  decisions: DecisionSummary[],
): { counts: string; names: string } | undefined {
  const flagged = decisions.filter(
    (decision) =>
      !decision.archivedAt && (decision.openFlags.length > 0 || decision.openConflicts.length > 0),
  );
  if (flagged.length === 0) return undefined;
  const flags = flagged.reduce((sum, decision) => sum + decision.openFlags.length, 0);
  const conflicts = flagged.reduce((sum, decision) => sum + decision.openConflicts.length, 0);
  const counts = [flags && counted(flags, "Flag"), conflicts && counted(conflicts, "Conflict")]
    .filter(Boolean)
    .join(", ");
  const titles = flagged.slice(0, NAMED).map((decision) => decision.title);
  const more = flagged.length - titles.length;
  const named = more > 0 ? `${titles.join(", ")} and ${more} more` : titles.join(", ");
  return { counts, names: `${named} ${flagged.length === 1 ? "needs" : "need"} a look.` };
}

/**
 * The strip for `home`, or nothing while loading, on error, or when nothing is open. It asks for
 * the Decisions as the Decisions list and the sidebar do, so all three share one request.
 */
export function FlagsStrip({ home }: { home: string }) {
  const decisions = useDecisions(home, { archived: true });
  const summary = decisions.data && flagsSummary(decisions.data.decisions);
  if (!summary) return null;
  return (
    <aside className={styles.flagsStrip} aria-label="Flags">
      <p className={styles.flagsText}>
        <strong>{summary.counts}</strong> {summary.names}
      </p>
      <Link to={`/homes/${home}/decisions?flagged=1`} className={styles.flagsAction}>
        Review
      </Link>
    </aside>
  );
}
