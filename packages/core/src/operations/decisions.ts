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
  type Receipt,
  renderDecision,
  renderDecisions,
  renderFlagged,
  renderRefused,
  DECISION_STATE_LABELS as STATES,
  titled,
} from "../render.js";
import { uniqueSlug } from "../slug.js";
import type {
  ConflictRow,
  DecisionBasisRow,
  DecisionEvidenceRow,
  DecisionRow,
  DeviationRow,
  FeatureRow,
  FlagRow,
  GuideRow,
  HomeRow,
  ItemRow,
  ListingCheckRow,
  ListingRow,
  NoteRow,
  RequirementRow,
  RoomRow,
  SessionRow,
  StateChangeRow,
  Store,
} from "../store.js";
import { addFeature } from "./features.js";
import { saveItem } from "./items.js";
import { active, requireRoom, requireSources, requireWall } from "./lookup.js";
import { type HomeModel, loadHome, overviewView, roomById, roomDetail } from "./model.js";
import {
  activeRequirements,
  guideOf,
  type PhoneOrigins,
  toDeviations,
  toGuides,
  toListings,
  toQuickGuide,
} from "./purchase-views.js";
import { reasonLabel, reasonRecord, resolveReason } from "./reasons.js";
import {
  type BuildingColor,
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
  type Fulfilment,
  findDecisionsInput,
  flagConflictInput,
  type GetDecisionResult,
  getDecisionInput,
  getDecisionWebInput,
  LEGAL_TRANSITIONS,
  LISTED_FIELDS,
  type ListDecisionsResult,
  type ListedField,
  listDecisionsInput,
  type PaletteColor,
  type PaletteContent,
  type ReceiptResult,
  type Requirement,
  type RequirementReasonKind,
  type Resolution,
  type RoomColorContent,
  type RoomFunction,
  type RoomUseContent,
  recordFulfilmentInput,
  type requirementInput,
  resolveConflictInput,
  resolveFlagInput,
  type Stance,
  type Strength,
  saveDecisionInput,
  setDecisionStateInput,
  setDecisionStateWebInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { saveSurface, surfaceSlug } from "./surfaces.js";
import { sameName, Writer } from "./writer.js";

type SaveDecision = z.output<typeof saveDecisionInput>;
type EvidenceIn = z.output<typeof evidenceInput>;
type RequirementIn = z.output<typeof requirementInput>;

// ─── The operations ─────────────────────────────────────────────────────────────────────────

export const saveDecision = defineOperation({
  name: "save_decision",
  description:
    "Creates or changes one Decision of this Home and returns a receipt. A Decision is a choice " +
    "about the whole Home or one Room, always in one state: candidate (under consideration), " +
    "leaning (favoured), settled (committed), or rejected. A new one starts as a Candidate; " +
    "change its state only with set_decision_state. Its kind says what the app does with it: " +
    "design-direction (the Home's style, Home-wide; it names no colors), room-direction (how " +
    "one Room refines it), room-use (what one Room is for; its functions change when Fulfilled), " +
    "palette (the Home's named colors, each with a role; one Settled at a time), room-color (a " +
    "Surface's color and finish: its color must name a color of the Palette in force, the " +
    "Settled Palette, else the Leaning one; its Surface changes when Fulfilled), purchase (with " +
    "Requirements), or other. content holds the kind's own fields; each field says which kinds " +
    "take it. Pass `decision` (its slug) to change one: title and statement are always given, " +
    "content replaces what is recorded, basis replaces the Basis, and evidence entries are " +
    "added. Without it, one of the same kind, scope, and title that is neither Rejected nor " +
    "Fulfilled is changed. A Requirement given without a position that matches an active one " +
    "(text, strength, and reason) is left as it is. A Settled or Rejected Decision takes new " +
    "Evidence only: to change it, Reopen or revive it first, with the user's yes; a Fulfilled " +
    "one is never Reopened. Basis: the Decisions it rests on (the Design Direction is in every " +
    "Basis automatically, the Palette in force in the Basis of every Decision using its colors, " +
    "and a Decision a Requirement's reason names joins it); Evidence: the Notes, Sessions, or " +
    "Decisions that support or " +
    "undermine it. Every Basis and Evidence entry must exist in this Home. Needs the open " +
    "Session's id as `session`.",
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
    "move flagged. Only these moves: candidate to leaning, settled, or rejected; leaning to " +
    "candidate, settled, or rejected; settled to leaning (a Reopen) or rejected; rejected to " +
    "candidate (a revival). A Fulfilled Decision stays Settled for good: it can only be kept. " +
    "Settle only when the user clearly commits. Before a Reopen, rejecting " +
    "a Settled Decision, or reviving a Rejected one, ask the user and wait for a yes. `reason` is " +
    "required: why, quoting the user's words when they gave permission. A Reopen or Reject " +
    "flags, but never changes, every Decision resting on this one; each flag stays until the " +
    "user keeps, Reopens, or Rejects that Decision, which also clears its own flags and " +
    "Conflicts. To keep a flagged Decision as it is, pass its current state as `to`, quoting " +
    "the user. Then say plainly what changed, e.g. \"Settled: Design Direction 'Warm " +
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
          'words when they gave permission (The user: "yes, settle it"). Call again with `reason`.',
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
    "Basis and per piece of Evidence. For a Purchase it also gives the Quick Guide's lines " +
    "besides the Requirements (Measure first, then your own), the Full Guide as one line (when " +
    "it was written, and whether it is out of date; includeFullGuide gives its text), one line " +
    "per Listing (price, pass, fail, and unknown counts, and any must it fails), and after " +
    "Fulfilment its Deviations. The opening, Room Sheets, and find_decisions give only " +
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
    return {
      decision: toDetail(model, requireDecision(model, input.decision), {
        includeFullGuide: input.includeFullGuide === true,
        ...optional({ publicOrigin: context.publicOrigin, lanUrl: context.lanUrl }),
      }),
    };
  },
  text: ({ decision }) => renderDecision(decision),
});

export const flagConflict = defineOperation({
  name: "flag_conflict",
  description:
    "Raises a Conflict: something new (what the user now says, shows, or wants) contradicts a " +
    "Settled Decision of this Home. Only a Settled Decision not yet Fulfilled can have a Conflict; " +
    "for one still " +
    "open, add the Evidence with save_decision (stance undermines) instead. Raising it changes " +
    "nothing else: the Decision stays Settled, and only the user resolves the Conflict, by " +
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
      if (decision.state !== "settled") {
        throw new CoreError(
          "not_settled",
          `${titled(decision)} is ${STATES[decision.state]}, not Settled: a Conflict is raised only ` +
            "against a Settled Decision. For one still open, add the new Evidence with " +
            "save_decision (stance undermines) instead.",
        );
      }
      if (decision.fulfilledAt !== null) {
        throw new CoreError(
          "validation",
          `${fulfilledOn(decision)}, so there is nothing left to raise a Conflict against. For ` +
            "something new the user wants now, save a new Decision.",
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
        `Conflict raised (${conflict.slug}); it stays Settled until the user keeps, Reopens, or ` +
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
    "Records that a Settled Decision's action was carried out, which makes it Fulfilled (not a " +
    "state: it stays Settled), and changes the Home to match what was actually done. It takes " +
    "Room use, Room color, and Purchase Decisions. Room use: it sets the Room's functions to the " +
    "Decision's, or to roomFunctions when what the user actually did differs. Room color: it " +
    "paints the Surface the Decision names (the Room's walls, ceiling, floor, or woodwork, or " +
    "one Wall's) with its Palette color, Measured when that color has a brand and code and " +
    "Estimated otherwise, in the Decision's finish, or in `finish` when the user used another; " +
    "the receipt gives the Surface's old and new color. A color that would replace one of " +
    "stronger Provenance is refused and nothing is recorded: tell the user both colors in one " +
    "line and ask; only if they say to replace it, call again with overrideProvenance quoting " +
    "them. Purchase: `bought` says what was actually bought, in one line; `deviations` name each " +
    "Requirement it differs from, by position, with the difference; `item` adds the Item bought " +
    "to the Inventory, in the Purchase's Room unless `room` or unplaced says otherwise, and " +
    "`replacesItem` Archives the Item it replaces; name the Listing bought as `listing`, and " +
    "the new Item takes its link, price paid, and shop, tagged Listed, and today as bought on; " +
    "give sizes from the Listing in `item` as listed; `feature` adds a part of the building bought " +
    "(a radiator), and `replacesFeature` Archives the Feature it replaces. A Deviation from a " +
    "must flags every Decision resting on the Purchase for review; one from a prefer flags " +
    "nothing. It is refused while the Decision has an open flag or Conflict: ask the user, then " +
    "keep, Reopen, or Reject it with set_decision_state first. Fulfilled Decisions drop out of " +
    "the Room Sheet and the opening, since the Home now records the result, and are never " +
    "Reopened or Rejected; find_decisions still lists them. Call it only when the user says it " +
    "is done (bought, painted, not planned), and tell them what changed. Needs the open " +
    "Session's id as `session`.",
  input: recordFulfilmentInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const receipt = context.write(session.slug, (log) => {
      const { model, writer, writes } = begin(
        context,
        home,
        log,
        session,
        input.overrideProvenance,
      );
      const decision = requireDecision(model, input.decision);
      const subject = titled(decision);
      const fulfillable =
        decision.kind === "purchase" ||
        ((decision.kind === "room-use" || decision.kind === "room-color") &&
          decision.scopeRoomId !== null);
      if (!fulfillable) {
        throw new CoreError(
          "validation",
          `record_fulfilment takes Room use, Room color, and Purchase Decisions, and ${subject} ` +
            `is a ${KINDS[decision.kind]}: nothing in the Home record changes when it is done.`,
        );
      }
      const misplaced = misplacedField(decision.kind, input);
      if (misplaced) {
        throw new CoreError(
          "validation",
          `${misplaced}, and ${subject} is a ${KINDS[decision.kind]}: leave it out.`,
        );
      }
      if (decision.state !== "settled") {
        throw new CoreError(
          "not_settled",
          `${subject} is ${STATES[decision.state]}, not Settled: only a Settled Decision is ` +
            "Fulfilled. Settle it first, once the user commits.",
        );
      }
      if (decision.fulfilledAt !== null) {
        throw new CoreError(
          "validation",
          `${subject} was already Fulfilled on ${day(decision.fulfilledAt)}.`,
        );
      }
      const open = [...openFlags(model, decision), ...openConflicts(model, decision)];
      if (open.length > 0) {
        throw new CoreError(
          "validation",
          `${subject} can't be Fulfilled while it has an open flag or Conflict ` +
            `(${open.map((each) => each.slug).join(", ")}): the user settles it first.\n` +
            `${renderFlagged([toSummary(model, decision)])}\nAsk the user whether it still ` +
            "holds, then keep it with set_decision_state (to settled, quoting them) and Fulfil " +
            "it; or Reopen or Reject it with set_decision_state, if that is what they say. " +
            "Nothing was recorded.",
        );
      }
      if (decision.kind === "purchase") {
        const rooms = fulfilPurchase(context, model, writer, writes, decision, input);
        return writer.receipt(gapsOf(context, home, rooms));
      }
      const room = roomById(model, decision.scopeRoomId as number);
      if (decision.kind === "room-use") {
        fulfilRoomUse(context, writer, decision, room, input.roomFunctions);
      } else {
        fulfilRoomColor(context, model, writer, decision, room, input.finish);
      }
      return writer.receipt(gapsOf(context, home, [room.id]));
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

type RecordFulfilment = z.output<typeof recordFulfilmentInput>;

/** Which kind each of record_fulfilment's own fields belongs to. */
const FULFILMENT_FIELDS = {
  roomFunctions: "room-use",
  finish: "room-color",
  bought: "purchase",
  deviations: "purchase",
  item: "purchase",
  listing: "purchase",
  replacesItem: "purchase",
  feature: "purchase",
  replacesFeature: "purchase",
} as const satisfies Partial<Record<keyof RecordFulfilment, DecisionKind>>;

/** "finish is for a Room color", when a field of another kind is given. */
function misplacedField(kind: DecisionKind, input: RecordFulfilment): string | undefined {
  for (const [field, owner] of Object.entries(FULFILMENT_FIELDS)) {
    if (owner !== kind && input[field as keyof typeof FULFILMENT_FIELDS] !== undefined) {
      return `${field} is for a ${KINDS[owner]}`;
    }
  }
  return undefined;
}

/** The remaining Gaps of the Rooms a Fulfilment touched, Archived Rooms left out. */
function gapsOf(context: OperationContext, home: HomeRow, roomIds: number[]): Receipt["gaps"] {
  const after = loadHome(context.store, home);
  return [...new Set(roomIds)]
    .map((id) => roomById(after, id))
    .filter((room) => room.archivedAt === null)
    .map((room) => {
      const detail = roomDetail(after, room);
      return { room: detail, gaps: detail.gaps };
    });
}

/**
 * Purchase: what was bought, its Deviations, and the Home change: the Item bought added (in the
 * Purchase's Room unless told otherwise), the Item it replaces Archived, a Feature bought added,
 * and the Feature it replaces Archived. A Deviation from a must flags every Decision resting on
 * the Purchase. Everything is checked before anything changes. Returns the Rooms it touched.
 */
function fulfilPurchase(
  context: OperationContext,
  model: DecisionModel,
  writer: Writer,
  writes: DecisionWrites,
  decision: DecisionRow,
  input: RecordFulfilment,
): number[] {
  const subject = titled(decision);
  const { bought } = input;
  if (!bought) {
    throw new CoreError(
      "validation",
      `To Fulfil ${subject}, give bought: what was actually bought, in one line.`,
    );
  }
  const requirements = activeRequirements(model, decision);
  const deviations = (input.deviations ?? []).map((each) => {
    const requirement = requirements.find((row) => row.position === each.requirement);
    if (!requirement) {
      throw new CoreError(
        "not_found",
        `${subject} has no Requirement ${each.requirement}` +
          (requirements.length > 0
            ? `; its Requirements are ${requirements.map((row) => row.position).join(", ")}.`
            : ", and no Requirements at all.") +
          " Name the Requirement each Deviation differs from by its position.",
      );
    }
    return { requirement, text: each.text, reason: each.reason };
  });
  const twice = deviations.find(
    (each, index) =>
      deviations.findIndex((other) => other.requirement === each.requirement) !== index,
  );
  if (twice) {
    throw new CoreError(
      "validation",
      `Two Deviations name Requirement ${twice.requirement.position}: give one, with every ` +
        "difference in it.",
    );
  }
  const scope = decision.scopeRoomId === null ? undefined : roomById(model, decision.scopeRoomId);
  const oldItem =
    input.replacesItem === undefined
      ? undefined
      : replaced(model.items, input.replacesItem, "Item", "find_items lists the Items");
  const oldFeature =
    input.replacesFeature === undefined
      ? undefined
      : replaced(model.features, input.replacesFeature, "Feature", "Room Sheets list them");
  const featureRoom =
    input.feature === undefined
      ? undefined
      : input.feature.room !== undefined
        ? requireRoom(model, input.feature.room)
        : scope;
  if (input.feature && !featureRoom) {
    throw new CoreError(
      "validation",
      `A Feature is part of a Room, and ${subject} is Home-wide: give feature.room, the Room ` +
        "it is in.",
    );
  }
  const listing =
    input.listing === undefined ? undefined : boughtListing(model, decision, input.listing);
  requireSources(context.store, model.home, { item: input.item, feature: input.feature });

  const count = deviations.length;
  markFulfilled(
    context,
    writer,
    decision,
    { bought },
    `Fulfilled${count > 0 ? ` with ${count} Deviation${count === 1 ? "" : "s"}` : ""}: bought ${bought}`,
  );
  const at = context.now();
  const numbered = model.deviations.filter((each) => each.decisionId === decision.id).length;
  deviations.forEach(({ requirement, text, reason }, index) => {
    const number = numbered + index + 1;
    model.deviations.push(
      context.store.insert("deviations", {
        homeId: model.home.id,
        decisionId: decision.id,
        slug: `${decision.slug}/deviation-${number}`,
        requirementId: requirement.id,
        text,
        reason: reason ?? null,
        recordedAt: at,
      }),
    );
    writer.logged({
      recordKind: "decision",
      record: decision,
      field: `deviation ${number}`,
      new: { requirement: requirement.position, text, ...(reason ? { reason } : {}) },
    });
    writer.line(
      `Deviation from Requirement ${requirement.position} of ${subject}`,
      `${requirement.strength}, "${requirement.text}": ${text}${reason ? ` (${reason})` : ""}`,
    );
  });

  const rooms: number[] = scope ? [scope.id] : [];
  let item: ItemRow | undefined;
  if (input.item) {
    const { room, unplaced, ...given } = input.item;
    const where = unplaced ? undefined : (room ?? scope?.slug);
    const { values: rest, listed } = fromListing(given, listing, at);
    item = saveItem(
      context,
      model,
      writer,
      where === undefined ? { ...rest, unplaced: true } : { ...rest, room: where },
      listed,
    );
    if (item.roomId !== null) rooms.push(item.roomId);
  }
  let feature: FeatureRow | undefined;
  if (input.feature && featureRoom) {
    const { room: _room, ...rest } = input.feature;
    feature = addFeature(context, model, writer, featureRoom, rest);
    rooms.push(featureRoom.id);
  }
  const featureNamed = (row: FeatureRow) =>
    named({ name: featureName(row.kind, row.description ?? undefined), slug: row.slug });
  if (oldItem) {
    const by = item ? named(item) : bought;
    writer.archive("items", "item", oldItem, true, at, `replaced by ${by}`);
    if (item) context.store.update("items", oldItem.id, { replacedByItemId: item.id });
    writer.line(named(oldItem), `archived, replaced by ${by}`);
    if (oldItem.roomId !== null) rooms.push(oldItem.roomId);
  }
  if (oldFeature) {
    const by = feature ? featureNamed(feature) : item ? named(item) : bought;
    writer.archive("features", "feature", oldFeature, true, at, `replaced by ${by}`);
    if (feature) {
      context.store.update("features", oldFeature.id, { replacedByFeatureId: feature.id });
    }
    writer.line(featureNamed(oldFeature), `archived, replaced by ${by}`);
    rooms.push(oldFeature.roomId);
  }
  const fulfilment = {
    bought,
    ...optional({
      item: item?.slug,
      replacedItem: oldItem?.slug,
      feature: feature?.slug,
      replacedFeature: oldFeature?.slug,
      listing: listing?.slug,
    }),
  };
  context.store.update("decisions", decision.id, { fulfilment });
  decision.fulfilment = fulfilment;
  if (deviations.some(({ requirement }) => requirement.strength === "must")) {
    writes.cascade(decision, "deviation");
  }
  return rooms;
}

/** The Listing a Purchase was Fulfilled with: one of its own. */
function boughtListing(model: DecisionModel, decision: DecisionRow, slug: string): ListingRow {
  const listing = model.listings.find((each) => each.slug === slug);
  if (listing?.decisionId === decision.id) return listing;
  const subject = titled(decision);
  const own = model.listings.filter((each) => each.decisionId === decision.id);
  const theirs = listing && model.decisions.find((each) => each.id === listing.decisionId);
  throw new CoreError(
    theirs ? "validation" : "not_found",
    (theirs
      ? `The Listing ${slug} belongs to ${titled(theirs)}, not ${subject}. `
      : `This Home has no Listing "${slug}". `) +
      (own.length > 0
        ? `${subject}'s Listings are ${own.map((each) => each.slug).join(", ")}.`
        : `${subject} has no Listings: leave out listing, or record the one bought first.`),
  );
}

/**
 * The Item bought, filled from the Listing bought: bought today, and its link, price, and shop
 * (the link's host) copied and tagged Listed. What the Agent gave wins and is not tagged. The
 * Listing's dimensions are free text and never copied: the Agent gives the sizes.
 */
function fromListing<
  T extends { boughtOn?: string; boughtFrom?: string; pricePaid?: string; link?: string },
>(given: T, listing: ListingRow | undefined, at: string): { values: T; listed: ListedField[] } {
  if (!listing) return { values: given, listed: [] };
  const copied: Partial<Record<ListedField, string>> = optional({
    boughtFrom: listing.url ? shopOf(listing.url) : undefined,
    pricePaid: listing.price,
    link: listing.url,
  });
  const listed = LISTED_FIELDS.filter(
    (field) => given[field] === undefined && copied[field] !== undefined,
  );
  return {
    values: {
      ...given,
      boughtOn: given.boughtOn ?? at.slice(0, 10),
      ...Object.fromEntries(listed.map((field) => [field, copied[field]])),
    },
    listed,
  };
}

/** "falabella.com.pe", from a product page's URL. */
function shopOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/** The Item or Feature a Purchase replaces: one of the Home's, not yet Archived. */
function replaced<T extends { slug: string; archivedAt: string | null }>(
  rows: T[],
  slug: string,
  noun: string,
  hint: string,
): T {
  const row = rows.find((each) => each.slug === slug);
  if (!row) {
    throw new CoreError("not_found", `This Home has no ${noun} "${slug}" to replace; ${hint}.`);
  }
  if (row.archivedAt !== null) {
    throw new CoreError(
      "validation",
      `The ${noun} ${slug} was already Archived on ${day(row.archivedAt)}, so there is nothing ` +
        "to replace: leave it out.",
    );
  }
  return row;
}

/** Room use: the Room's functions become the Decision's, or what the user actually did. */
function fulfilRoomUse(
  context: OperationContext,
  writer: Writer,
  decision: DecisionRow,
  room: RoomRow,
  actual: RoomFunction[] | undefined,
): void {
  const decided = (decision.content as RoomUseContent).functions;
  const functions = actual ?? decided;
  markFulfilled(
    context,
    writer,
    decision,
    { roomFunctions: functions },
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
}

/**
 * Room color: its Surface (the Room's part, or one Wall's) takes the Color value of its color in
 * the Palette stored in its Basis, not the Palette in force, Measured when it has a brand and code
 * and Estimated otherwise, and the finish applied. It is refused when that Palette no longer has
 * the color, or the Decision has no Palette: it needs Reopening. A color that would replace a
 * stronger one without overrideProvenance refuses the whole Fulfilment.
 */
function fulfilRoomColor(
  context: OperationContext,
  model: DecisionModel,
  writer: Writer,
  decision: DecisionRow,
  room: RoomRow,
  actualFinish: string | undefined,
): void {
  const subject = titled(decision);
  const content = decision.content as RoomColorContent;
  const palette = storedPalette(model, decision);
  const color = palette && colorOf(palette, content.color);
  if (!color) {
    throw new CoreError(
      "illegal_transition",
      (palette
        ? `${subject} names the color ${content.color}, which its Palette, ${titled(palette)}, ` +
          `no longer has: the Palette changed after ${subject} was Settled.`
        : `${subject} has no Palette in its Basis, so its color ${content.color} can't be ` +
          "resolved.") +
        " It needs Reopening with the user's yes, saving with a color of the Palette in force, " +
        "and Settling again; then Fulfil it.",
    );
  }
  const { role: _role, note: _note, ...value } = color;
  const applied: BuildingColor = {
    ...value,
    provenance: color.brand && color.code ? "measured" : "estimated",
  };
  const finish = actualFinish ?? content.finish;
  const wall = content.wall === undefined ? undefined : requireWall(model, room, content.wall);
  markFulfilled(
    context,
    writer,
    decision,
    { surface: surfaceSlug(room, content.surface, wall), color: applied, finish },
    finish === content.finish
      ? "Fulfilled"
      : `Fulfilled, in a different finish from what was decided (${content.finish})`,
  );
  const lines = writer.lines.length;
  const surface = saveSurface(model, writer, room, content.surface, wall, {
    color: applied,
    finish,
  });
  if (writer.refused.length > 0) {
    throw new CoreError(
      "weaker_provenance",
      `${writer.refused.map(renderRefused).join("\n")} Nothing was recorded, and ${subject} ` +
        "is not Fulfilled.",
    );
  }
  if (writer.lines.length === lines) {
    writer.line(surface, "already this color and finish, nothing changed");
  }
}

/** "Oak bookcase (oak-bookcase) was Fulfilled on 2026-09-14: what was done is recorded in the Home". */
function fulfilledOn(decision: DecisionRow): string {
  return (
    `${titled(decision)} was Fulfilled on ${day(decision.fulfilledAt ?? "")}: what was done is ` +
    "recorded in the Home"
  );
}

function markFulfilled(
  context: OperationContext,
  writer: Writer,
  decision: DecisionRow,
  fulfilment: Fulfilment,
  head: string,
): void {
  const at = context.now();
  context.store.update("decisions", decision.id, { fulfilledAt: at, fulfilment });
  writer.logged({ recordKind: "decision", record: decision, field: "fulfilledAt", new: at });
  writer.line(titled(decision), head);
}

export const listDecisions = defineOperation({
  name: "list_decisions",
  description:
    "The Home's Decisions, Home-wide ones first and then each Room's, with their open flags and " +
    "Conflicts; filtered by Room, kind, and state. Archived ones on request, marked archivedAt.",
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
    "follow the transitions table and flag the Decisions resting on it in turn; a Fulfilled " +
    "Decision can only be kept.",
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
    "follow the transitions table and flag the Decisions resting on it; a Fulfilled Decision " +
    "can only be kept.",
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
  overrideProvenance?: string,
) {
  const model = loadDecisions(context.store, home);
  const writer = new Writer(context, home, log, overrideProvenance);
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
  guides: GuideRow[];
  listings: ListingRow[];
  listingChecks: ListingCheckRow[];
  deviations: DeviationRow[];
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
    guides: store.list("guides", home.id),
    listings: store.list("listings", home.id),
    listingChecks: store.list("listing_checks", home.id),
    deviations: store.list("deviations", home.id),
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

/** The Design Direction or Palette in force: the Settled one, else the latest Leaning one. */
function inForce(model: DecisionModel, kind: "design-direction" | "palette") {
  const rows = model.decisions.filter((each) => active(each) && each.kind === kind);
  return (
    rows.find((each) => each.state === "settled") ??
    rows.filter((each) => each.state === "leaning").at(-1)
  );
}

/** A Palette's color by name, in any case and spacing. */
function colorOf(palette: DecisionRow, name: string): PaletteColor | undefined {
  return (palette.content as PaletteContent).colors.find((color) => sameName(color.name, name));
}

/**
 * Whether a Decision uses the colors of `palette`, so that Palette, when in force, enters its
 * Basis: a Room color always, and a Decision with a Requirement whose reason is that Palette.
 */
function usesColorsOf(model: DecisionModel, decision: DecisionRow, palette: DecisionRow): boolean {
  if (decision.id === palette.id) return false;
  return (
    decision.kind === "room-color" ||
    model.requirements.some(
      (requirement) =>
        requirement.decisionId === decision.id &&
        requirement.archivedAt === null &&
        requirement.reasonKind === "decision" &&
        requirement.reasonId === palette.id,
    )
  );
}

/** The kinds whose Decision in force joins a Basis automatically. */
type AutomaticKind = "design-direction" | "palette";
const AUTOMATIC_KINDS: readonly AutomaticKind[] = ["design-direction", "palette"];

/**
 * The Decision of `kind` that joins a Decision's Basis automatically now: the Design Direction in
 * force, for every Decision but a Design Direction; the Palette in force, for a Decision using its
 * colors.
 */
function automaticFor(
  model: DecisionModel,
  decision: DecisionRow,
  kind: AutomaticKind,
): DecisionRow | undefined {
  if (kind === "design-direction") {
    return decision.kind === "design-direction" ? undefined : inForce(model, kind);
  }
  const palette = inForce(model, "palette");
  return palette && usesColorsOf(model, decision, palette) ? palette : undefined;
}

/** A Decision's stored automatic entry of `kind`: the Design Direction or Palette it rests on. */
function automaticEntry(
  model: DecisionModel,
  decision: DecisionRow,
  kind: AutomaticKind,
): DecisionBasisRow | undefined {
  return model.basis.find(
    (link) =>
      link.decisionId === decision.id &&
      link.automatic &&
      decisionById(model, link.basisDecisionId).kind === kind,
  );
}

/** The Palette stored in a Decision's Basis. */
function storedPalette(model: DecisionModel, decision: DecisionRow): DecisionRow | undefined {
  const entry = automaticEntry(model, decision, "palette");
  return entry && decisionById(model, entry.basisDecisionId);
}

/** Rejected or Fulfilled: nothing about it is open for review, and its Basis stays as it is. */
function closed(decision: DecisionRow): boolean {
  return decision.state === "rejected" || decision.fulfilledAt !== null;
}

/**
 * A Decision's Basis as stored: its automatic entries first (its Design Direction, then its
 * Palette), then the Decisions given.
 */
function basisOf(model: DecisionModel, decision: DecisionRow) {
  const automatic = AUTOMATIC_KINDS.map((kind) => automaticEntry(model, decision, kind)).filter(
    (link): link is DecisionBasisRow => link !== undefined,
  );
  const given = model.basis.filter((link) => link.decisionId === decision.id && !link.automatic);
  return [...automatic, ...given].map((link) => ({
    row: decisionById(model, link.basisDecisionId),
    automatic: link.automatic,
  }));
}

/**
 * The automatic entries a Decision lacks: a Design Direction or Palette in force that applies to
 * it, and a Room color's Palette always. Each joins on its next save or state change; a Rejected
 * or Fulfilled Decision lacks none, since its Basis stays as it is.
 */
function missingAutomatic(model: DecisionModel, decision: DecisionRow): AutomaticKind[] {
  if (closed(decision)) return [];
  return AUTOMATIC_KINDS.filter(
    (kind) =>
      !automaticEntry(model, decision, kind) &&
      (automaticFor(model, decision, kind) !== undefined ||
        (kind === "palette" && decision.kind === "room-color")),
  );
}

export const openFlags = (model: DecisionModel, decision: DecisionRow) =>
  model.flags.filter((flag) => flag.decisionId === decision.id && flag.clearedAt === null);

const openConflicts = (model: DecisionModel, decision: DecisionRow) =>
  model.conflicts.filter(
    (conflict) => conflict.decisionId === decision.id && conflict.resolvedAt === null,
  );

/** Home-wide Decisions first, then each Room's in the Rooms' order, each in creation order. */
export function sorted(model: DecisionModel, rows: DecisionRow[]): DecisionRow[] {
  const order = new Map(model.rooms.map((room, index) => [room.id, index + 1]));
  const place = (decision: DecisionRow) =>
    decision.scopeRoomId === null ? 0 : (order.get(decision.scopeRoomId) ?? model.rooms.length + 1);
  return [...rows].sort((a, b) => place(a) - place(b) || a.id - b.id);
}

function filterDecisions(
  model: DecisionModel,
  filter: {
    room?: string;
    homeWide?: boolean;
    kind?: DecisionKind;
    state?: DecisionState;
    archived?: boolean;
  },
): DecisionSummary[] {
  const room =
    filter.room === undefined ? undefined : requireRoom(model, filter.room, { archived: true });
  const rows = model.decisions.filter(
    (each) =>
      (filter.archived === true || active(each)) &&
      (room === undefined || each.scopeRoomId === room.id) &&
      (!filter.homeWide || each.scopeRoomId === null) &&
      (filter.kind === undefined || each.kind === filter.kind) &&
      (filter.state === undefined || each.state === filter.state),
  );
  return sorted(model, rows).map((each) => toSummary(model, each));
}

/** The Room Sheet's Decisions: the Room's Candidate, Leaning, and Settled-not-Fulfilled ones. */
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
      each.state === "settled" &&
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
    ...optional({
      colors: row.kind === "palette" ? (row.content as PaletteContent).colors : undefined,
      archivedAt: row.archivedAt,
    }),
  };
}

/** How toDetail shows a Purchase's Guides; the origins make each Quick Guide's phone URL. */
export interface DetailOptions extends PhoneOrigins {
  /** The Full Guide's Markdown in full, not only its state. */
  includeFullGuide?: boolean;
}

export function toDetail(
  model: DecisionModel,
  row: DecisionRow,
  options: DetailOptions = {},
): DecisionDetail {
  const { kind: _, colors: _colors, ...summary } = toSummary(model, row);
  const content = { kind: row.kind, content: row.content } as DecisionKindContent;
  const palette = row.kind === "room-color" ? storedPalette(model, row) : undefined;
  const missing = missingAutomatic(model, row);
  const purchase = row.kind === "purchase";
  return {
    ...summary,
    ...optional({
      fulfilment: row.fulfilment,
      paletteColor: palette && colorOf(palette, (row.content as RoomColorContent).color),
      missingAutomatic: missing.length > 0 ? missing : undefined,
      quickGuide: purchase ? toQuickGuide(model, row) : undefined,
      guides: purchase ? toGuides(model, row, guideOf(model, row), options) : undefined,
    }),
    listings: purchase ? toListings(model, row) : [],
    deviations: purchase ? toDeviations(model, row) : [],
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
  const source =
    row.sourceKind === "decision"
      ? decisionById(model, row.sourceId)
      : reasonRecord(model, row.sourceKind as RequirementReasonKind, row.sourceId);
  const name = source === undefined ? "?" : "title" in source ? source.title : source.name;
  return {
    slug: row.slug,
    decision: { slug: decision.slug, title: decision.title },
    cause: row.cause,
    source: {
      kind: row.sourceKind,
      slug: source?.slug ?? "?",
      name,
      ...optional({ field: row.sourceField }),
    },
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
  const record = reasonRecord(model, row.reasonKind, row.reasonId);
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

/** Kinds of which only one is Settled at a time: in the Home, or in each Room. */
const ONE_SETTLED: Partial<Record<DecisionKind, "home" | "room">> = {
  "design-direction": "home",
  palette: "home",
  "room-direction": "room",
  "room-use": "room",
};

const TRANSITION_HINTS: Record<DecisionState, string> = {
  candidate: "",
  leaning: "",
  settled: " Reopening it (to leaning) or rejecting it needs the user's yes first.",
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
              each.fulfilledAt === null &&
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
    let content =
      input.content === undefined && existing
        ? existing.content
        : validContent(kind, input.content);
    // A Room color's color is checked against the Palette in force whenever its content changes.
    if (kind === "room-color" && scopeRoom && !(existing && equal(existing.content, content))) {
      content = this.#roomColor(scopeRoom, content as RoomColorContent);
    }
    const basis = input.basis === undefined ? undefined : this.#basis(input.basis, existing, kind);
    const evidence = (input.evidence ?? []).map((entry) => this.#evidence(entry, existing));
    const requirements = this.#planRequirements(existing, input.requirements ?? []);
    if (!existing) {
      this.#create(input, scopeRoom, content, basis ?? [], evidence, requirements);
    } else {
      this.#edit(existing, input, room, content, basis, evidence, requirements);
    }
  }

  /**
   * A Room color's content, with its color spelled as the Palette in force spells it. Refused
   * when no Palette is in force, when that Palette has no color of the name (listing its colors),
   * and when a Wall is named for anything but the walls, or is not one of the Room's.
   */
  #roomColor(room: RoomRow, content: RoomColorContent): RoomColorContent {
    const model = this.#model;
    if (content.wall !== undefined) {
      if (content.surface !== "walls") {
        throw new CoreError(
          "validation",
          `A Room color names a Wall only for surface walls, as that one Wall's color. For the ` +
            `${content.surface}, leave wall out.`,
        );
      }
      requireWall(model, room, content.wall);
    }
    const palette = inForce(model, "palette");
    if (!palette) {
      const candidates = model.decisions.filter(
        (each) => active(each) && each.kind === "palette" && each.state === "candidate",
      );
      throw new CoreError(
        "validation",
        "A Room color's color comes from the Palette in force (the Settled Palette, else the " +
          "Leaning one), and this Home has none yet" +
          (candidates.length > 0
            ? ` (only Candidates: ${candidates.map(titled).join(", ")})`
            : "") +
          ". Settle the Palette with the user first (save_decision with kind palette, then lean " +
          "or Settle it), then save the Room color.",
      );
    }
    const color = colorOf(palette, content.color);
    if (!color) {
      const colors = (palette.content as PaletteContent).colors.map(
        (each) => `${each.name} (${each.role})`,
      );
      throw new CoreError(
        "validation",
        `"${content.color}" is not a color of the Palette in force, ${titled(palette)}, ` +
          `${STATES[palette.state]}. Its colors are ${colors.join(", ")}: name one of them. A ` +
          "color the Palette lacks is a change to the Palette first" +
          (palette.state === "settled"
            ? ": Reopen it with the user's yes, add the color, and Settle it again."
            : ": add it to the Palette, with the user."),
      );
    }
    return { ...content, color: color.name };
  }

  /**
   * Moves a Decision by the transitions table, recording the change with its Session and reason.
   * A Reopen or Reject clears the Decision's own flags and Conflicts and flags every Decision
   * resting on it. Its current state keeps it as it is, clearing its flags and Conflicts. Keeping
   * or Reopening it re-bases it where a cleared flag came from its own automatic entry, and any
   * automatic entry it lacks joins, unless it is Rejected or Fulfilled.
   */
  move(decision: DecisionRow, to: DecisionState, reason: string | undefined): void {
    const from = decision.state;
    if (to === from) {
      this.#keep(decision, reason);
      return;
    }
    if (decision.fulfilledAt !== null) {
      throw new CoreError(
        "illegal_transition",
        `${fulfilledOn(decision)}, so it stays Settled and can only be kept. For something new, ` +
          "save a new Decision.",
      );
    }
    const legal = LEGAL_TRANSITIONS[from];
    if (!legal.includes(to)) {
      throw new CoreError(
        "illegal_transition",
        `${titled(decision)} is ${STATES[from]}, and a ${STATES[from]} Decision can move only to ` +
          `${legal.join(" or ")}.${TRANSITION_HINTS[from]}`,
      );
    }
    if (to === "settled") this.#requireOneSettled(decision);
    const model = this.#model;
    const { store } = this.#context;
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
    const reopened = from === "settled" && to === "leaning";
    const rejected = to === "rejected";
    const cleared =
      reopened || rejected
        ? this.#clear(decision, reopened ? "reopen" : "reject", reason)
        : { flags: [], slugs: [] };
    this.#writer.line(
      titled(decision),
      [
        transitionText(from, to),
        cleared.slugs.length > 0 ? `cleared ${cleared.slugs.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
    this.#rebase(decision, reopened ? cleared.flags : [], reason);
    if (reopened || rejected) this.cascade(decision, reopened ? "reopened" : "rejected");
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
      this.#rebase(decision, "flag" in target ? [target.flag] : [], reason);
      return;
    }
    if (resolution === "reopen" && decision.state !== "settled") {
      throw new CoreError(
        "illegal_transition",
        `${titled(decision)} is ${STATES[decision.state]}, not Settled, so it can't be Reopened. ` +
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
    const { flags, slugs } = this.#clear(decision, "keep", reason);
    this.#writer.line(titled(decision), `kept as ${STATES[state]}; cleared ${slugs.join(", ")}`);
    this.#rebase(decision, flags, reason);
  }

  /** Clears every open flag and Conflict of a Decision; returns the flags, and every slug. */
  #clear(
    decision: DecisionRow,
    resolution: Resolution,
    reason: string | undefined,
  ): { flags: FlagRow[]; slugs: string[] } {
    const flags = openFlags(this.#model, decision);
    const conflicts = openConflicts(this.#model, decision);
    for (const flag of flags) this.#clearFlag(flag, resolution, reason);
    for (const conflict of conflicts) this.#resolveConflict(conflict, resolution, reason);
    return { flags, slugs: [...flags, ...conflicts].map((each) => each.slug) };
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
   * Flags every Decision holding `changed` in its stored Basis, automatic or given. Rejected and
   * Fulfilled ones are left alone: nothing about them is open for review.
   */
  cascade(changed: DecisionRow, cause: FlagCause): void {
    const model = this.#model;
    for (const decision of model.decisions) {
      if (decision.id === changed.id || !active(decision) || closed(decision)) continue;
      const rests = model.basis.some(
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
        sourceField: null,
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

  /** One Design Direction and one Palette Settled in the Home; one Room Direction and use per Room. */
  #requireOneSettled(decision: DecisionRow): void {
    const per = ONE_SETTLED[decision.kind];
    if (!per) return;
    const other = this.#model.decisions.find(
      (each) =>
        each.id !== decision.id &&
        active(each) &&
        each.kind === decision.kind &&
        each.state === "settled" &&
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
      `The ${KINDS[decision.kind]} ${titled(other)} is already Settled${where}, and only one is ` +
        `Settled at a time. Reopen or reject it first (asking the user), then Settle ` +
        `${titled(decision)}.`,
    );
  }

  #basis(slugs: string[], self: DecisionRow | undefined, kind: DecisionKind): DecisionRow[] {
    const rows: DecisionRow[] = [];
    for (const slug of slugs) {
      const row = requireDecision(this.#model, slug);
      if (self && row.id === self.id) {
        throw new CoreError(
          "validation",
          `${titled(self)} can't rest on itself: take ${slug} out of basis.`,
        );
      }
      // The Design Direction joins every Basis automatically, and the Palette in force every Room
      // color's and every Basis that already holds it: never listed twice.
      const automatic =
        row.kind === "design-direction" ||
        (row.kind === "palette" &&
          (kind === "room-color" ||
            (self !== undefined &&
              automaticEntry(this.#model, self, "palette")?.basisDecisionId === row.id)));
      if (automatic || rows.includes(row)) continue;
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
      // The same Requirement given again without a position, as a repeated save gives it, is left
      // as it is rather than added twice.
      const repeated =
        input.position === undefined &&
        reason !== undefined &&
        rows.some(
          (each) =>
            each.archivedAt === null &&
            each.text === input.text &&
            each.strength === input.strength &&
            each.reasonKind === reason.kind &&
            each.reasonId === reason.id &&
            each.reasonField === reason.field,
        );
      if (repeated) continue;
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
    // Requirements first, so a Palette they name joins the Basis the receipt shows.
    const requirementLines = this.#applyRequirements(decision, requirements);
    this.#attach(decision);
    const basisText = this.#basisText(decision);
    const parts = [
      `created as a Candidate ${KINDS[input.kind]}` +
        (room ? ` for ${named(room)}` : ", Home-wide"),
      basisText,
      ...this.#joinReasons(decision),
      this.#addEvidence(decision, evidence),
    ];
    this.#writer.line(titled(decision), parts.filter(Boolean).join("; "));
    for (const [subject, head] of requirementLines) this.#writer.line(subject, head);
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
    if (changing && decision.state === "settled") {
      throw new CoreError(
        "illegal_transition",
        `${subject} is Settled, so it takes new Evidence only. To change it, ask the user, ` +
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
    const contentChanged = !equal(decision.content, content);
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
    const requirementLines = this.#applyRequirements(decision, requirements);
    heads.push(...this.#attach(decision, contentChanged || requirementsChanged));
    heads.push(...this.#joinReasons(decision));
    const added = this.#addEvidence(decision, evidence);
    if (added) heads.push(added);
    const nothing = heads.length === 0 && !requirementsChanged;
    writer.line(
      titled(decision),
      nothing ? "already recorded like this, nothing changed" : heads.join("; ") || undefined,
    );
    for (const [subject, head] of requirementLines) writer.line(subject, head);
  }

  /** Replaces the Decisions given as a Decision's Basis; returns whether anything changed. */
  #setBasis(decision: DecisionRow, rows: DecisionRow[]): boolean {
    const model = this.#model;
    const { store } = this.#context;
    const current = model.basis.filter(
      (link) => link.decisionId === decision.id && !link.automatic,
    );
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
          automatic: false,
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

  /**
   * Stores the automatic entries a Decision lacks: the Design Direction and the Palette in force
   * that apply to it. With `recheck`, after its content or Requirements changed, its Palette also
   * becomes the one in force when it now uses that one's colors (a Room color's color was just
   * checked against it). Never takes an entry out. A Rejected or Fulfilled Decision's Basis stays
   * as it is. Returns a receipt text per change.
   */
  #attach(decision: DecisionRow, recheck = false): string[] {
    if (closed(decision)) return [];
    const texts: string[] = [];
    for (const kind of AUTOMATIC_KINDS) {
      if (automaticEntry(this.#model, decision, kind) && !(recheck && kind === "palette")) continue;
      const row = automaticFor(this.#model, decision, kind);
      const text = row && this.#setAutomatic(decision, kind, row, undefined);
      if (text) texts.push(text);
    }
    return texts;
  }

  /**
   * Adds to a Decision's Basis, as given entries, the Decisions its active Requirements' reasons
   * name, so the cascade reaches it when one of them is Reopened, Rejected, or Fulfilled with a
   * Deviation from a must. A Decision already in its Basis stays as it is, and a Design Direction
   * is never given (the one in force is automatic). A Rejected or Fulfilled Decision's Basis
   * stays as it is. Returns a receipt text per Decision added.
   */
  #joinReasons(decision: DecisionRow): string[] {
    if (closed(decision)) return [];
    const model = this.#model;
    const joining = new Map<DecisionRow, number[]>();
    for (const requirement of activeRequirements(model, decision)) {
      if (requirement.reasonKind !== "decision" || requirement.reasonId === decision.id) continue;
      const row = decisionById(model, requirement.reasonId);
      const held = model.basis.some(
        (link) => link.decisionId === decision.id && link.basisDecisionId === row.id,
      );
      if (held || row.kind === "design-direction") continue;
      joining.set(row, [...(joining.get(row) ?? []), requirement.position]);
    }
    if (joining.size === 0) return [];
    const given = () =>
      model.basis
        .filter((link) => link.decisionId === decision.id && !link.automatic)
        .map((link) => decisionById(model, link.basisDecisionId).slug);
    const old = given();
    for (const row of joining.keys()) {
      model.basis.push(
        this.#context.store.insert("decision_basis", {
          homeId: model.home.id,
          decisionId: decision.id,
          basisDecisionId: row.id,
          automatic: false,
        }),
      );
    }
    this.#writer.logged({
      recordKind: "decision",
      record: decision,
      field: "basis",
      old,
      new: given(),
    });
    return [...joining].map(
      ([row, positions]) =>
        `now rests on ${titled(row)}, the reason of Requirement` +
        `${positions.length === 1 ? "" : "s"} ${positions.join(", ")}`,
    );
  }

  /**
   * After a Decision's flags were cleared by keeping or Reopening it, each automatic entry that
   * was the source of one of them gives way to the one of its kind in force now, if any: a flag
   * from a Decision given in its Basis moves nothing. Then any automatic entry it lacks joins.
   * One receipt line per change.
   */
  #rebase(decision: DecisionRow, flags: FlagRow[], reason: string | undefined): void {
    const texts: string[] = [];
    for (const kind of closed(decision) ? [] : AUTOMATIC_KINDS) {
      const entry = automaticEntry(this.#model, decision, kind);
      const source = flags.some(
        (flag) => flag.sourceKind === "decision" && flag.sourceId === entry?.basisDecisionId,
      );
      if (!entry || !source) continue;
      const row = automaticFor(this.#model, decision, kind);
      const text = this.#setAutomatic(decision, kind, row, reason);
      if (text) texts.push(text);
    }
    texts.push(...this.#attach(decision));
    for (const text of texts) this.#writer.line(titled(decision), text);
  }

  /**
   * Makes `row` the Decision's automatic entry of `kind`, replacing the one it held, or with no
   * row takes that entry out; logs the change and returns its receipt text, or undefined when
   * nothing changed. A Decision already given in its Basis becomes automatic, never listed twice.
   */
  #setAutomatic(
    decision: DecisionRow,
    kind: AutomaticKind,
    row: DecisionRow | undefined,
    reason: string | undefined,
  ): string | undefined {
    const model = this.#model;
    const { store } = this.#context;
    const entry = automaticEntry(model, decision, kind);
    const old = entry && decisionById(model, entry.basisDecisionId);
    if (old?.id === row?.id) return undefined;
    if (entry) {
      store.removeBasis(entry.id);
      model.basis.splice(model.basis.indexOf(entry), 1);
    }
    const given =
      row &&
      model.basis.find(
        (link) => link.decisionId === decision.id && link.basisDecisionId === row.id,
      );
    if (given) {
      store.update("decision_basis", given.id, { automatic: true });
      given.automatic = true;
    } else if (row) {
      model.basis.push(
        store.insert("decision_basis", {
          homeId: model.home.id,
          decisionId: decision.id,
          basisDecisionId: row.id,
          automatic: true,
        }),
      );
    }
    this.#writer.logged({
      recordKind: "decision",
      record: decision,
      field: `automatic ${kind}`,
      old: old?.slug,
      new: row?.slug ?? null,
      ...(reason ? { reason } : {}),
    });
    if (row) return `now rests on ${titled(row)}, the ${KINDS[kind]}`;
    const palette = inForce(model, "palette");
    return (
      `no longer rests on ${old ? titled(old) : "?"}, the ${KINDS[kind]}: ` +
      (kind === "palette" && palette
        ? `none of its Requirements names ${titled(palette)}, the Palette in force`
        : `no ${KINDS[kind]} is in force`)
    );
  }

  /**
   * "Basis: Warm minimalism (warm-minimalism), the Design Direction, automatically; Warm clay
   * (warm-clay), the Palette, automatically; …".
   */
  #basisText(decision: DecisionRow): string | undefined {
    const basis = basisOf(this.#model, decision);
    if (basis.length === 0) return undefined;
    return `Basis: ${basis
      .map(({ row, automatic }) =>
        automatic ? `${titled(row)}, the ${KINDS[row.kind]}, automatically` : titled(row),
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

  /**
   * Stores the Requirement steps; returns their receipt lines, for after the Decision's own. Any
   * Requirement added, changed, Archived, or restored after its Full Guide was written marks the
   * Full Guide out of date, until save_guides writes it again.
   */
  #applyRequirements(decision: DecisionRow, steps: RequirementStep[]): [string, string][] {
    const lines = this.#storeRequirements(decision, steps);
    const guide = guideOf(this.#model, decision);
    if (lines.length > 0 && guide?.writtenAt != null && guide.requirementsChangedAt === null) {
      const at = this.#context.now();
      this.#context.store.update("guides", guide.id, { requirementsChangedAt: at });
      guide.requirementsChangedAt = at;
      this.#writer.logged({
        recordKind: "decision",
        record: decision,
        field: "guides requirementsChangedAt",
        new: at,
      });
      lines.push([
        titled(decision),
        "its Full Guide is now out of date: rewrite it with save_guides",
      ]);
    }
    return lines;
  }

  #storeRequirements(decision: DecisionRow, steps: RequirementStep[]): [string, string][] {
    const model = this.#model;
    const { store } = this.#context;
    const lines: [string, string][] = [];
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
        lines.push([subject, `added: ${shown.strength}, ${shown.text} (reason: ${shown.reason})`]);
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
        // A check judged the Requirement as it was: it counts as unchecked until checked again.
        const checks = model.listingChecks.filter((each) => each.requirementId === row.id);
        if (checks.length > 0) {
          const listingOf = (check: ListingCheckRow) =>
            model.listings.find((each) => each.id === check.listingId);
          for (const check of checks) {
            store.removeListingCheck(check.id);
            model.listingChecks.splice(model.listingChecks.indexOf(check), 1);
          }
          this.#writer.logged({
            recordKind: "decision",
            record: decision,
            field: `${field} checks`,
            old: checks.map((check) => ({
              listing: listingOf(check)?.slug,
              result: check.result,
              ...(check.note ? { note: check.note } : {}),
            })),
            new: null,
          });
          const listings = checks.map((check) => {
            const listing = listingOf(check);
            return listing ? named(listing) : "?";
          });
          heads.push(`unchecked on ${listings.join(", ")} until record_listing checks it again`);
        }
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
      if (heads.length > 0) lines.push([subject, heads.join("; ")]);
    }
    return lines;
  }
}

function transitionText(from: DecisionState, to: DecisionState): string {
  if (from === "settled" && to === "leaning") return "Reopened to Leaning, was Settled";
  if (from === "rejected") return "revived to Candidate, was Rejected";
  return `${STATES[to]}, was ${STATES[from]}`;
}

function changedKeys(was: Record<string, unknown>, now: Record<string, unknown>): string {
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])];
  return keys.filter((key) => !equal(was[key] ?? null, now[key] ?? null)).join(", ");
}
