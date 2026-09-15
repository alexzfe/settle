// Decisions in words: their kinds and states as the pages name them, the state changes the server
// allows from each state (core's LEGAL_TRANSITIONS), and the pages' paths. The web bundle takes
// only types from @idh/core, so the lists are spelled out here, typed against core's.

import type {
  DecisionKind,
  DecisionState,
  DecisionSummary,
  Flag,
  FlagCause,
  Requirement,
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

/**
 * The page showing the record a Requirement's reason points at: a Decision's page; the Room's page
 * for a Room or any part of it; the Items list for an Item; the Home page for the Home, a
 * Constraint, or a Note. A Wall or Surface names its Room before a slash ("living-room/wall-2"),
 * but a Window, Door, or Feature only starts with it ("living-room-window-2"), so it is found
 * among the Home's `rooms`, the longest slug that starts it; undefined when none does.
 */
export function reasonPath(
  home: string,
  reason: Requirement["reason"],
  rooms: readonly { slug: string }[] = [],
): string | undefined {
  const homePath = `/homes/${home}`;
  const roomPath = (room: string) => `${homePath}/rooms/${room}`;
  switch (reason.kind) {
    case "decision":
      return decisionPath(home, reason.id);
    case "home":
    case "constraint":
    case "note":
      return homePath;
    case "item":
      return `${homePath}/items`;
    case "room":
      return roomPath(reason.id);
    case "wall":
    case "surface":
      return roomPath(reason.id.split("/")[0] ?? reason.id);
    case "window":
    case "door":
    case "feature": {
      const [room] = rooms
        .map((each) => each.slug)
        .filter((slug) => reason.id.startsWith(`${slug}-`))
        .toSorted((a, b) => b.length - a.length);
      return room === undefined ? undefined : roomPath(room);
    }
  }
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
