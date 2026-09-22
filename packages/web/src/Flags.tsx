// Flags and Conflicts: each one still open, asked as a plain question with a way back to the
// Agent, and the actions that clear it behind "Decide here instead"; and a flag's cause with its
// source named, which the Decision page shows too.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { type Action, Actions } from "./Actions";
import {
  type Conflict,
  call,
  type DecisionKind,
  type DecisionState,
  type DecisionSummary,
  type Flag,
  type Resolution,
} from "./api";
import { decisionPath, flagCauseText, KIND_LABEL, recordPath, STATE_LABEL } from "./decisions";
import flagStyles from "./Flags.module.css";
import { useHome } from "./queries";
import { shortDate } from "./ui/AgentWritten";
import { AskAgent, buildPrompt } from "./ui/AskAgent";
import { StateMark } from "./ui/StateMark";

/**
 * A Decision that needs the user, marked as the second line of a list row is: a 4px dot in the
 * attention color, with what is wrong beside it.
 */
export function FlagDot({ children }: { children?: ReactNode }) {
  return (
    <span className={flagStyles.flagDot}>
      <span className={flagStyles.dot} role="img" aria-label="Flagged" title="Flagged for review" />
      {children && <span>{children}</span>}
    </span>
  );
}

/** The Skill that owns a Decision of each kind, named in a prompt; none for Other. */
export const SKILL_OF_KIND: Record<DecisionKind, string | undefined> = {
  "design-direction": "Design Direction",
  "room-direction": "Design Direction",
  "room-use": "Design Direction",
  palette: "Color",
  "room-color": "Color",
  purchase: "Purchase",
  other: undefined,
};

/** What each resolution does, beside its button. */
const RESOLUTION_EFFECT: Record<Resolution, string> = {
  keep: "Keep leaves it as it is.",
  reopen: "Reopen moves it back to Leaning and flags what rests on it.",
  reject: "Reject retires it.",
};

/** The resolutions a Decision allows: Keep always, Reopen only Settled, Reject unless Rejected. */
function allowedResolutions(decision: { state: DecisionState }): [Resolution, string][] {
  const allowed: [Resolution, string][] = [["keep", "Keep"]];
  if (decision.state === "settled") allowed.push(["reopen", "Reopen"]);
  if (decision.state !== "rejected") allowed.push(["reject", "Reject"]);
  return allowed;
}

function resolutions(
  decision: { state: DecisionState },
  post: (resolution: Resolution, reason: string | undefined) => Promise<unknown>,
): Action[] {
  return allowedResolutions(decision).map(([resolution, label]) => ({
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

export type Review =
  | { kind: "flag"; flag: Flag; decision: DecisionSummary }
  | { kind: "conflict"; conflict: Conflict; decision: DecisionSummary };

/** Every open flag, then every open Conflict, of the Decisions. */
export function openReviews(decisions: readonly DecisionSummary[]): Review[] {
  return [
    ...decisions.flatMap((decision) =>
      decision.openFlags.map((flag): Review => ({ kind: "flag", flag, decision })),
    ),
    ...decisions.flatMap((decision) =>
      decision.openConflicts.map((conflict): Review => ({ kind: "conflict", conflict, decision })),
    ),
  ];
}

/** The open Flags and Conflicts, each as a question. */
export function ReviewList({ home, reviews }: { home: string; reviews: readonly Review[] }) {
  return (
    <ul className={flagStyles.reviews}>
      {reviews.map((review) =>
        review.kind === "flag" ? (
          <FlagQuestion
            key={review.flag.slug}
            home={home}
            flag={review.flag}
            decision={review.decision}
          />
        ) : (
          <ConflictQuestion
            key={review.conflict.slug}
            home={home}
            conflict={review.conflict}
            decision={review.decision}
          />
        ),
      )}
    </ul>
  );
}

function FlagQuestion({
  home,
  flag,
  decision,
}: {
  home: string;
  flag: Flag;
  decision: DecisionSummary;
}) {
  const prompt = buildPrompt({
    skill: SKILL_OF_KIND[decision.kind],
    text:
      `${decision.title} was flagged because ${flag.source.name}${flagCauseText(flag)}. ` +
      "Help me decide whether to keep it, reopen it, or reject it.",
    slug: decision.slug,
  });
  return (
    <li className={flagStyles.review}>
      <p className={flagStyles.question}>
        <FlagDot /> Something under <DecisionName home={home} decision={decision} /> changed:{" "}
        <FlagCause home={home} flag={flag} />. Is <em>{decision.title}</em> still right?
      </p>
      <ReviewMeta decision={decision} raisedAt={flag.raisedAt} />
      <AskAgent label="Talk it through" prompt={prompt} />
      <DecideHere
        home={home}
        decision={decision}
        actions={flagActions(home, decision, flag.slug)}
      />
    </li>
  );
}

function ConflictQuestion({
  home,
  conflict,
  decision,
}: {
  home: string;
  conflict: Conflict;
  decision: DecisionSummary;
}) {
  const prompt = buildPrompt({
    skill: SKILL_OF_KIND[decision.kind],
    text:
      `${decision.title} has a Conflict: ${conflict.description} ` +
      "Help me decide whether to keep it, reopen it, or reject it.",
    slug: decision.slug,
  });
  return (
    <li className={flagStyles.review}>
      <p className={flagStyles.question}>
        <FlagDot /> Something new goes against <DecisionName home={home} decision={decision} />:{" "}
        {conflict.description} Does <em>{decision.title}</em> still hold?
      </p>
      <ReviewMeta decision={decision} raisedAt={conflict.raisedAt} conflict />
      <AskAgent label="Talk it through" prompt={prompt} />
      <DecideHere
        home={home}
        decision={decision}
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
  );
}

/** "Conflict · Room Direction · ◐ Leaning · raised 14 Sep". */
function ReviewMeta({
  decision,
  raisedAt,
  conflict = false,
}: {
  decision: DecisionSummary;
  raisedAt: string;
  conflict?: boolean;
}) {
  return (
    <p className={flagStyles.meta}>
      {conflict ? "Conflict" : "Flag"} · {KIND_LABEL[decision.kind]} ·{" "}
      <span className={flagStyles.state}>
        <StateMark state={decision.state} />
        {STATE_LABEL[decision.state]}
      </span>{" "}
      · raised {shortDate(raisedAt) ?? raisedAt}
    </p>
  );
}

/** Keep, Reopen, and Reject, each with what it does, behind a disclosure. */
function DecideHere({
  home,
  decision,
  actions,
}: {
  home: string;
  decision: DecisionSummary;
  actions: Action[];
}) {
  return (
    <details className={flagStyles.decide}>
      <summary>Decide here instead</summary>
      <ul className={flagStyles.effects}>
        {allowedResolutions(decision).map(([resolution]) => (
          <li key={resolution}>{RESOLUTION_EFFECT[resolution]}</li>
        ))}
      </ul>
      <Actions home={home} actions={actions} />
    </details>
  );
}

function DecisionName({ home, decision }: { home: string; decision: DecisionSummary }) {
  return <Link to={decisionPath(home, decision.slug)}>{decision.title}</Link>;
}
