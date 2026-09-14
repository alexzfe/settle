// The text the AI reads. Rules from docs/specs/home-model.md#context-tiers: leave out empty
// fields, mark Estimated values with ~, and name records by their names with their readable slugs
// in brackets, never database ids.
import type {
  Blueprint,
  Color,
  Constraint,
  DecisionDetail,
  DecisionKind,
  DecisionKindContent,
  DecisionState,
  DecisionSummary,
  Door,
  EvidenceEntry,
  Feature,
  FeatureKind,
  Flag,
  FlagCause,
  Fulfilment,
  Home,
  Item,
  Level,
  Light,
  Material,
  Measurement,
  Note,
  PlannedStay,
  Provenance,
  Requirement,
  RoomDetail,
  Surface,
  ViewImagesResult,
  Wall,
  Window,
} from "./operations/schemas.js";

export interface NamedRecord {
  name: string;
  slug: string;
}

export interface OverviewView {
  home: Home;
  /** In storey order. */
  levels: Level[];
  /** The Constraints in force, not the Archived ones. */
  constraints: Constraint[];
  unplacedItems: number;
  /** In the order they were uploaded. */
  blueprints: Blueprint[];
  /** The Rooms not Archived, in the Overview's order. */
  rooms: RoomDetail[];
}

/**
 * The Home-wide Decisions in force: the Design Direction and Palette in full, whichever of each is
 * furthest along (Locked, else Leaning), or how many Candidates there are when none is; then every
 * other Home-wide Decision that is Locked and not Fulfilled.
 */
export interface HomeDecisionsView {
  designDirection?: DecisionDetail;
  designDirectionCandidates: number;
  palette?: DecisionDetail;
  paletteCandidates: number;
  others: DecisionSummary[];
}

export interface OpeningView {
  overview: OverviewView;
  decisions: HomeDecisionsView;
  /** The Decisions with an open flag or Conflict. */
  flagged: DecisionSummary[];
}

/**
 * The parts of the opening, each delivered once per Session: the Home Overview, the Home-wide
 * Decisions (every Skill but Home Intake), and the open flags and Conflicts.
 */
export type OpeningBlock = "overview" | "decisions" | "flags";

const OPENING_ORDER: readonly OpeningBlock[] = ["overview", "decisions", "flags"];

/** The opening's blocks in `blocks`, in their fixed order; empty when there are none. */
export function renderOpening(view: OpeningView, blocks: readonly OpeningBlock[]): string {
  return OPENING_ORDER.filter((block) => blocks.includes(block))
    .map((block) =>
      block === "overview"
        ? renderHomeOverview(view.overview)
        : block === "decisions"
          ? renderHomeDecisions(view.decisions)
          : renderFlagged(view.flagged),
    )
    .filter((text) => text !== "")
    .join("\n\n");
}

// ─── The Home Overview ──────────────────────────────────────────────────────────────────────

/**
 * The Home's name and its Home Overview: its facts, its Constraints, a count of Unplaced Items,
 * its Blueprints with the Level each page shows, and one line per Room with its Gaps.
 */
export function renderHomeOverview({
  home,
  levels,
  constraints,
  unplacedItems,
  blueprints,
  rooms,
}: OverviewView): string {
  const lines = [
    `Home: ${home.name}`,
    `Location: ${home.city}, ${home.country} (latitude ${formatLatitude(home.latitude)})`,
  ];
  const tenure = join(", ", [
    home.tenure,
    home.plannedStay && `planned stay ${PLANNED_STAYS[home.plannedStay]}`,
  ]);
  if (tenure) lines.push(`Tenure: ${tenure}`);
  const building = join(", ", [home.buildingType, home.buildingEra]);
  if (building) lines.push(`Building: ${building}`);
  const lift = liftText(home);
  if (lift) lines.push(`Lift: ${lift}`);
  const access = join(", ", [home.accessWidth && length(home.accessWidth), home.accessNote]);
  if (access) lines.push(`Narrowest access: ${access}`);
  if (levels.length > 0) {
    lines.push(
      `Levels: ${levels.map((level) => `${level.name} (${level.slug}, storey ${level.storey})`).join(", ")}`,
    );
  }
  if (constraints.length > 0) {
    lines.push("", "Constraints:");
    for (const constraint of constraints)
      lines.push(`- ${named({ name: constraint.text, slug: constraint.slug })}`);
  }
  if (unplacedItems > 0) lines.push("", `Unplaced Items: ${unplacedItems}`);
  if (blueprints.length > 0) {
    lines.push("", "Blueprints:");
    for (const blueprint of blueprints) lines.push(`- ${blueprintLine(blueprint)}`);
  }
  lines.push("");
  if (rooms.length === 0) {
    lines.push("Rooms: none recorded yet");
  } else {
    lines.push("Rooms:");
    for (const room of rooms) lines.push(`- ${roomLine(room)}`);
  }
  return lines.join("\n");
}

/**
 * One Room of the Overview: name, Level, functions, size, ceiling height, window facings, times
 * of use, Item count, and Gaps.
 */
function roomLine(room: RoomDetail): string {
  const facings = windowFacings(room);
  const parts = [
    room.level.name,
    room.outdoor ? "outdoor" : undefined,
    room.functions.join(", "),
    roomSize(room.walls),
    room.ceilingHeight && `ceiling ${length(room.ceilingHeight)}`,
    facings.length > 0 ? `windows ${facings.join(", ")}` : undefined,
    room.windowless && room.windows.length === 0 ? "windowless" : undefined,
    room.timesOfUse.length > 0 ? `used ${room.timesOfUse.join(", ")}` : undefined,
    room.items.length > 0 ? count(room.items.length, "Item") : undefined,
    room.gaps.length > 0 ? `Gaps: ${room.gaps.join(", ")}` : undefined,
  ];
  return `${named(room)}: ${join("; ", parts)}`;
}

/** "4.20 × ~3.60 m" for a four-Walled Room; each Wall's length otherwise. */
function roomSize(walls: Wall[]): string | undefined {
  if (!walls.some((wall) => wall.length)) return undefined;
  const bare = (wall: Wall | undefined) => (wall?.length ? lengthNumber(wall.length) : "?");
  if (walls.length === 4) {
    const [a, b, c, d] = walls;
    return `${bare(a?.length ? a : c)} × ${bare(b?.length ? b : d)} m`;
  }
  return `walls ${walls.map(bare).join(", ")} m`;
}

/** The compass directions the Room's Windows face, in Wall order; "roof" for a skylight. */
function windowFacings(room: RoomDetail): string[] {
  const facings = room.windows.map((window) => {
    if (window.wall === "roof")
      return window.roofFacing ? `roof ${compass(window.roofFacing)}` : "roof";
    const facing = room.walls.find((wall) => wall.slug === window.wall)?.facing;
    return facing && compass(facing);
  });
  return [...new Set(facings.filter((facing) => facing !== undefined))];
}

// ─── The Room Sheet ─────────────────────────────────────────────────────────────────────────

/**
 * Everything recorded about one Room: its facts, Walls, Windows, Doors, Surfaces, Features,
 * lights, one line per Item, one line per Decision (those given: Candidate, Leaning, and Locked
 * but not Fulfilled), and its Gaps. With `sources`, every value printed on a Blueprint is
 * followed by its Blueprint, page, and the text as printed: 1.80 m [agent-plan p.1: 5'11"].
 */
export function renderRoomSheet(
  room: RoomDetail,
  { sources = false, decisions = [] }: { sources?: boolean; decisions?: DecisionSummary[] } = {},
): string {
  const lines = [`Room: ${named(room)}`, `Level: ${room.level.name} (storey ${room.level.storey})`];
  if (room.archivedAt) {
    lines.push(`Archived: ${join(", ", [day(room.archivedAt), room.archivedReason])}`);
  }
  if (room.outdoor) lines.push("Outdoor: yes");
  if (room.functions.length > 0) lines.push(`Functions: ${room.functions.join(", ")}`);
  if (room.ceilingHeight) lines.push(`Ceiling height: ${measure(room.ceilingHeight, sources)}`);
  if (room.timesOfUse.length > 0) lines.push(`Times of use: ${room.timesOfUse.join(", ")}`);
  if (room.windowless) lines.push("Windowless: yes");

  section(
    lines,
    "Walls, clockwise",
    room.walls.map((wall) => wallLine(wall, sources)),
  );
  section(
    lines,
    "Windows",
    room.windows.map((window) => windowLine(window, sources)),
  );
  section(
    lines,
    "Doors",
    room.doors.map((door) => doorLine(door, sources)),
  );
  section(
    lines,
    "Surfaces",
    room.surfaces.map((surface) => `${surface.part}: ${surfaceText(surface)}`),
  );
  section(
    lines,
    "Features",
    room.features.map((feature) => featureLine(feature, sources)),
  );
  section(
    lines,
    "Lights",
    room.lights.map(
      (light) =>
        `${named(light)}, ${light.source === "item" ? "Item" : "Feature"}: ${lightText(light.light)}`,
    ),
  );
  section(
    lines,
    "Items",
    room.items.map((item) => itemLine(item, false, sources)),
  );
  section(
    lines,
    "Decisions",
    decisions.map((decision) => decisionLine(decision, false)),
  );
  lines.push("", room.gaps.length > 0 ? `Gaps: ${room.gaps.join(", ")}` : "Gaps: none");
  return lines.join("\n");
}

function section(lines: string[], title: string, entries: string[]): void {
  if (entries.length === 0) return;
  lines.push("", `${title}:`, ...entries.map((entry) => `- ${entry}`));
}

function wallLine(wall: Wall, sources: boolean): string {
  const beyond =
    wall.beyond.kind === "outside"
      ? "outside"
      : wall.beyond.room
        ? `beyond ${named(wall.beyond.room)}${wall.beyond.room.outdoor ? ", outdoor" : ""}`
        : undefined;
  const sky = wall.obstruction && OBSTRUCTIONS[wall.obstruction];
  return entry(
    wall.slug,
    join("; ", [
      wall.length && measure(wall.length, sources),
      wall.facing && `faces ${compass(wall.facing)}`,
      beyond,
      join(" ", [sky, wall.deciduous ? "by deciduous trees" : undefined]),
      wall.label && `"${wall.label}"`,
      wall.surface && `Surface: ${surfaceText(wall.surface)}`,
    ]),
  );
}

/** "subject: details", or the subject alone when nothing is recorded about it. */
function entry(subject: string, details: string): string {
  return details ? `${subject}: ${details}` : subject;
}

function windowLine(window: Window, sources: boolean): string {
  const where =
    window.wall === "roof"
      ? `in the roof${window.roofFacing ? `, facing ${compass(window.roofFacing)}` : ""}`
      : `in ${window.wall}`;
  return `${window.slug}: ${join("; ", [
    where,
    window.kind === "bay" ? "bay" : undefined,
    size(
      [
        ["W", window.width],
        ["H", window.height],
      ],
      sources,
    ),
    window.sillHeight && `sill ${measure(window.sillHeight, sources)}`,
    window.offset && `${measure(window.offset, sources)} from the Wall's start`,
    window.glass && window.glass !== "clear" ? `${window.glass} glass` : undefined,
  ])}`;
}

function doorLine(door: Door, sources: boolean): string {
  const to =
    door.to === "outside"
      ? "to outside"
      : door.otherRoom
        ? `to ${named(door.otherRoom)}${door.otherWall ? ` at ${door.otherWall}` : ""}${door.to === "outdoor-room" ? ", outdoor" : ""}`
        : "to an unknown side";
  return `${door.slug}: ${join("; ", [
    join(", ", [door.wall ? `in ${door.wall}` : undefined, to]),
    door.clearWidth && `clear width ${measure(door.clearWidth, sources)}`,
    door.height && `height ${measure(door.height, sources)}`,
    door.sideA && door.offset
      ? `${measure(door.offset, sources)} from the Wall's start`
      : undefined,
    door.glazed ? "glazed" : undefined,
    door.noDoor ? "no door hanging" : undefined,
  ])}`;
}

function featureLine(feature: Feature, sources: boolean): string {
  const name = featureName(feature.kind, feature.description);
  return entry(
    named({ name, slug: feature.slug }),
    join("; ", [
      feature.kind !== "other" ? feature.description : undefined,
      join(", ", [feature.wall && `on ${feature.wall}`, feature.positionNote]),
      size(
        [
          ["W", feature.width],
          ["H", feature.height],
          ["D", feature.depth],
        ],
        sources,
      ),
    ]),
  );
}

// ─── Items and Notes ────────────────────────────────────────────────────────────────────────

/**
 * One Item: where it is (with `where`), what it is, its size, colors, and materials; with
 * `sources`, where its Blueprint sizes are printed.
 */
export function itemLine(item: Item, where: boolean, sources = false): string {
  const location = where
    ? item.room
      ? join(", ", [
          `in ${named(item.room)}`,
          item.wall && `against ${item.wall}`,
          item.positionNote,
        ])
      : "Unplaced"
    : join(", ", [item.wall && `against ${item.wall}`, item.positionNote]);
  const line = `${named(item)}: ${join("; ", [
    item.category.replaceAll("-", " "),
    item.quantity > 1 ? `×${item.quantity}` : undefined,
    location,
    size(
      [
        ["W", item.width],
        ["D", item.depth],
        ["H", item.height],
      ],
      sources,
    ),
    item.colors?.map(colorText).join(", "),
    item.materials?.join(", "),
    item.condition,
    join(" ", [item.brand, item.model]),
    item.price,
    item.archivedAt && `Archived ${join(": ", [day(item.archivedAt), item.archivedReason])}`,
  ])}`;
  return line;
}

/** find_items: one line per Item, with where it is. */
export function renderItems(items: Item[]): string {
  if (items.length === 0) return "No Items match.";
  return items.map((item) => `- ${itemLine(item, true)}`).join("\n");
}

/** search_notes: one line per Note, with the day it was written. */
export function renderNotes(notes: Note[]): string {
  if (notes.length === 0) return "No Notes match.";
  return notes.map((note) => `- ${note.text} (${note.slug}), ${day(note.createdAt)}`).join("\n");
}

// ─── Decisions ──────────────────────────────────────────────────────────────────────────────

export const DECISION_KIND_LABELS: Record<DecisionKind, string> = {
  "design-direction": "Design Direction",
  "room-direction": "Room Direction",
  "room-use": "Room use",
  palette: "Palette",
  "room-color": "Room color",
  purchase: "Purchase",
  other: "Other",
};

export const DECISION_STATE_LABELS: Record<DecisionState, string> = {
  candidate: "Candidate",
  leaning: "Leaning",
  locked: "Locked",
  rejected: "Rejected",
};

/** A Decision by its title and slug: "Warm minimalism (warm-minimalism)". */
export function titled(decision: { title: string; slug: string }): string {
  return named({ name: decision.title, slug: decision.slug });
}

/**
 * One Decision on one line: title and slug, kind, state, when it was Fulfilled, with `scope` the
 * Room it is about or Home-wide, its open flags and Conflicts, then its one-line statement.
 */
export function decisionLine(decision: DecisionSummary, scope: boolean): string {
  const parts = [
    `${DECISION_KIND_LABELS[decision.kind]}, ${DECISION_STATE_LABELS[decision.state]}` +
      (decision.fulfilledAt ? `, Fulfilled ${day(decision.fulfilledAt)}` : ""),
    scope ? (decision.room ? named(decision.room) : "Home-wide") : undefined,
    decision.openFlags.length > 0 ? count(decision.openFlags.length, "open flag") : undefined,
    decision.openConflicts.length > 0
      ? count(decision.openConflicts.length, "open Conflict")
      : undefined,
  ];
  return `${titled(decision)}: ${join("; ", parts)}. ${decision.statement}`;
}

/** find_decisions: one line per Decision, with its scope. */
export function renderDecisions(decisions: DecisionSummary[]): string {
  if (decisions.length === 0) return "No Decisions match.";
  return decisions.map((decision) => `- ${decisionLine(decision, true)}`).join("\n");
}

/**
 * The opening's Home-wide Decisions: the Design Direction and the Palette in full, each marked
 * with its state (or a count of Candidates when none is chosen), then the other Home-wide Locked
 * Decisions not yet Fulfilled, one line each.
 */
export function renderHomeDecisions(view: HomeDecisionsView): string {
  const lines = [
    "Home-wide Decisions in force:",
    "",
    ...inFull("Design Direction", view.designDirection, view.designDirectionCandidates),
    "",
    ...inFull("Palette", view.palette, view.paletteCandidates),
  ];
  if (view.others.length > 0) {
    lines.push("", "Other Home-wide Decisions, Locked:");
    for (const decision of view.others) lines.push(`- ${decisionLine(decision, false)}`);
  }
  return lines.join("\n");
}

function inFull(label: string, decision: DecisionDetail | undefined, candidates: number): string[] {
  if (!decision) {
    return [
      `${label}: none chosen yet` +
        (candidates > 0 ? `; ${count(candidates, "Candidate")} (find_decisions lists them)` : ""),
    ];
  }
  return [
    `${label}: ${titled(decision)}, ${DECISION_STATE_LABELS[decision.state]}`,
    decision.statement,
    ...contentLines(decision),
  ];
}

/** The opening's open flags and Conflicts, one line each, with the flagged Decision's scope. */
export function renderFlagged(decisions: DecisionSummary[]): string {
  if (decisions.length === 0) return "";
  const lines = ["Open flags and Conflicts:"];
  for (const decision of decisions) {
    const subject = `${titled(decision)}, ${decision.room ? named(decision.room) : "Home-wide"}`;
    for (const flag of decision.openFlags) {
      lines.push(`- ${subject}: flagged on ${day(flag.raisedAt)}, ${flagCause(flag)}`);
    }
    for (const conflict of decision.openConflicts) {
      lines.push(
        `- ${subject}: Conflict raised on ${day(conflict.raisedAt)}: ${conflict.description}`,
      );
    }
  }
  return lines.join("\n");
}

const FLAG_CAUSES: Record<FlagCause, string> = {
  reopened: "was reopened",
  rejected: "was rejected",
  deviation: "was Fulfilled with a Deviation from a must Requirement",
  value_changed: "changed",
};

function flagCause(flag: Flag): string {
  return `${named(flag.source)} ${FLAG_CAUSES[flag.cause]}`;
}

/**
 * get_decision: one Decision in full: its kind, scope, state, statement, content, Requirements,
 * open flags and Conflicts, then one line per Basis and Evidence entry.
 */
export function renderDecision(decision: DecisionDetail): string {
  const lines = [
    `Decision: ${titled(decision)}`,
    `Kind: ${DECISION_KIND_LABELS[decision.kind]}`,
    `Scope: ${decision.room ? named(decision.room) : "the whole Home"}`,
    `State: ${DECISION_STATE_LABELS[decision.state]}`,
  ];
  if (decision.fulfilledAt) {
    lines.push(
      `Fulfilled: ${join("; ", [day(decision.fulfilledAt), fulfilmentText(decision.fulfilment)])}`,
    );
  }
  lines.push(`Statement: ${decision.statement}`);
  const content = contentLines(decision);
  if (content.length > 0) lines.push("", "Content:", ...content);
  if (decision.requirements.length > 0) {
    lines.push("", "Requirements:", ...decision.requirements.map(requirementLine));
  }
  section(
    lines,
    "Open flags",
    decision.openFlags.map((flag) => `${flag.slug}: ${flagCause(flag)} on ${day(flag.raisedAt)}`),
  );
  section(
    lines,
    "Open Conflicts",
    decision.openConflicts.map(
      (conflict) => `${conflict.slug}: ${conflict.description} (raised ${day(conflict.raisedAt)})`,
    ),
  );
  section(
    lines,
    "Basis",
    decision.basis.map(
      (entry) =>
        `${titled(entry)}: ${DECISION_KIND_LABELS[entry.kind]}, ${DECISION_STATE_LABELS[entry.state]}` +
        (entry.fulfilledAt ? `, Fulfilled ${day(entry.fulfilledAt)}` : "") +
        (entry.automatic ? "; in every Basis as the Design Direction" : ""),
    ),
  );
  section(lines, "Evidence", decision.evidence.map(evidenceLine));
  return lines.join("\n");
}

/** A Decision's content, one line per field, in the kind's own order. */
function contentLines(decision: DecisionKindContent): string[] {
  const out: (string | false | undefined)[] = [];
  switch (decision.kind) {
    case "design-direction": {
      const { content } = decision;
      out.push(
        content.mood && `- Mood: ${content.mood}`,
        content.temperature && `- Color temperature: ${content.temperature}`,
        content.contrast && `- Contrast: ${content.contrast}`,
        !!content.keyMaterials?.length && `- Key materials: ${content.keyMaterials.join(", ")}`,
        !!content.styleReferences?.length &&
          `- Style references: ${content.styleReferences.join("; ")}`,
      );
      if (content.principles?.length) {
        out.push("- Principles:", ...content.principles.map((principle) => `  - ${principle}`));
      }
      break;
    }
    case "room-direction": {
      const { content } = decision;
      out.push(
        `- Direction: ${content.direction}`,
        content.mood && `- Mood, overriding the Design Direction's: ${content.mood}`,
        content.contrast && `- Contrast, overriding the Design Direction's: ${content.contrast}`,
      );
      break;
    }
    case "room-use":
      out.push(`- Functions: ${decision.content.functions.join(", ")}`);
      break;
    case "palette":
      out.push(
        "- Colors:",
        ...decision.content.colors.map(
          (color) => `  - ${color.role}: ${colorText(color)}${color.note ? `; ${color.note}` : ""}`,
        ),
      );
      break;
    case "room-color": {
      const { content } = decision;
      out.push(
        `- Surface: ${content.wall ? `Wall ${content.wall}` : content.surface}`,
        `- Color: ${content.color}`,
        `- Finish: ${content.finish}`,
      );
      break;
    }
  }
  return out.filter((each): each is string => typeof each === "string");
}

function requirementLine(requirement: Requirement): string {
  const { reason } = requirement;
  const what =
    reason.name === reason.id ? reason.id : named({ name: reason.name, slug: reason.id });
  const noun = reason.kind.charAt(0).toUpperCase() + reason.kind.slice(1);
  return (
    `${requirement.position}. ${requirement.strength}: ${requirement.text} ` +
    `(reason: ${noun} ${what}${reason.field ? `, ${reason.field}` : ""})`
  );
}

function evidenceLine(evidence: EvidenceEntry): string {
  const source =
    evidence.kind === "note"
      ? `Note "${evidence.name}" (${evidence.id})`
      : evidence.kind === "session"
        ? `Session ${evidence.id}, ${evidence.name}`
        : `Decision ${named({ name: evidence.name, slug: evidence.id })}`;
  return `${evidence.stance}: ${source}${evidence.note ? `: ${evidence.note}` : ""}`;
}

function fulfilmentText(fulfilment: Fulfilment | undefined): string | undefined {
  return fulfilment?.roomFunctions && `functions ${fulfilment.roomFunctions.join(", ")}`;
}

// ─── Blueprints ─────────────────────────────────────────────────────────────────────────────

/** One Blueprint of the Overview: its pages, and the Level each shows. */
function blueprintLine(blueprint: Blueprint): string {
  const pages = blueprint.pages.map(
    (page) => `p.${page.page} ${page.level?.name ?? "no Level yet"}`,
  );
  return `${named({ name: blueprint.label, slug: blueprint.slug })}: ${count(blueprint.pageCount, "page")}; ${pages.join(", ")}`;
}

/**
 * view_images' text block, which comes before the images: the Blueprint, then one line per image
 * in the images' order, with the Level the page shows and whether it has a text layer.
 */
export function renderViewedPages({ blueprint, pages }: ViewImagesResult): string {
  const lines = [
    `Blueprint: ${named({ name: blueprint.label, slug: blueprint.slug })}, ` +
      `${count(blueprint.pageCount, "page")}. One image per page follows, in this order:`,
  ];
  for (const page of pages) {
    const what = page.crop
      ? `Page ${page.page}, ${page.crop} quarter at twice the scale`
      : `Page ${page.page}`;
    lines.push(
      `- ${what}: ${join("; ", [
        page.level ? `shows ${named(page.level)}` : "no Level mapped yet",
        page.hasText ? "has a text layer" : "no text layer (an image or a scan)",
      ])}`,
    );
  }
  return lines.join("\n");
}

// ─── Receipts ───────────────────────────────────────────────────────────────────────────────

/** One changed field of a record. `value` and `was` are the field's values, or labels for links. */
export interface FieldChange {
  field: string;
  value: unknown;
  was?: unknown;
  /** Stored over a stronger Provenance because the user said so. */
  override?: boolean;
}

/** One record a write touched: "Kitchen (kitchen): created on Ground; ceiling height 2.50 m". */
export interface ReceiptLine {
  subject: string;
  head?: string;
  fields?: FieldChange[];
}

/** A part of a write that was not stored, with the stronger value it would have replaced. */
export interface RefusedPart {
  subject: string;
  field: string;
  value: unknown;
  kept?: unknown;
  /** Why, when it is not the Provenance rule. */
  reason?: string;
}

/** A Decision a write flagged, because a Decision in its Basis changed. */
export interface FlaggedDecision {
  decision: NamedRecord;
  source: NamedRecord;
  cause: FlagCause;
}

export interface Receipt {
  lines: ReceiptLine[];
  refused: RefusedPart[];
  /** The touched Rooms' remaining Gaps. */
  gaps: { room: NamedRecord; gaps: string[] }[];
  /** The Decisions the write flagged. */
  flagged?: FlaggedDecision[];
}

/**
 * A write's receipt: one line per change, never the record it wrote; then any refused part with
 * its reason; then the Decisions it flagged; then the touched Rooms' remaining Gaps.
 */
export function renderReceipt({ lines, refused, gaps, flagged = [] }: Receipt): string {
  const out = lines
    .map((line) => join("; ", [line.head, ...(line.fields ?? []).map(fieldText)]))
    .map((text, index) => (text ? `${lines[index]?.subject}: ${text}` : undefined))
    .filter((text) => text !== undefined);
  out.push(...refused.map(renderRefused));
  for (const each of flagged) {
    out.push(
      `Flagged for review: ${named(each.decision)}, which rests on ${named(each.source)}, ` +
        `now ${each.cause === "reopened" ? "reopened" : "rejected"}`,
    );
  }
  if (out.length === 0) out.push("Nothing changed.");
  for (const room of gaps) {
    out.push(
      room.gaps.length > 0
        ? `Gaps left in ${named(room.room)}: ${room.gaps.join(", ")}`
        : `${named(room.room)}: no Gaps left`,
    );
  }
  return out.join("\n");
}

/** A refused part: both values with their Provenance, and how the user can override. */
export function renderRefused(part: RefusedPart): string {
  const what = `${part.subject} ${label(part.field)} ${value(part.field, part.value)}`;
  if (part.reason) return `Refused: ${what}: ${part.reason}`;
  return (
    `Refused: ${what}. The recorded ${value(part.field, part.kept)} is stronger, so it stays. ` +
    "If the user says to replace it, call again with overrideProvenance quoting their words."
  );
}

const LABELS: Record<string, string> = {
  ceilingHeight: "ceiling height",
  timesOfUse: "used",
  sillHeight: "sill",
  clearWidth: "clear width",
  facing: "faces",
  roofFacing: "roof faces",
  positionNote: "position",
  plannedStay: "planned stay",
  buildingType: "building type",
  buildingEra: "building era",
  liftDoorWidth: "lift door width",
  liftCarDepth: "lift car depth",
  accessWidth: "narrowest access width",
  accessNote: "narrowest access",
  otherRoom: "to",
  otherWall: "other side at",
  wall: "on",
  room: "moved to",
};

const BOOLEANS: Record<string, [string, string]> = {
  outdoor: ["outdoor", "not outdoor"],
  windowless: ["windowless", "has Windows"],
  glazed: ["glazed", "not glazed"],
  noDoor: ["no door hanging", "a door hangs in it"],
  deciduous: ["deciduous trees", "no deciduous trees"],
  lift: ["a lift", "no lift"],
  unplaced: ["moved out of its Room: now Unplaced", "placed"],
};

const label = (field: string) =>
  LABELS[field] ?? field.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);

function fieldText(change: FieldChange): string {
  if (change.field === "name") return `renamed from ${String(change.was)}`;
  const pair = BOOLEANS[change.field];
  if (pair && typeof change.value === "boolean") return change.value ? pair[0] : pair[1];
  const text = `${label(change.field)} ${value(change.field, change.value)}`;
  if (change.was === undefined || !(isMeasurement(change.was) || isColor(change.was))) return text;
  const was = value(change.field, change.was);
  return change.override ? `${text}, replacing ${was} as the user said` : `${text}, was ${was}`;
}

/** A field's value as a receipt shows it: lengths and colors with their Provenance. */
function value(field: string, raw: unknown): string {
  if (isMeasurement(raw)) return `${length(raw)} (${provenanceText(raw)})`;
  if (isColor(raw)) return `${colorText(raw)} (${PROVENANCE[raw.provenance]})`;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "none";
    return raw
      .map((each) => (isMaterial(each) ? materialText(each) : value(field, each)))
      .join(", ");
  }
  if (typeof raw === "object" && raw !== null) return lightText(raw as Light);
  if (field === "facing" || field === "roofFacing") return compass(String(raw));
  if (field === "plannedStay") return PLANNED_STAYS[raw as PlannedStay] ?? String(raw);
  if (field === "kind" && String(raw) in FEATURE_NAMES) {
    return featureName(raw as FeatureKind).toLowerCase();
  }
  if (field === "category") return String(raw).replaceAll("-", " ");
  return String(raw);
}

// ─── Values ─────────────────────────────────────────────────────────────────────────────────

const PROVENANCE: Record<Provenance, string> = {
  measured: "Measured",
  blueprint: "Blueprint",
  estimated: "Estimated",
};

const PLANNED_STAYS: Record<PlannedStay, string> = {
  "under-1-year": "under 1 year",
  "1-3-years": "1-3 years",
  "3-10-years": "3-10 years",
  indefinitely: "indefinitely",
};

const OBSTRUCTIONS = {
  open: "open sky",
  partly: "sky partly blocked",
  heavily: "sky heavily blocked",
};

const FEATURE_NAMES: Record<FeatureKind, string> = {
  radiator: "Radiator",
  fireplace: "Fireplace",
  "built-in-storage": "Built-in storage",
  "fitted-units": "Fitted units",
  "beam-or-column": "Beam or column",
  "light-point": "Light point",
  "tiling-or-panelling": "Tiling or panelling",
  other: "Other",
};

/** A Feature's name: its kind, or its description for an "other". */
export function featureName(kind: FeatureKind, description?: string): string {
  return kind === "other" && description ? description : FEATURE_NAMES[kind];
}

/** "3.62 m", or "~3.62 m" for an Estimated length. */
export function length(measurement: Measurement): string {
  return `${lengthNumber(measurement)} m`;
}

function lengthNumber(measurement: Measurement): string {
  const tilde = measurement.provenance === "estimated" ? "~" : "";
  return `${tilde}${(measurement.mm / 1000).toFixed(2)}`;
}

/** A length on a Room Sheet; with `sources`, a Blueprint value is followed by where it is printed. */
function measure(measurement: Measurement, sources: boolean): string {
  const source = sources ? sourceText(measurement) : undefined;
  return source ? `${length(measurement)} [${source}]` : length(measurement);
}

/** Where a Blueprint value is printed: "agent-plan p.1: 5'11"". */
function sourceText({ provenance, source }: Measurement): string | undefined {
  return provenance === "blueprint" && source
    ? `${source.blueprint} p.${source.page}: ${source.printed}`
    : undefined;
}

/** A receipt's Provenance: "Measured", or "Blueprint, agent-plan p.1: 5'11"". */
function provenanceText(measurement: Measurement): string {
  const source = sourceText(measurement);
  return source ? `${PROVENANCE.blueprint}, ${source}` : PROVENANCE[measurement.provenance];
}

/**
 * "2.10 × 0.95 × 0.85 m (W × D × H)", or the sides that are known; with `sources`, followed by
 * where its Blueprint sides are printed: [W agent-plan p.1: 2.10].
 */
function size(sides: [string, Measurement | undefined][], sources = false): string | undefined {
  const known = sides.filter((side): side is [string, Measurement] => side[1] !== undefined);
  if (known.length === 0) return undefined;
  if (known.length === 1) {
    const [side, measurement] = known[0] as [string, Measurement];
    return `${SIDES[side]} ${measure(measurement, sources)}`;
  }
  const printed = sources
    ? known.flatMap(([side, measurement]) => {
        const source = sourceText(measurement);
        return source ? [`${side} ${source}`] : [];
      })
    : [];
  return (
    `${known.map(([, measurement]) => lengthNumber(measurement)).join(" × ")} m ` +
    `(${known.map(([side]) => side).join(" × ")})` +
    (printed.length > 0 ? ` [${printed.join("; ")}]` : "")
  );
}

const SIDES: Record<string, string> = { W: "width", H: "height", D: "depth" };

function colorText(color: Color): string {
  const tilde = color.provenance === "estimated" ? "~" : "";
  const maker = join(" ", [color.brand, color.code]);
  return `${tilde}${color.name}${maker ? ` (${maker})` : ""}${color.lrv !== undefined ? `, LRV ${color.lrv}` : ""}`;
}

function materialText(material: Material): string {
  return material.where ? `${material.material} (${material.where})` : material.material;
}

function surfaceText(surface: Surface): string {
  return join(", ", [
    surface.materials?.map(materialText).join(", "),
    surface.color && `color ${colorText(surface.color)}`,
    surface.finish && `${surface.finish} finish`,
  ]);
}

function lightText(light: Light): string {
  const temperature =
    typeof light.colorTemperature === "number"
      ? `${light.colorTemperature} K`
      : light.colorTemperature;
  const dimming =
    light.dimming === "none"
      ? "not dimmable"
      : light.dimming === "standard"
        ? "dimmable"
        : light.dimming;
  return join(", ", [
    light.role,
    temperature,
    light.brightness !== undefined ? `${light.brightness} lm` : undefined,
    dimming,
    light.cri !== undefined ? `CRI ${light.cri}` : undefined,
  ]);
}

function liftText(home: Home): string | undefined {
  if (home.lift === false) return "none";
  const sizes = join(", ", [
    home.liftDoorWidth && `door ${length(home.liftDoorWidth)} wide`,
    home.liftCarDepth && `car ${length(home.liftCarDepth)} deep`,
  ]);
  if (home.lift === true) return sizes || "yes";
  return sizes || undefined;
}

const compass = (point: string) => point.toUpperCase();

export function isMeasurement(value: unknown): value is Measurement {
  return typeof value === "object" && value !== null && "mm" in value && "provenance" in value;
}

export function isColor(value: unknown): value is Color {
  return typeof value === "object" && value !== null && "name" in value && "provenance" in value;
}

function isMaterial(value: unknown): value is Material {
  return typeof value === "object" && value !== null && "material" in value;
}

export function named(record: NamedRecord): string {
  return `${record.name} (${record.slug})`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The day of an ISO timestamp. */
function day(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** The parts that are not empty, joined. */
function join(separator: string, parts: (string | false | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(separator);
}

function formatLatitude(latitude: number): string {
  return `${Math.abs(latitude).toFixed(1)}° ${latitude < 0 ? "S" : "N"}`;
}
