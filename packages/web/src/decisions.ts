// Decisions in words: their kinds and states as the pages name them, the state changes the server
// allows from each state (core's LEGAL_TRANSITIONS), and the pages' paths. The web bundle takes
// only types from @settle/core, so the lists are spelled out here, typed against core's.

import type {
  DecisionKind,
  DecisionState,
  DecisionSummary,
  Flag,
  FlagCause,
  Requirement,
  Resolution,
} from "./api";
import { words } from "./format";

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
  /** What the change does, in one line beside the button. */
  consequence: string;
}

const FLAGS_DEPENDENTS = "Every Decision resting on it is flagged for review.";

/** The legal state changes from each state, as their buttons name them. The server refuses others. */
export const MOVES: Record<DecisionState, readonly Move[]> = {
  candidate: [
    {
      to: "leaning",
      label: "Move to Leaning",
      consequence: "Say you favour it, still uncommitted.",
    },
    { to: "locked", label: "Lock", consequence: "Commit to it; other Decisions can rest on it." },
    { to: "rejected", label: "Reject", consequence: `Set it aside. ${FLAGS_DEPENDENTS}` },
  ],
  leaning: [
    { to: "candidate", label: "Move to Candidate", consequence: "Back to under consideration." },
    { to: "locked", label: "Lock", consequence: "Commit to it; other Decisions can rest on it." },
    { to: "rejected", label: "Reject", consequence: `Set it aside. ${FLAGS_DEPENDENTS}` },
  ],
  locked: [
    { to: "leaning", label: "Reopen", consequence: `Back to Leaning. ${FLAGS_DEPENDENTS}` },
    { to: "rejected", label: "Reject", consequence: `Set it aside. ${FLAGS_DEPENDENTS}` },
  ],
  rejected: [{ to: "candidate", label: "Revive", consequence: "Bring it back as a Candidate." }],
};

export function decisionPath(home: string, decision: string): string {
  return `/homes/${home}/decisions/${decision}`;
}

/**
 * The page showing a record, by its kind (a Requirement reason's kinds) and slug: a Decision's
 * page; the Room's page for a Room or any part of it; the Items list for an Item; the Home page
 * for the Home, a Constraint, or a Note. A Wall or Surface names its Room before a slash
 * ("living-room/wall-2"), but a Window, Door, or Feature only starts with it
 * ("living-room-window-2"), so it is found among the Home's `rooms`, the longest slug that starts
 * it. Undefined when no page shows it, or for a kind the pages do not know.
 */
export function recordPath(
  home: string,
  kind: string,
  slug: string,
  rooms: readonly { slug: string }[] = [],
): string | undefined {
  const homePath = `/homes/${home}`;
  const roomPath = (room: string) => `${homePath}/rooms/${room}`;
  switch (kind) {
    case "decision":
      return decisionPath(home, slug);
    case "home":
    case "constraint":
    case "note":
      return `${homePath}/about`;
    case "item":
      return `${homePath}/items`;
    case "room":
      return roomPath(slug);
    case "wall":
    case "surface":
      return roomPath(slug.split("/")[0] ?? slug);
    case "window":
    case "door":
    case "feature": {
      const [room] = rooms
        .map((each) => each.slug)
        .filter((each) => slug.startsWith(`${each}-`))
        .toSorted((a, b) => b.length - a.length);
      return room === undefined ? undefined : roomPath(room);
    }
    default:
      return undefined;
  }
}

/** The page showing the record a Requirement's reason points at. */
export function reasonPath(
  home: string,
  reason: Requirement["reason"],
  rooms?: readonly { slug: string }[],
): string | undefined {
  return recordPath(home, reason.kind, reason.id, rooms);
}

/** How a cleared flag or resolved Conflict was settled. */
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  keep: "kept",
  reopen: "reopened",
  reject: "rejected",
};

const CAUSE: Record<FlagCause, string> = {
  reopened: " was reopened",
  rejected: " was rejected",
  deviation: " was Fulfilled with a Deviation from a must Requirement",
  value_changed: " changed",
};

/**
 * Why a Decision was flagged, in the words after its source's name: " was reopened"; for a changed
 * value, the field that changed when the Requirement's reason names one: "'s length changed".
 */
export function flagCauseText(flag: Flag): string {
  const { field } = flag.source;
  if (flag.cause === "value_changed" && field) return `'s ${words(field)} changed`;
  return CAUSE[flag.cause];
}

/** A flag's cause in one phrase, its source named: "Wall 5's length changed". */
export function flagSummary(flag: Flag): string {
  return `${flag.source.name}${flagCauseText(flag)}`;
}

/** The Skill that settles each kind of Decision, for a prompt back to the Agent. */
export const KIND_SKILL: Record<DecisionKind, string | undefined> = {
  "design-direction": "Design Direction",
  "room-direction": "Design Direction",
  "room-use": "Design Direction",
  palette: "Color",
  "room-color": "Color",
  purchase: "Purchase",
  other: undefined,
};

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
