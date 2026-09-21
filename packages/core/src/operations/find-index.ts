import { optional } from "../optional.js";
import { defineOperation } from "../registry.js";
import { featureName } from "../render.js";
import type { DecisionRow, RoomRow } from "../store.js";
import { type DecisionModel, loadDecisions } from "./decisions.js";
import { roomById } from "./model.js";
import { guideOf, hasGuides } from "./purchase-views.js";
import { findIndexInput } from "./schemas.js";
import { requireHome } from "./scope.js";

// The web's search box (docs/handoff/generalized-search.md): every findable record of one Home as
// one flat list, which the browser matches and ranks as the user types. Web-only: the Agent has
// its own finders, and a fourth overlapping one would make it pick wrong.

/** One findable record, as the browser's search index holds it. */
export interface FindRow {
  /** Which kind of record. Drives nothing in the browser except the debug view; see label. */
  kind: "room" | "decision" | "item" | "listing" | "feature";
  /** Unique within its kind. */
  slug: string;
  /** The only text matched against. */
  name: string;
  /** Shown, never matched: "Main bedroom", "Unplaced", "Home-wide", "Main bedroom › Bed frame". */
  where: string;
  /** Path to open, relative to the app root: "/homes/house/rooms/main-bedroom". */
  path: string;
  /** 1 or 2. Declared in core's table, never re-derived in the browser. */
  tier: 1 | 2;
  /** The row's type label: "Room", "Decision", "Item", "Listing", "Feature". */
  label: string;
  /** A state pill when one applies: "Rejected", "Archived", "Locked", "Fulfilled", "Held". */
  state?: string;
  /** Archived or Rejected: always ranked last, always greyed. */
  retired: boolean;
  /** ISO timestamp, MAX(change_log.at) for this record; the ranking tie-break. */
  changedAt: string;
  /** The one secondary target, when the kind has one. */
  also?: { label: string; path: string };
}

/** A record as its kind finds it, before the table adds kind, tier, label, and changedAt. */
interface Found {
  slug: string;
  name: string;
  where: string;
  path: string;
  state?: string | undefined;
  also?: { label: string; path: string } | undefined;
  /** When it came to be, for a record the change log names nowhere. */
  since?: string;
}

export interface FindKind {
  kind: FindRow["kind"];
  tier: 1 | 2;
  label: string;
  /**
   * Every record of the kind, Archived and Rejected ones too: how its name, where, path, state,
   * and side link are found.
   */
  found(model: DecisionModel): Found[];
}

/**
 * The findable kinds, a line each: tier 1 the places you jump to, tier 2 the things inside them.
 * Nothing else is indexed (Notes, Requirements, Guides, Sessions, and the rest were each argued
 * out). A row is retired when its state is Archived or Rejected.
 */
export const FIND_KINDS: readonly FindKind[] = [
  {
    kind: "room",
    tier: 1,
    label: "Room",
    found: (m) =>
      m.rooms.map((room) => ({
        slug: room.slug,
        name: room.name,
        where: m.levels.length > 1 ? (m.levels.find((l) => l.id === room.levelId)?.name ?? "") : "",
        path: roomPath(m, room),
        state: archived(room),
      })),
  },
  {
    kind: "decision",
    tier: 1,
    label: "Decision",
    found: (m) =>
      m.decisions.map((decision) => ({
        slug: decision.slug,
        name: decision.title,
        where: scopeName(m, decision),
        path: decisionPath(m, decision),
        state: archived(decision) ?? decisionState(decision),
        also: quickGuide(m, decision),
        since: decision.createdAt,
      })),
  },
  {
    kind: "item",
    tier: 1,
    label: "Item",
    found: (m) =>
      m.items.map((item) => ({
        slug: item.slug,
        name: item.name,
        where: item.roomId === null ? "Unplaced" : roomById(m, item.roomId).name,
        path: `/homes/${m.home.slug}/items`,
        state: archived(item),
      })),
  },
  {
    kind: "listing",
    tier: 2,
    label: "Listing",
    found: (m) =>
      m.listings.map((listing) => {
        const decision = decisionById(m, listing.decisionId);
        return {
          slug: listing.slug,
          name: listing.name,
          where: `${scopeName(m, decision)} › ${decision.title}`,
          path: `${decisionPath(m, decision)}#listings`,
          state: listing.heldAt === null ? undefined : "Held",
          since: listing.recordedAt,
        };
      }),
  },
  {
    kind: "feature",
    tier: 2,
    label: "Feature",
    found: (m) =>
      m.features.map((feature) => {
        const room = roomById(m, feature.roomId);
        return {
          slug: feature.slug,
          // featureName already is the description for an "other"; the rest read "Radiator — …".
          name:
            feature.kind !== "other" && feature.description
              ? `${featureName(feature.kind)} — ${feature.description}`
              : featureName(feature.kind, feature.description ?? undefined),
          where: room.name,
          path: roomPath(m, room),
          state: archived(feature),
        };
      }),
  },
];

const RETIRED_STATES: ReadonlySet<string> = new Set(["Archived", "Rejected"]);

export const findIndex = defineOperation({
  name: "find_index",
  description:
    "The web's search index: every Room, Decision, Item, Listing, and Feature of the Home, " +
    "Archived and Rejected ones too, each with its name, where it is, the path to open, its " +
    "tier, and when it last changed. The browser matches and ranks them.",
  input: findIndexInput,
  readOnly: true,
  surface: "web",
  handler(context): FindRow[] {
    const home = requireHome(context);
    const model = loadDecisions(context.store, home);
    const changes = context.store.lastChanges(home.id);
    const last = new Map(changes.map((each) => [`${each.recordKind} ${each.recordSlug}`, each.at]));
    // For a record the change log names nowhere and that has no time of its own.
    const earliest = changes.reduce<string | undefined>(
      (min, each) => (min === undefined || each.at < min ? each.at : min),
      undefined,
    );
    return FIND_KINDS.flatMap(({ kind, tier, label, found }) =>
      found(model).map(
        ({ since, state, also, ...record }): FindRow => ({
          kind,
          ...record,
          tier,
          label,
          ...optional({ state, also }),
          retired: state !== undefined && RETIRED_STATES.has(state),
          changedAt: last.get(`${kind} ${record.slug}`) ?? since ?? earliest ?? context.now(),
        }),
      ),
    );
  },
});

const archived = (row: { archivedAt: string | null }): string | undefined =>
  row.archivedAt === null ? undefined : "Archived";

function decisionState(decision: DecisionRow): string | undefined {
  if (decision.state === "rejected") return "Rejected";
  if (decision.fulfilledAt !== null) return "Fulfilled";
  if (decision.state === "locked") return "Locked";
  return undefined;
}

/** The Quick Guide side link, for a Decision with Guides; a Rejected one has none to open. */
function quickGuide(
  model: DecisionModel,
  decision: DecisionRow,
): { label: string; path: string } | undefined {
  if (decision.state === "rejected" || !hasGuides(guideOf(model, decision))) return undefined;
  return { label: "Quick Guide", path: `${decisionPath(model, decision)}#quick-guide` };
}

function scopeName(model: DecisionModel, decision: DecisionRow): string {
  return decision.scopeRoomId === null ? "Home-wide" : roomById(model, decision.scopeRoomId).name;
}

const roomPath = (model: DecisionModel, room: RoomRow) =>
  `/homes/${model.home.slug}/rooms/${room.slug}`;

const decisionPath = (model: DecisionModel, decision: DecisionRow) =>
  `/homes/${model.home.slug}/decisions/${decision.slug}`;

function decisionById(model: DecisionModel, id: number): DecisionRow {
  const decision = model.decisions.find((each) => each.id === id);
  if (!decision) throw new Error(`Decision ${id} is not in Home ${model.home.slug}`);
  return decision;
}
