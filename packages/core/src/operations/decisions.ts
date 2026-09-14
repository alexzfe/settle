import type { z } from "zod";
import { CoreError } from "../errors.js";
import { optional } from "../optional.js";
import { equal } from "../provenance.js";
import { type Change, defineOperation, type OperationContext } from "../registry.js";
import {
  featureName,
  type HomeDecisionsView,
  DECISION_KIND_LABELS as KINDS,
  named,
  type OpeningView,
  renderDecision,
  renderDecisions,
  DECISION_STATE_LABELS as STATES,
  titled,
} from "../render.js";
import { uniqueSlug } from "../slug.js";
import type {
  ConflictRow,
  DecisionBasisRow,
  DecisionEvidenceRow,
  DecisionRow,
  FlagRow,
  HomeRow,
  NoteRow,
  RequirementRow,
  RoomRow,
  SessionRow,
  StateChangeRow,
  Store,
} from "../store.js";
import { active, requireRoom } from "./lookup.js";
import { type HomeModel, loadHome, overviewView, roomById, roomDetail } from "./model.js";
import {
  DECISION_CONTENT,
  DECISION_KIND_SCOPES,
  type DecisionDetail,
  type DecisionKind,
  type DecisionKindContent,
  type DecisionReceiptResult,
  type DecisionState,
  type DecisionSummary,
  type EvidenceEntry,
  type EvidenceKind,
  type evidenceInput,
  type FindDecisionsResult,
  type Flag,
  type FlagCause,
  findDecisionsInput,
  flagConflictInput,
  type GetDecisionResult,
  getDecisionInput,
  getDecisionWebInput,
  LEGAL_TRANSITIONS,
  type ListDecisionsResult,
  listDecisionsInput,
  type ReceiptResult,
  type Requirement,
  type RequirementReasonKind,
  type Resolution,
  type RoomUseContent,
  recordFulfilmentInput,
  type requirementInput,
  type requirementReasonInput,
  resolveConflictInput,
  resolveFlagInput,
  type Stance,
  type Strength,
  saveDecisionInput,
  setDecisionStateInput,
  setDecisionStateWebInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { sameName, Writer } from "./writer.js";

type SaveDecision = z.output<typeof saveDecisionInput>;
type EvidenceIn = z.output<typeof evidenceInput>;
type RequirementIn = z.output<typeof requirementInput>;
type ReasonIn = z.output<typeof requirementReasonInput>;

// ─── The operations ─────────────────────────────────────────────────────────────────────────

export const saveDecision = defineOperation({
  name: "save_decision",
  description:
    "Creates or changes one Decision of this Home and returns a receipt. A Decision is a choice " +
    "about the whole Home or one Room, always in one state: candidate (under consideration), " +
    "leaning (favoured), locked (committed), or rejected. A new one starts as a Candidate; " +
    "change its state only with set_decision_state. Its kind says what the app does with it: " +
    "design-direction (the Home's style, Home-wide; it names no colors), room-direction (how " +
    "one Room refines it), room-use (what one Room is for; its functions change when Fulfilled), " +
    "palette (the Home's named colors), room-color (a Surface's color from the Palette), " +
    "purchase (with Requirements), or other. content holds the kind's own fields; each field " +
    "says which kinds take it. Pass `decision` (its slug) to change one: title and statement are " +
    "always given, content replaces what is recorded, basis replaces the Basis, and evidence " +
    "entries are added. A Locked or Rejected Decision takes new Evidence only: to change it, " +
    "Reopen or revive it first, with the user's yes. Basis: the Decisions it rests on (the " +
    "Design Direction is in every Basis automatically); Evidence: the Notes, Sessions, or " +
    "Decisions that support or undermine it. Every Basis and Evidence entry must exist in this " +
    "Home. Needs the open Session's id as `session`.",
  input: saveDecisionInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const receipt = context.write(session.slug, (log) => {
      const { writer, writes } = begin(context, home, log, session);
      writes.save(input as SaveDecision);
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

export const setDecisionState = defineOperation({
  name: "set_decision_state",
  description:
    "Moves one Decision to another state and returns a receipt, including every Decision the " +
    "move flagged. Only these moves: candidate to leaning, locked, or rejected; leaning to " +
    "candidate, locked, or rejected; locked to leaning (a Reopen) or rejected; rejected to " +
    "candidate (a revival). Lock only when the user clearly commits. Before a Reopen, rejecting " +
    "a Locked Decision, or reviving a Rejected one, ask the user and wait for a yes. `reason` is " +
    "required: why, quoting the user's words when they gave permission. A Reopen or Reject " +
    "flags, but never changes, every Decision resting on this one; each flag stays until the " +
    "user keeps, Reopens, or Rejects that Decision, which also clears its own flags and " +
    "Conflicts. To keep a flagged Decision as it is, pass its current state as `to`, quoting " +
    "the user. Then say plainly what changed, e.g. \"Locked: Design Direction 'Warm " +
    "minimalism'\". Needs the open Session's id as `session`.",
  input: setDecisionStateInput,
  webInput: setDecisionStateWebInput,
  readOnly: false,
  surface: "both",
  handler(context, input): DecisionReceiptResult {
    const home = requireHome(context);
    const session =
      context.caller.kind === "session" ? requireSession(context, home, { open: true }) : undefined;
    const reason = input.reason?.trim() || undefined;
    if (session && !reason) {
      throw new CoreError(
        "reason_required",
        "A state change from a Session needs a reason: why, in a sentence, quoting the user's " +
          'words when they gave permission (The user: "yes, lock it"). Call again with `reason`.',
      );
    }
    return context.write(session?.slug ?? "web", (log) => {
      const { model, writer, writes } = begin(context, home, log, session);
      const decision = requireDecision(model, input.decision);
      writes.move(decision, input.to, reason);
      return { receipt: writer.receipt(), decision: toSummary(model, decision) };
    });
  },
  text: ({ receipt }) => receipt,
});

export const findDecisions = defineOperation({
  name: "find_decisions",
  description:
    "Lists this Home's Decisions, one line each: title and slug, kind, state (and when it was " +
    "Fulfilled), the Room it is about or Home-wide, its open flags and Conflicts, and its " +
    "one-line statement. Covers every state, Rejected and Fulfilled ones included, which the " +
    "opening and Room Sheets leave out. Filter by room (a Room's slug) or homeWide, by kind, " +
    "and by state. Before proposing a Decision, look up the Rejected ones in its scope and never " +
    "propose one of them again. get_decision gives one Decision in full. Changes nothing.",
  input: findDecisionsInput,
  readOnly: true,
  surface: "agent",
  handler(context, input): FindDecisionsResult {
    const home = requireHome(context);
    requireSession(context, home, { open: false });
    if (input.room !== undefined && input.homeWide) {
      throw new CoreError("validation", "Give room or homeWide, not both.");
    }
    return { decisions: filterDecisions(loadDecisions(context.store, home), input) };
  },
  text: ({ decisions }) => renderDecisions(decisions),
});

export const getDecision = defineOperation({
  name: "get_decision",
  description:
    "Returns one Decision of this Home in full: its kind, scope, state, statement, the kind's " +
    "content, its Requirements, its open flags and Conflicts, then one line per Decision of its " +
    "Basis and per piece of Evidence. The opening, Room Sheets, and find_decisions give only " +
    "one line per Decision (except the Design Direction and Palette, which the opening gives in " +
    "full): fetch this when the work turns to a Decision, for example before changing it or " +
    "resolving its flag. Changes nothing.",
  input: getDecisionInput,
  webInput: getDecisionWebInput,
  readOnly: true,
  surface: "both",
  handler(context, input): GetDecisionResult {
    const home = requireHome(context);
    if (context.caller.kind === "session") requireSession(context, home, { open: false });
    const model = loadDecisions(context.store, home);
    return { decision: toDetail(model, requireDecision(model, input.decision)) };
  },
  text: ({ decision }) => renderDecision(decision),
});

export const flagConflict = defineOperation({
  name: "flag_conflict",
  description:
    "Raises a Conflict: something new (what the user now says, shows, or wants) contradicts a " +
    "Locked Decision of this Home. Only a Locked Decision can have a Conflict; for one still " +
    "open, add the Evidence with save_decision (stance undermines) instead. Raising it changes " +
    "nothing else: the Decision stays Locked, and only the user resolves the Conflict, by " +
    "keeping, Reopening, or Rejecting the Decision (with set_decision_state once they say which, " +
    "or in the app). Describe the contradiction in a sentence or two, then tell the user. Needs " +
    "the open Session's id as `session`.",
  input: flagConflictInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const receipt = context.write(session.slug, (log) => {
      const { model, writer } = begin(context, home, log, session);
      const decision = requireDecision(model, input.decision);
      if (decision.state !== "locked") {
        throw new CoreError(
          "not_locked",
          `${titled(decision)} is ${STATES[decision.state]}, not Locked: a Conflict is raised only ` +
            "against a Locked Decision. For one still open, add the new Evidence with " +
            "save_decision (stance undermines) instead.",
        );
      }
      const number = model.conflicts.filter((each) => each.decisionId === decision.id).length + 1;
      const conflict = writer.create(
        "conflicts",
        "conflict",
        {
          homeId: home.id,
          decisionId: decision.id,
          slug: `${decision.slug}/conflict-${number}`,
          sessionId: session.id,
          description: input.description,
          raisedAt: context.now(),
          resolvedAt: null,
          resolution: null,
          reason: null,
        },
        { decision: decision.slug, description: input.description },
      );
      writer.line(
        titled(decision),
        `Conflict raised (${conflict.slug}); it stays Locked until the user keeps, Reopens, or ` +
          `Rejects it: ${input.description}`,
      );
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

export const recordFulfilment = defineOperation({
  name: "record_fulfilment",
  description:
    "Records that a Locked Decision's action was carried out, which makes it Fulfilled (not a " +
    "state: it stays Locked), and changes the Home to match what was actually done. For now it " +
    "takes Room use Decisions only: it sets the Room's functions to the Decision's, or to " +
    "roomFunctions when what the user actually did differs. Fulfilled Decisions drop out of the " +
    "Room Sheet and the opening, since the Home now records the result; find_decisions still " +
    "lists them. Call it when the user says the change is made, and tell them what changed. " +
    "Needs the open Session's id as `session`.",
  input: recordFulfilmentInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const receipt = context.write(session.slug, (log) => {
      const { model, writer } = begin(context, home, log, session);
      const decision = requireDecision(model, input.decision);
      const subject = titled(decision);
      if (decision.kind !== "room-use" || decision.scopeRoomId === null) {
        throw new CoreError(
          "validation",
          `record_fulfilment takes Room use Decisions for now, and ${subject} is a ` +
            `${KINDS[decision.kind]}. Room colors arrive with the Color Skill, purchases with ` +
            "the Purchase Skill.",
        );
      }
      if (decision.state !== "locked") {
        throw new CoreError(
          "not_locked",
          `${subject} is ${STATES[decision.state]}, not Locked: only a Locked Decision is ` +
            "Fulfilled. Lock it first, once the user commits.",
        );
      }
      if (decision.fulfilledAt !== null) {
        throw new CoreError(
          "validation",
          `${subject} was already Fulfilled on ${day(decision.fulfilledAt)}.`,
        );
      }
      const room = roomById(model, decision.scopeRoomId);
      const decided = (decision.content as RoomUseContent).functions;
      const functions = input.roomFunctions ?? decided;
      const at = context.now();
      context.store.update("decisions", decision.id, {
        fulfilledAt: at,
        fulfilment: { roomFunctions: functions },
      });
      writer.logged({ recordKind: "decision", record: decision, field: "fulfilledAt", new: at });
      writer.line(
        subject,
        equal(functions, decided)
          ? "Fulfilled"
          : `Fulfilled, differently from what was decided (${decided.join(", ")})`,
      );
      const fields = writer.patch("rooms", "room", room, named(room), { functions });
      writer.line(
        named(room),
        fields.length > 0 ? undefined : `functions already ${functions.join(", ")}`,
        fields,
      );
      const after = loadHome(context.store, home);
      const detail = roomDetail(after, roomById(after, room.id));
      return writer.receipt(room.archivedAt ? [] : [{ room: detail, gaps: detail.gaps }]);
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

export const listDecisions = defineOperation({
  name: "list_decisions",
  description:
    "The Home's Decisions, Home-wide ones first and then each Room's, with their open flags and " +
    "Conflicts; filtered by Room, kind, and state.",
  input: listDecisionsInput,
  readOnly: true,
  surface: "web",
  handler(context, input): ListDecisionsResult {
    return {
      decisions: filterDecisions(loadDecisions(context.store, requireHome(context)), input),
    };
  },
});

export const resolveFlag = defineOperation({
  name: "resolve_flag",
  description:
    "Clears a flag by keeping, Reopening, or Rejecting the flagged Decision. Reopen and Reject " +
    "follow the transitions table and flag the Decisions resting on it in turn.",
  input: resolveFlagInput,
  readOnly: false,
  surface: "web",
  handler(context, input): DecisionReceiptResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const { model, writer, writes } = begin(context, home, log, undefined);
      const flag = model.flags.find((each) => each.slug === input.flag);
      if (!flag) throw new CoreError("not_found", `This Home has no flag "${input.flag}".`);
      if (flag.clearedAt !== null) {
        throw new CoreError(
          "validation",
          `${flag.slug} was already cleared (${flag.resolution}) on ${day(flag.clearedAt)}.`,
        );
      }
      writes.resolve({ flag }, input.resolution, input.reason || undefined);
      return {
        receipt: writer.receipt(),
        decision: toSummary(model, decisionById(model, flag.decisionId)),
      };
    });
  },
});

export const resolveConflict = defineOperation({
  name: "resolve_conflict",
  description:
    "Resolves a Conflict by keeping, Reopening, or Rejecting its Decision. Reopen and Reject " +
    "follow the transitions table and flag the Decisions resting on it.",
  input: resolveConflictInput,
  readOnly: false,
  surface: "web",
  handler(context, input): DecisionReceiptResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const { model, writer, writes } = begin(context, home, log, undefined);
      const conflict = model.conflicts.find((each) => each.slug === input.conflict);
      if (!conflict) {
        throw new CoreError("not_found", `This Home has no Conflict "${input.conflict}".`);
      }
      if (conflict.resolvedAt !== null) {
        throw new CoreError(
          "validation",
          `${conflict.slug} was already resolved (${conflict.resolution}) on ` +
            `${day(conflict.resolvedAt)}.`,
        );
      }
      writes.resolve({ conflict }, input.resolution, input.reason || undefined);
      return {
        receipt: writer.receipt(),
        decision: toSummary(model, decisionById(model, conflict.decisionId)),
      };
    });
  },
});

function begin(
  context: OperationContext,
  home: HomeRow,
  log: (change: Change) => void,
  session: SessionRow | undefined,
) {
  const model = loadDecisions(context.store, home);
  const writer = new Writer(context.store, home, log, undefined);
  return { model, writer, writes: new DecisionWrites(context, model, writer, session) };
}

// ─── The Decision model ─────────────────────────────────────────────────────────────────────

/** Every row of one Home, with its Decisions and what they refer to. */
export interface DecisionModel extends HomeModel {
  notes: NoteRow[];
  sessions: SessionRow[];
  decisions: DecisionRow[];
  basis: DecisionBasisRow[];
  evidence: DecisionEvidenceRow[];
  requirements: RequirementRow[];
  flags: FlagRow[];
  conflicts: ConflictRow[];
  stateChanges: StateChangeRow[];
}

export function loadDecisions(store: Store, home: HomeRow): DecisionModel {
  return {
    ...loadHome(store, home),
    notes: store.list("notes", home.id),
    sessions: store.sessions(home.id),
    decisions: store.list("decisions", home.id),
    basis: store.list("decision_basis", home.id),
    evidence: store.list("decision_evidence", home.id),
    requirements: store.list("requirements", home.id),
    flags: store.list("flags", home.id),
    conflicts: store.list("conflicts", home.id),
    stateChanges: store.list("state_changes", home.id),
  };
}

/** A Decision of the Home, not Archived, by slug. */
export function requireDecision(model: DecisionModel, slug: string): DecisionRow {
  const decision = model.decisions.find((each) => each.slug === slug && active(each));
  if (decision) return decision;
  throw new CoreError(
    "not_found",
    `This Home has no Decision "${slug}". find_decisions lists its Decisions with their slugs.`,
  );
}

function decisionById(model: DecisionModel, id: number): DecisionRow {
  const decision = model.decisions.find((each) => each.id === id);
  if (!decision) throw new Error(`Decision ${id} is not in Home ${model.home.slug}`);
  return decision;
}

/** The Design Direction or Palette in force: the Locked one, else the latest Leaning one. */
function inForce(model: DecisionModel, kind: "design-direction" | "palette") {
  const rows = model.decisions.filter((each) => active(each) && each.kind === kind);
  return (
    rows.find((each) => each.state === "locked") ??
    rows.filter((each) => each.state === "leaning").at(-1)
  );
}

/**
 * A Decision's Basis: the Design Direction in force first, for every Decision but a Design
 * Direction, then the Decisions given, without the Design Direction a second time.
 */
function basisOf(model: DecisionModel, decision: DecisionRow) {
  const direction =
    decision.kind === "design-direction" ? undefined : inForce(model, "design-direction");
  const given = model.basis
    .filter((link) => link.decisionId === decision.id)
    .map((link) => decisionById(model, link.basisDecisionId))
    .filter((row) => row.id !== direction?.id);
  return [
    ...(direction ? [{ row: direction, automatic: true }] : []),
    ...given.map((row) => ({ row, automatic: false })),
  ];
}

const openFlags = (model: DecisionModel, decision: DecisionRow) =>
  model.flags.filter((flag) => flag.decisionId === decision.id && flag.clearedAt === null);

const openConflicts = (model: DecisionModel, decision: DecisionRow) =>
  model.conflicts.filter(
    (conflict) => conflict.decisionId === decision.id && conflict.resolvedAt === null,
  );

/** Home-wide Decisions first, then each Room's in the Rooms' order, each in creation order. */
function sorted(model: DecisionModel, rows: DecisionRow[]): DecisionRow[] {
  const order = new Map(model.rooms.map((room, index) => [room.id, index + 1]));
  const place = (decision: DecisionRow) =>
    decision.scopeRoomId === null ? 0 : (order.get(decision.scopeRoomId) ?? model.rooms.length + 1);
  return [...rows].sort((a, b) => place(a) - place(b) || a.id - b.id);
}

function filterDecisions(
  model: DecisionModel,
  filter: { room?: string; homeWide?: boolean; kind?: DecisionKind; state?: DecisionState },
): DecisionSummary[] {
  const room =
    filter.room === undefined ? undefined : requireRoom(model, filter.room, { archived: true });
  const rows = model.decisions.filter(
    (each) =>
      active(each) &&
      (room === undefined || each.scopeRoomId === room.id) &&
      (!filter.homeWide || each.scopeRoomId === null) &&
      (filter.kind === undefined || each.kind === filter.kind) &&
      (filter.state === undefined || each.state === filter.state),
  );
  return sorted(model, rows).map((each) => toSummary(model, each));
}

/** The Room Sheet's Decisions: the Room's Candidate, Leaning, and Locked-not-Fulfilled ones. */
export function roomDecisions(model: DecisionModel, room: RoomRow): DecisionSummary[] {
  return model.decisions
    .filter(
      (each) =>
        active(each) &&
        each.scopeRoomId === room.id &&
        each.state !== "rejected" &&
        each.fulfilledAt === null,
    )
    .map((each) => toSummary(model, each));
}

/** The opening: the Home Overview, the Home-wide Decisions in force, and what is flagged. */
export function openingView(store: Store, home: HomeRow): OpeningView {
  const model = loadDecisions(store, home);
  const flagged = model.decisions.filter(
    (each) =>
      active(each) && (openFlags(model, each).length > 0 || openConflicts(model, each).length > 0),
  );
  return {
    overview: overviewView(model),
    decisions: homeDecisionsView(model),
    flagged: sorted(model, flagged).map((each) => toSummary(model, each)),
  };
}

function homeDecisionsView(model: DecisionModel): HomeDecisionsView {
  const candidates = (kind: DecisionKind) =>
    model.decisions.filter(
      (each) => active(each) && each.kind === kind && each.state === "candidate",
    ).length;
  const direction = inForce(model, "design-direction");
  const palette = inForce(model, "palette");
  const others = model.decisions.filter(
    (each) =>
      active(each) &&
      each.scopeRoomId === null &&
      each.state === "locked" &&
      each.fulfilledAt === null &&
      each.kind !== "design-direction" &&
      each.kind !== "palette",
  );
  return {
    ...optional({
      designDirection: direction && toDetail(model, direction),
      palette: palette && toDetail(model, palette),
    }),
    designDirectionCandidates: candidates("design-direction"),
    paletteCandidates: candidates("palette"),
    others: sorted(model, others).map((each) => toSummary(model, each)),
  };
}

// ─── Records, as results carry them ─────────────────────────────────────────────────────────

export function toSummary(model: DecisionModel, row: DecisionRow): DecisionSummary {
  const room = row.scopeRoomId === null ? undefined : roomById(model, row.scopeRoomId);
  return {
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    statement: row.statement,
    state: row.state,
    ...optional({
      room: room && { slug: room.slug, name: room.name },
      fulfilledAt: row.fulfilledAt,
    }),
    createdAt: row.createdAt,
    openFlags: openFlags(model, row).map((flag) => toFlag(model, flag)),
    openConflicts: openConflicts(model, row).map((conflict) => toConflict(model, conflict)),
  };
}

function toDetail(model: DecisionModel, row: DecisionRow): DecisionDetail {
  const { kind: _, ...summary } = toSummary(model, row);
  const content = { kind: row.kind, content: row.content } as DecisionKindContent;
  return {
    ...summary,
    ...optional({ fulfilment: row.fulfilment }),
    basis: basisOf(model, row).map(({ row: entry, automatic }) => ({
      slug: entry.slug,
      title: entry.title,
      kind: entry.kind,
      state: entry.state,
      ...optional({ fulfilledAt: entry.fulfilledAt }),
      automatic,
    })),
    evidence: model.evidence
      .filter((each) => each.decisionId === row.id)
      .map((each) => toEvidence(model, each)),
    requirements: model.requirements
      .filter((each) => each.decisionId === row.id && each.archivedAt === null)
      .sort((a, b) => a.position - b.position)
      .map((each) => toRequirement(model, each)),
    flags: model.flags
      .filter((each) => each.decisionId === row.id)
      .map((each) => toFlag(model, each)),
    conflicts: model.conflicts
      .filter((each) => each.decisionId === row.id)
      .map((each) => toConflict(model, each)),
    stateChanges: model.stateChanges
      .filter((each) => each.decisionId === row.id)
      .map((each) => ({
        from: each.fromState,
        to: each.toState,
        origin: each.origin,
        ...optional({ reason: each.reason }),
        at: each.at,
      })),
    ...content,
  };
}

function toFlag(model: DecisionModel, row: FlagRow): Flag {
  const decision = decisionById(model, row.decisionId);
  const source = row.sourceKind === "decision" ? decisionById(model, row.sourceId) : undefined;
  return {
    slug: row.slug,
    decision: { slug: decision.slug, title: decision.title },
    cause: row.cause,
    source: source
      ? { kind: "decision", slug: source.slug, name: source.title }
      : { kind: row.sourceKind, slug: String(row.sourceId), name: row.sourceKind },
    raisedAt: row.raisedAt,
    ...optional({ clearedAt: row.clearedAt, resolution: row.resolution, reason: row.reason }),
  };
}

function toConflict(model: DecisionModel, row: ConflictRow) {
  const decision = decisionById(model, row.decisionId);
  const session = model.sessions.find((each) => each.id === row.sessionId);
  return {
    slug: row.slug,
    decision: { slug: decision.slug, title: decision.title },
    description: row.description,
    raisedAt: row.raisedAt,
    ...optional({
      session: session?.slug,
      resolvedAt: row.resolvedAt,
      resolution: row.resolution,
      reason: row.reason,
    }),
  };
}

function toEvidence(model: DecisionModel, row: DecisionEvidenceRow): EvidenceEntry {
  const source = evidenceSource(model, row.sourceKind, row.sourceId);
  return {
    kind: row.sourceKind,
    id: source.slug,
    name: source.name,
    stance: row.stance,
    ...optional({ note: row.note }),
  };
}

function evidenceSource(
  model: DecisionModel,
  kind: EvidenceKind,
  id: number,
): { slug: string; name: string } {
  if (kind === "note") {
    const note = model.notes.find((each) => each.id === id);
    return { slug: note?.slug ?? "?", name: note?.text ?? "?" };
  }
  if (kind === "session") {
    const session = model.sessions.find((each) => each.id === id);
    return session
      ? { slug: session.slug, name: `${day(session.openedAt)}, ${session.skills.join(", ")}` }
      : { slug: "?", name: "?" };
  }
  const decision = decisionById(model, id);
  return { slug: decision.slug, name: decision.title };
}

function toRequirement(model: DecisionModel, row: RequirementRow): Requirement {
  const record = reasonRecords(model, row.reasonKind).find((each) => each.id === row.reasonId);
  return {
    position: row.position,
    text: row.text,
    strength: row.strength,
    reason: {
      kind: row.reasonKind,
      id: record?.slug ?? "?",
      name: record?.name ?? "?",
      ...optional({ field: row.reasonField }),
    },
  };
}

interface ReasonRecord {
  id: number;
  slug: string;
  name: string;
  row: object;
}

/** The records a Requirement's reason of `kind` can point at, with a readable name each. */
function reasonRecords(model: DecisionModel, kind: RequirementReasonKind): ReasonRecord[] {
  const bySlug = (rows: { id: number; slug: string }[]) =>
    rows.map((row) => ({ id: row.id, slug: row.slug, name: row.slug, row }));
  switch (kind) {
    case "home":
      return [{ id: model.home.id, slug: model.home.slug, name: model.home.name, row: model.home }];
    case "decision":
      return model.decisions.map((row) => ({ id: row.id, slug: row.slug, name: row.title, row }));
    case "constraint":
      return model.constraints.map((row) => ({ id: row.id, slug: row.slug, name: row.text, row }));
    case "note":
      return model.notes.map((row) => ({ id: row.id, slug: row.slug, name: row.text, row }));
    case "room":
      return model.rooms.map((row) => ({ id: row.id, slug: row.slug, name: row.name, row }));
    case "item":
      return model.items.map((row) => ({ id: row.id, slug: row.slug, name: row.name, row }));
    case "feature":
      return model.features.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: featureName(row.kind, row.description ?? undefined),
        row,
      }));
    case "wall":
      return bySlug(model.walls);
    case "window":
      return bySlug(model.windows);
    case "door":
      return bySlug(model.doors);
    case "surface":
      return bySlug(model.surfaces);
  }
}

function resolveReason(
  model: DecisionModel,
  reason: ReasonIn,
): { kind: RequirementReasonKind; id: number; field: string | null } {
  const records = reasonRecords(model, reason.kind);
  if (reason.kind !== "home" && reason.id === undefined) {
    throw new CoreError(
      "validation",
      `A Requirement's ${reason.kind} reason needs its id: the ${reason.kind}'s slug.`,
    );
  }
  const record =
    reason.kind === "home"
      ? reason.id === undefined || reason.id === model.home.slug
        ? records[0]
        : undefined
      : records.find((each) => each.slug === reason.id);
  if (!record) {
    throw new CoreError(
      "not_found",
      `This Home has no ${reason.kind} "${reason.id}" for a Requirement's reason to point at.`,
    );
  }
  if (reason.field !== undefined && !(reason.field in record.row)) {
    throw new CoreError(
      "validation",
      `The ${reason.kind} ${record.slug} has no field "${reason.field}". Name one it records, ` +
        'e.g. "length" of a Wall, or leave field out when the whole record matters.',
    );
  }
  return { kind: reason.kind, id: record.id, field: reason.field ?? null };
}

/** The kind's content, validated against the kind's own schema. */
function validContent(kind: DecisionKind, content: object | undefined): Record<string, unknown> {
  const schema = DECISION_CONTENT[kind];
  const parsed = schema.safeParse(content ?? {});
  if (parsed.success) return parsed.data as Record<string, unknown>;
  const problems = parsed.error.issues.map((issue) => {
    if (issue.code === "unrecognized_keys") {
      return `${issue.keys.join(", ")} ${issue.keys.length === 1 ? "is" : "are"} not part of a ${KINDS[kind]}`;
    }
    const where = issue.path.join(".") || "content";
    return /received undefined$/.test(issue.message)
      ? `${where} is required`
      : `${where}: ${issue.message}`;
  });
  const fields = Object.keys(schema.shape);
  throw new CoreError(
    "validation",
    `Invalid content for a ${KINDS[kind]}: ${problems.join("; ")}. ` +
      (fields.length > 0
        ? `Its content takes ${fields.join(", ")}.`
        : "It takes no content: leave content out."),
  );
}

const day = (timestamp: string) => timestamp.slice(0, 10);

// ─── Writing Decisions ──────────────────────────────────────────────────────────────────────

/** Kinds of which only one is Locked at a time: in the Home, or in each Room. */
const ONE_LOCKED: Partial<Record<DecisionKind, "home" | "room">> = {
  "design-direction": "home",
  palette: "home",
  "room-direction": "room",
  "room-use": "room",
};

const TRANSITION_HINTS: Record<DecisionState, string> = {
  candidate: "",
  leaning: "",
  locked: " Reopening it (to leaning) or rejecting it needs the user's yes first.",
  rejected: " Reviving it (to candidate) needs the user's explicit instruction.",
};

interface EvidenceStep {
  sourceKind: EvidenceKind;
  sourceId: number;
  stance: Stance;
  note: string | undefined;
  label: string;
}

interface RequirementStep {
  position: number;
  /** The Requirement at that position, when there is one. */
  row?: RequirementRow;
  values: {
    text: string;
    strength: Strength;
    reasonKind: RequirementReasonKind;
    reasonId: number;
    reasonField: string | null;
  };
  /** The fields that change on an existing Requirement. */
  changed: string[];
  /** true to Archive it, false to restore it. */
  archive?: boolean;
}

/**
 * The writes of one Decision operation: saving, state changes with their cascade, and clearing
 * flags and Conflicts. Every change is logged and becomes a line of the receipt.
 */
class DecisionWrites {
  readonly #context: OperationContext;
  readonly #model: DecisionModel;
  readonly #writer: Writer;
  readonly #session: SessionRow | undefined;

  constructor(
    context: OperationContext,
    model: DecisionModel,
    writer: Writer,
    session: SessionRow | undefined,
  ) {
    this.#context = context;
    this.#model = model;
    this.#writer = writer;
    this.#session = session;
  }

  save(input: SaveDecision): void {
    const model = this.#model;
    const { kind } = input;
    const scope = DECISION_KIND_SCOPES[kind];
    const room = input.room === undefined ? undefined : requireRoom(model, input.room);
    if (room && scope === "home") {
      throw new CoreError(
        "validation",
        `A ${KINDS[kind]} is about the whole Home: leave out room.` +
          (kind === "design-direction" ? " One Room's own direction is a room-direction." : ""),
      );
    }
    const existing =
      input.decision !== undefined
        ? requireDecision(model, input.decision)
        : model.decisions.find(
            (each) =>
              active(each) &&
              each.state !== "rejected" &&
              each.kind === kind &&
              each.scopeRoomId === (room?.id ?? null) &&
              sameName(each.title, input.title),
          );
    if (existing && existing.kind !== kind) {
      throw new CoreError(
        "validation",
        `${titled(existing)} is a ${KINDS[existing.kind]}, and a Decision's kind never changes. ` +
          `Save a new ${KINDS[kind]} instead (leave out decision).`,
      );
    }
    const scopeRoom =
      room ??
      (existing && existing.scopeRoomId !== null
        ? roomById(model, existing.scopeRoomId)
        : undefined);
    if (scope === "room" && !scopeRoom) {
      throw new CoreError(
        "validation",
        `A ${KINDS[kind]} is about one Room: give room, the Room's slug as the opening lists it.`,
      );
    }
    if (input.requirements?.length && kind !== "purchase") {
      throw new CoreError(
        "validation",
        `Requirements belong to Purchase Decisions, and this is a ${KINDS[kind]}. Leave ` +
          "requirements out.",
      );
    }
    const content =
      input.content === undefined && existing
        ? existing.content
        : validContent(kind, input.content);
    const basis = input.basis === undefined ? undefined : this.#basis(input.basis, existing);
    const evidence = (input.evidence ?? []).map((entry) => this.#evidence(entry, existing));
    const requirements = this.#planRequirements(existing, input.requirements ?? []);
    if (!existing) {
      this.#create(input, scopeRoom, content, basis ?? [], evidence, requirements);
    } else {
      this.#edit(existing, input, room, content, basis, evidence, requirements);
    }
  }

  /**
   * Moves a Decision by the transitions table, recording the change with its Session and reason.
   * A Reopen or Reject clears the Decision's own flags and Conflicts and flags every Decision
   * resting on it. Its current state keeps it as it is, clearing its flags and Conflicts.
   */
  move(decision: DecisionRow, to: DecisionState, reason: string | undefined): void {
    const from = decision.state;
    if (to === from) {
      this.#keep(decision, reason);
      return;
    }
    const legal = LEGAL_TRANSITIONS[from];
    if (!legal.includes(to)) {
      throw new CoreError(
        "illegal_transition",
        `${titled(decision)} is ${STATES[from]}, and a ${STATES[from]} Decision can move only to ` +
          `${legal.join(" or ")}.${TRANSITION_HINTS[from]}`,
      );
    }
    if (to === "locked") this.#requireOneLocked(decision);
    const model = this.#model;
    const { store } = this.#context;
    const wasInForce = inForce(model, "design-direction")?.id === decision.id;
    store.update("decisions", decision.id, { state: to });
    this.#writer.logged({
      recordKind: "decision",
      record: decision,
      field: "state",
      old: from,
      new: to,
      ...(reason ? { reason } : {}),
    });
    model.stateChanges.push(
      store.insert("state_changes", {
        homeId: model.home.id,
        decisionId: decision.id,
        fromState: from,
        toState: to,
        sessionId: this.#session?.id ?? null,
        origin: this.#session?.slug ?? "web",
        reason: reason ?? null,
        at: this.#context.now(),
      }),
    );
    decision.state = to;
    const reopened = from === "locked" && to === "leaning";
    const rejected = to === "rejected";
    const cleared =
      reopened || rejected ? this.#clear(decision, reopened ? "reopen" : "reject", reason) : [];
    this.#writer.line(
      titled(decision),
      [transitionText(from, to), cleared.length > 0 ? `cleared ${cleared.join(", ")}` : ""]
        .filter(Boolean)
        .join("; "),
    );
    if (reopened || rejected)
      this.#cascade(decision, reopened ? "reopened" : "rejected", wasInForce);
  }

  /** Resolves one flag or Conflict: keep clears it alone; reopen and reject move its Decision. */
  resolve(
    target: { flag: FlagRow } | { conflict: ConflictRow },
    resolution: Resolution,
    reason: string | undefined,
  ): void {
    const row = "flag" in target ? target.flag : target.conflict;
    const decision = decisionById(this.#model, row.decisionId);
    if (resolution === "keep") {
      if ("flag" in target) this.#clearFlag(target.flag, "keep", reason);
      else this.#resolveConflict(target.conflict, "keep", reason);
      this.#writer.line(titled(decision), `kept as ${STATES[decision.state]}; cleared ${row.slug}`);
      return;
    }
    if (resolution === "reopen" && decision.state !== "locked") {
      throw new CoreError(
        "illegal_transition",
        `${titled(decision)} is ${STATES[decision.state]}, not Locked, so it can't be Reopened. ` +
          "Keep it or reject it.",
      );
    }
    this.move(decision, resolution === "reopen" ? "leaning" : "rejected", reason);
  }

  #keep(decision: DecisionRow, reason: string | undefined): void {
    const state = decision.state;
    if (
      openFlags(this.#model, decision).length + openConflicts(this.#model, decision).length ===
      0
    ) {
      throw new CoreError(
        "illegal_transition",
        `${titled(decision)} is already ${STATES[state]}, with no open flag or Conflict to clear ` +
          `by keeping it. A ${STATES[state]} Decision can move to ` +
          `${LEGAL_TRANSITIONS[state].join(" or ")}.${TRANSITION_HINTS[state]}`,
      );
    }
    const cleared = this.#clear(decision, "keep", reason);
    this.#writer.line(titled(decision), `kept as ${STATES[state]}; cleared ${cleared.join(", ")}`);
  }

  /** Clears every open flag and Conflict of a Decision; returns their slugs. */
  #clear(decision: DecisionRow, resolution: Resolution, reason: string | undefined): string[] {
    const flags = openFlags(this.#model, decision);
    const conflicts = openConflicts(this.#model, decision);
    for (const flag of flags) this.#clearFlag(flag, resolution, reason);
    for (const conflict of conflicts) this.#resolveConflict(conflict, resolution, reason);
    return [...flags, ...conflicts].map((each) => each.slug);
  }

  #clearFlag(flag: FlagRow, resolution: Resolution, reason: string | undefined): void {
    const cleared = { clearedAt: this.#context.now(), resolution, reason: reason ?? null };
    this.#context.store.update("flags", flag.id, cleared);
    Object.assign(flag, cleared);
    this.#writer.logged({
      recordKind: "flag",
      record: flag,
      field: "resolution",
      new: resolution,
      ...(reason ? { reason } : {}),
    });
  }

  #resolveConflict(conflict: ConflictRow, resolution: Resolution, reason: string | undefined) {
    const resolved = { resolvedAt: this.#context.now(), resolution, reason: reason ?? null };
    this.#context.store.update("conflicts", conflict.id, resolved);
    Object.assign(conflict, resolved);
    this.#writer.logged({
      recordKind: "conflict",
      record: conflict,
      field: "resolution",
      new: resolution,
      ...(reason ? { reason } : {}),
    });
  }

  /**
   * Flags every Decision resting on `changed`: those with it in their Basis, and when it was
   * the Design Direction in force, every other Decision. Rejected and Fulfilled ones are left
   * alone: nothing about them is open for review.
   */
  #cascade(changed: DecisionRow, cause: FlagCause, wasInForce: boolean): void {
    const model = this.#model;
    for (const decision of model.decisions) {
      if (decision.id === changed.id || !active(decision)) continue;
      if (decision.state === "rejected" || decision.fulfilledAt !== null) continue;
      const rests =
        (wasInForce && decision.kind !== "design-direction") ||
        model.basis.some(
          (link) => link.decisionId === decision.id && link.basisDecisionId === changed.id,
        );
      if (rests) this.#raise(decision, cause, changed);
    }
  }

  #raise(decision: DecisionRow, cause: FlagCause, source: DecisionRow): void {
    const model = this.#model;
    const flags = model.flags.filter((flag) => flag.decisionId === decision.id);
    const raised = flags.some(
      (flag) =>
        flag.clearedAt === null &&
        flag.cause === cause &&
        flag.sourceKind === "decision" &&
        flag.sourceId === source.id,
    );
    if (raised) return;
    const flag = this.#writer.create(
      "flags",
      "flag",
      {
        homeId: model.home.id,
        decisionId: decision.id,
        slug: `${decision.slug}/flag-${flags.length + 1}`,
        cause,
        sourceKind: "decision",
        sourceId: source.id,
        raisedAt: this.#context.now(),
        clearedAt: null,
        resolution: null,
        reason: null,
      },
      { decision: decision.slug, cause, source: source.slug },
    );
    model.flags.push(flag);
    this.#writer.flagged.push({
      decision: { name: decision.title, slug: decision.slug },
      source: { name: source.title, slug: source.slug },
      cause,
    });
  }

  /** One Design Direction and one Palette Locked in the Home; one Room Direction and use per Room. */
  #requireOneLocked(decision: DecisionRow): void {
    const per = ONE_LOCKED[decision.kind];
    if (!per) return;
    const other = this.#model.decisions.find(
      (each) =>
        each.id !== decision.id &&
        active(each) &&
        each.kind === decision.kind &&
        each.state === "locked" &&
        each.fulfilledAt === null &&
        (per === "home" || each.scopeRoomId === decision.scopeRoomId),
    );
    if (!other) return;
    const where =
      per === "room" && decision.scopeRoomId !== null
        ? ` for ${named(roomById(this.#model, decision.scopeRoomId))}`
        : "";
    throw new CoreError(
      "illegal_transition",
      `The ${KINDS[decision.kind]} ${titled(other)} is already Locked${where}, and only one is ` +
        `Locked at a time. Reopen or reject it first (asking the user), then Lock ` +
        `${titled(decision)}.`,
    );
  }

  #basis(slugs: string[], self: DecisionRow | undefined): DecisionRow[] {
    const rows: DecisionRow[] = [];
    for (const slug of slugs) {
      const row = requireDecision(this.#model, slug);
      if (self && row.id === self.id) {
        throw new CoreError(
          "validation",
          `${titled(self)} can't rest on itself: take ${slug} out of basis.`,
        );
      }
      // The Design Direction is in every Basis automatically, never listed twice.
      if (row.kind === "design-direction" || rows.includes(row)) continue;
      rows.push(row);
    }
    return rows;
  }

  #evidence(entry: EvidenceIn, self: DecisionRow | undefined): EvidenceStep {
    const model = this.#model;
    const step = { sourceKind: entry.kind, stance: entry.stance, note: entry.note };
    if (entry.kind === "note") {
      const note = model.notes.find((each) => each.slug === entry.id);
      if (!note) {
        throw new CoreError(
          "not_found",
          `This Home has no Note "${entry.id}". search_notes lists its Notes with their slugs.`,
        );
      }
      return { ...step, sourceId: note.id, label: `Note ${note.slug}` };
    }
    if (entry.kind === "session") {
      const session = model.sessions.find((each) => each.slug === entry.id);
      if (!session) {
        throw new CoreError(
          "not_found",
          `This Home has no Session "${entry.id}". For what the user said or showed in this ` +
            "Session, pass this Session's id.",
        );
      }
      return { ...step, sourceId: session.id, label: `Session ${session.slug}` };
    }
    const decision = requireDecision(model, entry.id);
    if (self && decision.id === self.id) {
      throw new CoreError("validation", `${titled(self)} can't be Evidence for itself.`);
    }
    return { ...step, sourceId: decision.id, label: `Decision ${decision.slug}` };
  }

  #planRequirements(decision: DecisionRow | undefined, inputs: RequirementIn[]): RequirementStep[] {
    const rows = decision
      ? this.#model.requirements.filter((each) => each.decisionId === decision.id)
      : [];
    let last = Math.max(0, ...rows.map((each) => each.position));
    const steps: RequirementStep[] = [];
    for (const input of inputs) {
      const row =
        input.position === undefined
          ? undefined
          : rows.find((each) => each.position === input.position);
      const reason = input.reason && resolveReason(this.#model, input.reason);
      if (!row) {
        if (!input.text || !input.strength || !reason) {
          throw new CoreError(
            "validation",
            "To add a Requirement, give its text, strength (must or prefer), and reason" +
              (input.position !== undefined
                ? `; there is no Requirement ${input.position} to change.`
                : "."),
          );
        }
        const position = input.position ?? last + 1;
        if (steps.some((step) => step.position === position)) {
          throw new CoreError("validation", `Two Requirements are given position ${position}.`);
        }
        last = Math.max(last, position);
        steps.push({
          position,
          values: {
            text: input.text,
            strength: input.strength,
            reasonKind: reason.kind,
            reasonId: reason.id,
            reasonField: reason.field,
          },
          changed: [],
        });
        continue;
      }
      const values = {
        text: input.text ?? row.text,
        strength: input.strength ?? row.strength,
        reasonKind: reason?.kind ?? row.reasonKind,
        reasonId: reason?.id ?? row.reasonId,
        reasonField: reason ? reason.field : row.reasonField,
      };
      const changed = (["text", "strength"] as const).filter((key) => values[key] !== row[key]);
      const reasonChanged =
        values.reasonKind !== row.reasonKind ||
        values.reasonId !== row.reasonId ||
        values.reasonField !== row.reasonField;
      const archive =
        input.archive === true && row.archivedAt === null
          ? true
          : input.archive === false && row.archivedAt !== null
            ? false
            : undefined;
      steps.push({
        position: row.position,
        row,
        values,
        changed: reasonChanged ? [...changed, "reason"] : [...changed],
        ...(archive === undefined ? {} : { archive }),
      });
    }
    return steps;
  }

  #create(
    input: SaveDecision,
    room: RoomRow | undefined,
    content: Record<string, unknown>,
    basis: DecisionRow[],
    evidence: EvidenceStep[],
    requirements: RequirementStep[],
  ): void {
    const model = this.#model;
    const { store } = this.#context;
    const slug = uniqueSlug(input.title, "decision", (taken) =>
      store.slugTaken("decisions", taken, model.home.id),
    );
    const decision = this.#writer.create(
      "decisions",
      "decision",
      {
        homeId: model.home.id,
        slug,
        kind: input.kind,
        scopeRoomId: room?.id ?? null,
        title: input.title,
        statement: input.statement,
        content,
        state: "candidate",
        createdAt: this.#context.now(),
        fulfilledAt: null,
        fulfilment: null,
        archivedAt: null,
      },
      {
        kind: input.kind,
        room: room?.slug,
        title: input.title,
        statement: input.statement,
        content,
        state: "candidate",
      },
    );
    model.decisions.push(decision);
    this.#setBasis(decision, basis);
    const parts = [
      `created as a Candidate ${KINDS[input.kind]}` +
        (room ? ` for ${named(room)}` : ", Home-wide"),
      this.#basisText(decision),
      this.#addEvidence(decision, evidence),
    ];
    this.#writer.line(titled(decision), parts.filter(Boolean).join("; "));
    this.#applyRequirements(decision, requirements);
  }

  #edit(
    decision: DecisionRow,
    input: SaveDecision,
    room: RoomRow | undefined,
    content: Record<string, unknown>,
    basis: DecisionRow[] | undefined,
    evidence: EvidenceStep[],
    requirements: RequirementStep[],
  ): void {
    const model = this.#model;
    const writer = this.#writer;
    const subject = titled(decision);
    const scopeChanged = room !== undefined && room.id !== decision.scopeRoomId;
    const fieldsChanged =
      decision.title !== input.title ||
      decision.statement !== input.statement ||
      !equal(decision.content, content);
    const current = model.basis
      .filter((link) => link.decisionId === decision.id)
      .map((link) => link.basisDecisionId)
      .sort((a, b) => a - b);
    const basisChanged =
      basis !== undefined &&
      !equal(
        current,
        basis.map((row) => row.id).sort((a, b) => a - b),
      );
    const requirementsChanged = requirements.some(
      (step) => !step.row || step.changed.length > 0 || step.archive !== undefined,
    );
    const changing = scopeChanged || fieldsChanged || basisChanged || requirementsChanged;
    if (changing && decision.state === "locked") {
      throw new CoreError(
        "illegal_transition",
        `${subject} is Locked, so it takes new Evidence only. To change it, ask the user, ` +
          "Reopen it with set_decision_state (to leaning), then save it again.",
      );
    }
    if (changing && decision.state === "rejected") {
      throw new CoreError(
        "illegal_transition",
        `${subject} is Rejected, so it takes new Evidence only. Revive it (set_decision_state ` +
          "to candidate) only if the user asks, then save it again.",
      );
    }

    const heads: string[] = [];
    if (scopeChanged && room) {
      const from =
        decision.scopeRoomId === null ? undefined : roomById(model, decision.scopeRoomId);
      writer.link("decisions", "decision", decision, { scopeRoomId: room.id }, "room", {
        old: from?.slug ?? "home",
        new: room.slug,
      });
      decision.scopeRoomId = room.id;
      heads.push(`now about ${named(room)}`);
    }
    const was = { title: decision.title, content: decision.content };
    const fields = writer.patch("decisions", "decision", decision, subject, {
      title: input.title,
      statement: input.statement,
      content,
    });
    for (const { field } of fields) {
      if (field === "title") heads.push(`renamed from ${was.title}`);
      if (field === "statement") heads.push("statement changed");
      if (field === "content") heads.push(`content changed (${changedKeys(was.content, content)})`);
    }
    Object.assign(decision, { title: input.title, statement: input.statement, content });
    if (basis && this.#setBasis(decision, basis)) {
      heads.push(this.#basisText(decision) ?? "Basis now empty");
    }
    const added = this.#addEvidence(decision, evidence);
    if (added) heads.push(added);
    const nothing = heads.length === 0 && !requirementsChanged;
    writer.line(
      titled(decision),
      nothing ? "already recorded like this, nothing changed" : heads.join("; ") || undefined,
    );
    this.#applyRequirements(decision, requirements);
  }

  /** Replaces the Decisions given as a Decision's Basis; returns whether anything changed. */
  #setBasis(decision: DecisionRow, rows: DecisionRow[]): boolean {
    const model = this.#model;
    const { store } = this.#context;
    const current = model.basis.filter((link) => link.decisionId === decision.id);
    const wanted = new Set(rows.map((row) => row.id));
    const kept = new Set(current.map((link) => link.basisDecisionId));
    const removed = current.filter((link) => !wanted.has(link.basisDecisionId));
    const added = rows.filter((row) => !kept.has(row.id));
    if (removed.length === 0 && added.length === 0) return false;
    for (const link of removed) {
      store.removeBasis(link.id);
      model.basis.splice(model.basis.indexOf(link), 1);
    }
    for (const row of added) {
      model.basis.push(
        store.insert("decision_basis", {
          homeId: model.home.id,
          decisionId: decision.id,
          basisDecisionId: row.id,
        }),
      );
    }
    this.#writer.logged({
      recordKind: "decision",
      record: decision,
      field: "basis",
      old: current.map((link) => decisionById(model, link.basisDecisionId).slug),
      new: rows.map((row) => row.slug),
    });
    return true;
  }

  /** "Basis: Warm minimalism (warm-minimalism), the Design Direction, automatically; …". */
  #basisText(decision: DecisionRow): string | undefined {
    const basis = basisOf(this.#model, decision);
    if (basis.length === 0) return undefined;
    return `Basis: ${basis
      .map(({ row, automatic }) =>
        automatic ? `${titled(row)}, the Design Direction, automatically` : titled(row),
      )
      .join("; ")}`;
  }

  /** Adds Evidence, or changes the stance and note of a source already recorded. */
  #addEvidence(decision: DecisionRow, steps: EvidenceStep[]): string | undefined {
    const model = this.#model;
    const { store } = this.#context;
    const done: string[] = [];
    for (const step of steps) {
      const row = model.evidence.find(
        (each) =>
          each.decisionId === decision.id &&
          each.sourceKind === step.sourceKind &&
          each.sourceId === step.sourceId,
      );
      const note = step.note ?? row?.note ?? null;
      if (row) {
        if (row.stance === step.stance && row.note === note) continue;
        store.update("decision_evidence", row.id, { stance: step.stance, note });
        Object.assign(row, { stance: step.stance, note });
        done.push(`${step.label} now ${step.stance}`);
      } else {
        model.evidence.push(
          store.insert("decision_evidence", {
            homeId: model.home.id,
            decisionId: decision.id,
            sourceKind: step.sourceKind,
            sourceId: step.sourceId,
            stance: step.stance,
            note,
          }),
        );
        done.push(`${step.label} ${step.stance}`);
      }
      this.#writer.logged({
        recordKind: "decision",
        record: decision,
        field: "evidence",
        new: { source: step.label, stance: step.stance, ...(note ? { note } : {}) },
      });
    }
    return done.length > 0 ? `Evidence: ${done.join(", ")}` : undefined;
  }

  #applyRequirements(decision: DecisionRow, steps: RequirementStep[]): void {
    const model = this.#model;
    const { store } = this.#context;
    for (const step of steps) {
      const subject = `Requirement ${step.position} of ${titled(decision)}`;
      const field = `requirement ${step.position}`;
      const shown = {
        text: step.values.text,
        strength: step.values.strength,
        reason: reasonLabel(model, step.values),
      };
      if (!step.row) {
        model.requirements.push(
          store.insert("requirements", {
            homeId: model.home.id,
            decisionId: decision.id,
            position: step.position,
            ...step.values,
            archivedAt: null,
          }),
        );
        this.#writer.logged({ recordKind: "decision", record: decision, field, new: shown });
        this.#writer.line(
          subject,
          `added: ${shown.strength}, ${shown.text} (reason: ${shown.reason})`,
        );
        continue;
      }
      const { row } = step;
      const heads: string[] = [];
      if (step.changed.length > 0) {
        store.update("requirements", row.id, step.values);
        this.#writer.logged({
          recordKind: "decision",
          record: decision,
          field,
          old: { text: row.text, strength: row.strength, reason: reasonLabel(model, row) },
          new: shown,
        });
        Object.assign(row, step.values);
        heads.push(`${step.changed.join(", ")} changed`);
      }
      if (step.archive !== undefined) {
        const archivedAt = step.archive ? this.#context.now() : null;
        store.update("requirements", row.id, { archivedAt });
        this.#writer.logged({
          recordKind: "decision",
          record: decision,
          field: `${field} archivedAt`,
          old: row.archivedAt ?? undefined,
          new: archivedAt,
        });
        row.archivedAt = archivedAt;
        heads.push(step.archive ? "archived" : "restored");
      }
      if (heads.length > 0) this.#writer.line(subject, heads.join("; "));
    }
  }
}

function transitionText(from: DecisionState, to: DecisionState): string {
  if (from === "locked" && to === "leaning") return "Reopened to Leaning, was Locked";
  if (from === "rejected") return "revived to Candidate, was Rejected";
  return `${STATES[to]}, was ${STATES[from]}`;
}

function changedKeys(was: Record<string, unknown>, now: Record<string, unknown>): string {
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])];
  return keys.filter((key) => !equal(was[key] ?? null, now[key] ?? null)).join(", ");
}

/** A Requirement's reason as a receipt shows it: "Wall living-room/wall-2, length". */
function reasonLabel(
  model: DecisionModel,
  reason: { reasonKind: RequirementReasonKind; reasonId: number; reasonField: string | null },
): string {
  const record = reasonRecords(model, reason.reasonKind).find(
    (each) => each.id === reason.reasonId,
  );
  const what =
    record === undefined
      ? "?"
      : record.name === record.slug
        ? record.slug
        : named({ name: record.name, slug: record.slug });
  const noun = reason.reasonKind.charAt(0).toUpperCase() + reason.reasonKind.slice(1);
  return `${noun} ${what}${reason.reasonField ? `, ${reason.reasonField}` : ""}`;
}
