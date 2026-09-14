// The Home page's flags and Conflicts: every one still open, with the actions that clear it.

import { Link } from "react-router";
import { type Action, Actions } from "./Actions";
import styles from "./App.module.css";
import { call, type DecisionSummary, type Resolution } from "./api";
import { decisionPath, flagCause, KIND_LABEL, STATE_LABEL } from "./decisions";
import { formatDate } from "./format";
import { useDecisions } from "./queries";

/** Keep always; Reopen only a Locked Decision; Reject any that is not Rejected already. */
function resolutions(
  decision: DecisionSummary,
  post: (resolution: Resolution, reason: string | undefined) => Promise<unknown>,
): Action[] {
  const allowed: [Resolution, string][] = [["keep", "Keep"]];
  if (decision.state === "locked") allowed.push(["reopen", "Reopen"]);
  if (decision.state !== "rejected") allowed.push(["reject", "Reject"]);
  return allowed.map(([resolution, label]) => ({
    label,
    post: (reason) => post(resolution, reason),
  }));
}

/** The reason field of a resolution, left out when none was given. */
function withReason(reason: string | undefined): { reason?: string } {
  return reason ? { reason } : {};
}

export function FlagsAndConflicts({ home }: { home: string }) {
  const decisions = useDecisions(home);
  if (decisions.isPending) return <p>Loading…</p>;
  if (decisions.isError) return <p className={styles.error}>{decisions.error.message}</p>;
  const flags = decisions.data.decisions.flatMap((decision) =>
    decision.openFlags.map((flag) => ({ flag, decision })),
  );
  const conflicts = decisions.data.decisions.flatMap((decision) =>
    decision.openConflicts.map((conflict) => ({ conflict, decision })),
  );
  if (flags.length + conflicts.length === 0) return <p>None: no Decision needs review.</p>;
  return (
    <ul>
      {flags.map(({ flag, decision }) => (
        <li key={flag.slug}>
          Flag on <DecisionName home={home} decision={decision} />: {flagCause(flag)}, raised{" "}
          {formatDate(flag.raisedAt)}.
          <Actions
            home={home}
            actions={resolutions(decision, (resolution, reason) =>
              call("resolve_flag", { home, flag: flag.slug, resolution, ...withReason(reason) }),
            )}
          />
        </li>
      ))}
      {conflicts.map(({ conflict, decision }) => (
        <li key={conflict.slug}>
          Conflict on <DecisionName home={home} decision={decision} />: {conflict.description},
          raised {formatDate(conflict.raisedAt)}.
          <Actions
            home={home}
            actions={resolutions(decision, (resolution, reason) =>
              call("resolve_conflict", {
                home,
                conflict: conflict.slug,
                resolution,
                ...withReason(reason),
              }),
            )}
          />
        </li>
      ))}
    </ul>
  );
}

function DecisionName({ home, decision }: { home: string; decision: DecisionSummary }) {
  return (
    <>
      <Link to={decisionPath(home, decision.slug)}>{decision.title}</Link> (
      {KIND_LABEL[decision.kind]}, {STATE_LABEL[decision.state]})
    </>
  );
}
