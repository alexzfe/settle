// Decisions in words: their kinds and states as the pages name them, the state changes the server
// allows from each state (core's LEGAL_TRANSITIONS), and the pages' paths. The web bundle takes
// only types from @idh/core, so the lists are spelled out here, typed against core's.

import type {
  DecisionKind,
  DecisionState,
  DecisionSummary,
  Flag,
  FlagCause,
  Resolution,
} from "./api";

export const KIND_LABEL: Record<DecisionKind, string> = {
  "design-direction": "Design Direction",
  "room-direction": "Room Direction",
  "room-use": "Room use",
  palette: "Palette",
  "room-color": "Room color",
  purchase: "Purchase",
  other: "Other",
};

export const STATE_LABEL: Record<DecisionState, string> = {
  candidate: "Candidate",
  leaning: "Leaning",
  locked: "Locked",
  rejected: "Rejected",
};

export const DECISION_KINDS = Object.keys(KIND_LABEL) as DecisionKind[];
export const DECISION_STATES = Object.keys(STATE_LABEL) as DecisionState[];

export interface Move {
  to: DecisionState;
  /** The button's label. */
  label: string;
}

/** The legal state changes from each state, as their buttons name them. The server refuses others. */
export const MOVES: Record<DecisionState, readonly Move[]> = {
  candidate: [
    { to: "leaning", label: "Move to Leaning" },
    { to: "locked", label: "Lock" },
    { to: "rejected", label: "Reject" },
  ],
  leaning: [
    { to: "candidate", label: "Move to Candidate" },
    { to: "locked", label: "Lock" },
    { to: "rejected", label: "Reject" },
  ],
  locked: [
    { to: "leaning", label: "Reopen" },
    { to: "rejected", label: "Reject" },
  ],
  rejected: [{ to: "candidate", label: "Revive" }],
};

export function decisionPath(home: string, decision: string): string {
  return `/homes/${home}/decisions/${decision}`;
}

/** How a cleared flag or resolved Conflict was settled. */
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  keep: "kept",
  reopen: "reopened",
  reject: "rejected",
};

const CAUSE: Record<FlagCause, string> = {
  reopened: "was reopened",
  rejected: "was rejected",
  deviation: "was Fulfilled with a Deviation from a must Requirement",
  value_changed: "changed",
};

/** Why a Decision was flagged: "Warm minimalism was reopened". */
export function flagCause(flag: Flag): string {
  return `${flag.source.name} ${CAUSE[flag.cause]}`;
}

/**
 * Why an automatic Basis entry is there: the Design Direction is under every Decision, and the
 * Palette under every Decision that uses one of its colors.
 */
export function automaticBasisNote(kind: DecisionKind): string {
  switch (kind) {
    case "design-direction":
      return "in every Basis";
    case "palette":
      return "in every Basis using its colors";
    default:
      return "automatic";
  }
}

/**
 * The Palette in force, as core picks it: the Locked one, else the latest Leaning one. The list is
 * in the order the Decisions were created, so the latest is the last.
 */
export function paletteInForce(decisions: readonly DecisionSummary[]): DecisionSummary | undefined {
  const palettes = decisions.filter((decision) => decision.kind === "palette");
  return (
    palettes.find((decision) => decision.state === "locked") ??
    palettes.filter((decision) => decision.state === "leaning").at(-1)
  );
}
