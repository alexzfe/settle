// Flags and Conflicts: the Home page's list of every one still open, with the actions that clear
// it, and a flag's cause with its source named, which the Decision page shows too.

import { Link } from "react-router";
import { type Action, Actions } from "./Actions";
import styles from "./App.module.css";
import { call, type DecisionState, type DecisionSummary, type Flag, type Resolution } from "./api";
import { decisionPath, flagCauseText, KIND_LABEL, recordPath, STATE_LABEL } from "./decisions";
import { formatDate } from "./format";
import { useDecisions, useHome } from "./queries";

/** Keep always; Reopen only a Locked Decision; Reject any that is not Rejected already. */
function resolutions(
  decision: { state: DecisionState },
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

/** The actions that clear the flag `flag` (its slug) on `decision`, through resolve_flag. */
export function flagActions(
  home: string,
  decision: { state: DecisionState },
  flag: string,
): Action[] {
  return resolutions(decision, (resolution, reason) =>
    call("resolve_flag", { home, flag, resolution, ...withReason(reason) }),
  );
}

/**
 * Why a Decision was flagged, its source named and linked to the page showing it: "Warm
 * minimalism was reopened", "Wall 2's length changed".
 */
export function FlagCause({ home, flag }: { home: string; flag: Flag }) {
  // A Window, Door, or Feature is found in its Room through the Home's Rooms.
  const rooms = useHome(home).data?.rooms;
  const path = recordPath(home, flag.source.kind, flag.source.slug, rooms);
  return (
    <>
      {path ? <Link to={path}>{flag.source.name}</Link> : flag.source.name}
      {flagCauseText(flag)}
    </>
  );
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
          Flag on <DecisionName home={home} decision={decision} />:{" "}
          <FlagCause home={home} flag={flag} />, raised {formatDate(flag.raisedAt)}.
          <Actions home={home} actions={flagActions(home, decision, flag.slug)} />
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
