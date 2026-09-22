import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CallContext,
  type Core,
  type CoreOptions,
  createCore,
  type OperationInput,
} from "../core.js";
import type { DecisionState, Measurement } from "../operations/schemas.js";
import { openStore } from "../store.js";

/**
 * The fixture files: blueprint-a3.pdf (a one-page A3 ground floor with a text layer) and
 * blueprint-3-pages.pdf (portrait, /Rotate 90, and a scan), from docs/research/spikes/fixtures/.
 * packages/core/fixture/, from both src/fixture and dist/fixture.
 */
export const FIXTURE_FILES = join(import.meta.dirname, "..", "..", "fixture");

/**
 * The fixture Home: fictional, built from code on every run, and the data behind every renderer
 * snapshot. Its name and city match the Home the live smoke suite creates, so both are
 * fixture-home. It grows with each slice. In slice 2 it has every record kind of the Home model:
 * two Levels; four Rooms of different shapes (an L-shaped living room, a rectangular kitchen, a
 * T-shaped hallway, and a bedroom still mostly unmeasured) and an outdoor balcony; Windows; Doors,
 * one of them to outside and three shared between two Rooms; Surfaces; Features; Items, one
 * Unplaced and one Archived; Constraints, one of them removed; and Notes. Slice 3 adds a
 * Blueprint, "Agent plan" (the A3 fixture PDF, copied into the core's data dir on upload), whose
 * page 1 shows Ground, and two living-room Wall lengths printed on it. The printed strings are the
 * fixture's own: the A3 drawing stands in for the plan. Slice 4 adds, from a Design Direction
 * Session, Decisions in every state: a Settled Design Direction "Warm minimalism"; a Settled
 * Home-wide "Keep the original floors" with an open Conflict; a Settled living-room Room Direction
 * "Calm evenings" resting on both; a Candidate Room use for the Hallway; a Rejected hallway paint
 * idea; and a Leaning "Wool rug" Purchase with two Requirements and Evidence, resting on the Room
 * Direction and flagged because it was reopened (and then Settled again). Slice 5 adds, from a
 * Color Session, a Settled Palette "Warm clay" of four colors (one Estimated, without a code or
 * hex) resting on the Design Direction, and a Settled Room color painting the living-room walls
 * in its Jitney, not yet Fulfilled. Slice 6 adds, from a Purchase Session, two more Requirements
 * for the Wool rug (a must resting on the Estimated west wall, so its Quick Guide starts with a
 * Measure first line, and a prefer resting on the Palette, which joins its Basis), both its
 * Guides, and three Listings, each with the Agent's Rating: one passing every must, one failing
 * two musts and rated higher than it (the standing proof that a Rating is never capped by a
 * failed must), and one Held, out of stock, which keeps its Rating but is left out of the
 * Purchase's best rating; and an "Oak bookcase"
 * Purchase, Fulfilled with a Deviation from a must and one from a prefer, whose new Item replaced
 * the Billy bookcase and whose Deviation flagged the Candidate "Books by color" resting on it.
 * The Item page adds a register to the Unplaced standing desk (bought 2023, £350, warranty until
 * June 2028), and a Listing to the Oak bookcase, named as bought when it was Fulfilled: the new
 * Item's link and shop are copied from it, tagged Listed, and its price paid, given, is not.
 */
export const FIXTURE_ROOMS = [
  { name: "Living room", level: "ground" },
  { name: "Kitchen", level: "ground" },
  { name: "Hallway", level: "ground" },
  { name: "Main bedroom", level: "first" },
  { name: "Balcony", level: "first" },
] as const;

export interface FixtureHome {
  core: Core;
  /** The Home's slug. */
  home: string;
  /** The closed Session that recorded the Home. */
  session: string;
}

const measured = (mm: number): Measurement => ({ mm, provenance: "measured" });
const estimated = (mm: number): Measurement => ({ mm, provenance: "estimated" });
const printed = (mm: number, text: string): Measurement => ({
  mm,
  provenance: "blueprint",
  source: { blueprint: "agent-plan", page: 1, printed: text },
});

export async function createFixtureHome(
  options: Omit<CoreOptions, "store"> = {},
): Promise<FixtureHome> {
  const store = openStore(options.database ?? ":memory:");
  const core = createCore({ ...options, store });
  const web: CallContext = { caller: { kind: "web" } };

  const { home } = await core.run("create_home", web, {
    name: "Fixture Home",
    country: "GB",
    city: "London",
  });
  await core.run("upload_blueprint", web, {
    home: home.slug,
    file: readFileSync(join(FIXTURE_FILES, "blueprint-a3.pdf")),
    fileName: "blueprint-a3.pdf",
    label: "Agent plan",
  });
  const agent = (session?: string): CallContext => ({
    caller: { kind: "session", session },
    home: home.slug,
  });
  const { session } = await core.run("open_session", agent(), { skill: "home-intake" });
  const as = agent(session);

  await core.run("save_home", as, {
    session,
    tenure: "rented",
    plannedStay: "1-3-years",
    buildingType: "house",
    buildingEra: "1930s semi-detached",
    accessWidth: measured(760),
    accessNote: "the front door",
    levels: [{ name: "First", storey: 1 }],
    blueprintPages: [{ blueprint: "agent-plan", page: 1, level: "ground" }],
  });

  await core.run("save_room", as, {
    session,
    name: "Living room",
    level: "ground",
    functions: ["living", "dining"],
    ceilingHeight: measured(2600),
    timesOfUse: ["evening", "night"],
    walls: [
      {
        position: 1,
        length: measured(5200),
        facing: "s",
        beyond: "outside",
        obstruction: "partly",
        deciduous: true,
        label: "bay wall",
      },
      { position: 2, length: printed(2100, `6'11"`) },
      {
        position: 3,
        length: measured(1500),
        label: "chimney wall",
        surface: {
          materials: [{ material: "wallpaper" }],
          color: { name: "teal leaf print", provenance: "estimated" },
        },
      },
      { position: 4, length: printed(1800, `5'11"`) },
      { position: 5, length: estimated(3700), facing: "w", beyond: "outside" },
      { position: 6, length: measured(3900) },
    ],
    surfaces: {
      walls: {
        materials: [{ material: "plaster" }],
        color: {
          name: "Setting Plaster",
          brand: "Farrow & Ball",
          code: "No. 231",
          lrv: 63,
          hex: "#d8b9a6",
          provenance: "measured",
        },
        finish: "matt",
      },
      ceiling: {
        materials: [{ material: "plaster" }],
        color: { name: "white", provenance: "estimated" },
      },
      floor: {
        materials: [
          { material: "oak boards", where: "living end" },
          { material: "terracotta tiles", where: "dining end" },
        ],
      },
      woodwork: { color: { name: "white", provenance: "estimated" }, finish: "gloss" },
    },
    windows: [
      {
        wall: 1,
        kind: "bay",
        width: measured(2400),
        height: measured(1500),
        sillHeight: measured(450),
        offset: estimated(1400),
      },
      { wall: 5, width: estimated(900) },
    ],
    features: [
      {
        kind: "radiator",
        wall: 1,
        positionNote: "under the bay window",
        width: measured(1200),
        height: measured(600),
        depth: measured(100),
      },
      { kind: "fireplace", description: "cast iron, not working", wall: 3 },
      { kind: "light-point", positionNote: "ceiling centre" },
    ],
  });

  await core.run("save_room", as, {
    session,
    name: "Kitchen",
    level: "ground",
    functions: ["kitchen"],
    ceilingHeight: measured(2500),
    timesOfUse: ["morning", "evening"],
    walls: [
      { position: 1, length: measured(3400), facing: "e", beyond: "outside", obstruction: "open" },
      { position: 2, length: measured(2800) },
      { position: 3, length: measured(3400), beyond: "living-room" },
      { position: 4, length: measured(2800) },
    ],
    surfaces: {
      walls: { color: { name: "cream", provenance: "estimated" }, finish: "eggshell" },
      ceiling: { materials: [{ material: "plaster" }] },
      floor: { materials: [{ material: "vinyl" }] },
    },
    windows: [{ wall: 1, width: measured(1200), height: measured(1100), glass: "obscured" }],
    features: [
      { kind: "fitted-units", description: "oak shaker units", wall: 2 },
      { kind: "tiling-or-panelling", description: "white metro splashback", wall: 2 },
      {
        kind: "light-point",
        description: "four downlights",
        light: { role: "task", colorTemperature: "cool", brightness: 450, dimming: "standard" },
      },
    ],
  });

  await core.run("save_room", as, {
    session,
    name: "Hallway",
    level: "ground",
    functions: ["hallway"],
    windowless: true,
    walls: [
      { position: 1, length: measured(1100), facing: "n", beyond: "outside" },
      { position: 2, length: estimated(4200), beyond: "living-room" },
      { position: 3, length: estimated(900) },
      { position: 4, length: estimated(1200) },
      { position: 5, length: estimated(1000) },
      { position: 6, length: estimated(1200) },
      { position: 7 },
      { position: 8 },
    ],
    surfaces: { floor: { materials: [{ material: "encaustic tiles" }] } },
    doors: [
      { wall: 1, sideB: "outside", glazed: true, clearWidth: measured(820) },
      { wall: 2, otherRoom: "living-room", otherWall: 6, clearWidth: measured(760) },
      { wall: 6, otherRoom: "kitchen", clearWidth: estimated(700) },
    ],
    features: [{ kind: "built-in-storage", description: "understairs cupboard", wall: 3 }],
  });

  // The hallway recorded the Door to the kitchen, so naming the hallway here updates that Door.
  await core.run("save_room", as, {
    session,
    room: "kitchen",
    name: "Kitchen",
    doors: [{ wall: 4, otherRoom: "hallway", noDoor: true }],
  });

  await core.run("save_room", as, {
    session,
    name: "Balcony",
    level: "first",
    outdoor: true,
    functions: ["dining"],
    surfaces: { floor: { materials: [{ material: "hardwood decking" }] } },
  });

  await core.run("save_room", as, {
    session,
    name: "Main bedroom",
    level: "first",
    functions: ["bedroom"],
    timesOfUse: ["night"],
    walls: [
      { position: 1, length: estimated(3600), facing: "w", beyond: "balcony" },
      { position: 2 },
      { position: 3 },
      { position: 4 },
    ],
    windows: [{ wall: 1, width: estimated(1200), sillHeight: estimated(900) }],
    doors: [{ wall: 1, otherRoom: "balcony", glazed: true }],
    features: [{ kind: "fireplace", description: "blocked-up chimney breast", wall: 3 }],
  });

  await core.run("save_items", as, {
    session,
    items: [
      {
        name: "Sofa",
        category: "seating",
        room: "living-room",
        wall: 6,
        width: measured(2100),
        depth: measured(950),
        height: measured(850),
        colors: [{ name: "warm grey", provenance: "estimated" }],
        materials: ["linen"],
        condition: "worn",
      },
      {
        name: "Dining chair",
        category: "seating",
        quantity: 6,
        room: "living-room",
        positionNote: "dining end",
        materials: ["oak"],
      },
      {
        name: "Pendant lamp",
        category: "lighting",
        room: "living-room",
        positionNote: "on the ceiling point",
        light: { role: "ambient", colorTemperature: 2700, brightness: 800, dimming: "dim-to-warm" },
      },
      {
        name: "Bookcase",
        category: "storage",
        room: "living-room",
        wall: 4,
        width: estimated(800),
        depth: estimated(300),
        height: estimated(1800),
        brand: "IKEA",
        model: "Billy",
      },
      { name: "Kitchen table", category: "tables", room: "kitchen", width: measured(1200) },
      {
        name: "Double bed",
        category: "beds",
        room: "main-bedroom",
        wall: 2,
        width: measured(1600),
        depth: measured(2100),
      },
      {
        name: "Standing desk",
        category: "tables",
        positionNote: "boxed since the move",
        pricePaid: "£350",
        boughtOn: "2023",
        warrantyUntil: "2028-06",
      },
      { name: "Old armchair", category: "seating", room: "living-room" },
    ],
  });
  await core.run("save_items", as, {
    session,
    items: [{ item: "old-armchair", archive: true, archiveReason: "sold" }],
  });

  await core.run("set_constraints", as, {
    session,
    add: ["Rented: no drilling into the chimney breast", "Two cats", "Rented: no painting"],
  });
  await core.run("set_constraints", as, {
    session,
    remove: ["rented-no-painting"],
    reason: 'The user: "the landlord said we can paint"',
  });
  await core.run("save_note", as, { session, text: "The cats scratch fabric furniture" });
  await core.run("save_note", as, { session, text: "We might get a dog next year" });

  await core.run("close_session", as, {
    session,
    summary: {
      changed:
        "Recorded the Home's facts, five Rooms with their Walls, Windows, Doors, Features, and " +
        "Surfaces, eight Items, three Constraints, and two Notes.",
      open: "The hallway's ceiling height and times of use; most of the main bedroom.",
      next: "Home Intake again, to measure the main bedroom.",
    },
  });

  const { session: design } = await core.run("open_session", agent(), {
    skill: "design-direction",
  });
  const withDesign = agent(design);
  const decide = (input: Omit<OperationInput<"save_decision">, "session">) =>
    core.run("save_decision", withDesign, { session: design, ...input });
  const move = (decision: string, to: DecisionState, reason: string) =>
    core.run("set_decision_state", withDesign, { session: design, decision, to, reason });

  await decide({
    kind: "design-direction",
    title: "Warm minimalism",
    statement: "Calm, warm rooms of natural materials that age well.",
    content: {
      mood: "calm, grounded",
      temperature: "warm",
      contrast: "low",
      keyMaterials: ["oak", "linen", "limewash", "unlacquered brass"],
      styleReferences: ["Japandi", "1970s Danish modern"],
      principles: [
        "Fewer, better things",
        "Daylight first, then low warm lamps",
        "Nothing the cats can shred",
      ],
    },
    evidence: [
      {
        kind: "session",
        id: design,
        stance: "supports",
        note: "The user showed three Japandi living rooms they love.",
      },
    ],
  });
  await move("warm-minimalism", "leaning", 'The user: "that sounds like us"');
  await move("warm-minimalism", "settled", 'The user: "yes, settle it"');
  await decide({
    kind: "other",
    title: "Keep the original floors",
    statement: "The oak boards and terracotta tiles stay.",
  });
  await move("keep-the-original-floors", "settled", 'The user: "the floors stay, full stop"');
  await decide({
    kind: "room-direction",
    room: "living-room",
    title: "Calm evenings",
    statement: "A low, warm room for long evenings.",
    content: {
      direction:
        "Pools of lamplight, soft wool and linen, and the fireplace as the focus; nothing " +
        "bright or glossy after dark.",
      contrast: "medium",
    },
    basis: ["keep-the-original-floors"],
  });
  await move("calm-evenings", "settled", 'The user: "perfect, settle the living room"');
  await decide({
    kind: "room-use",
    room: "hallway",
    title: "Storage in the hallway",
    statement: "The hallway also holds coats, shoes, and the vacuum.",
    content: { functions: ["hallway", "storage"] },
  });
  await decide({
    kind: "other",
    room: "hallway",
    title: "Paint the hallway dark green",
    statement: "A dark green hallway.",
  });
  await move(
    "paint-the-hallway-dark-green",
    "rejected",
    'The user: "no, too dark without windows"',
  );
  await decide({
    kind: "purchase",
    room: "living-room",
    title: "Wool rug",
    statement: "A large wool rug under the sofa.",
    basis: ["calm-evenings"],
    evidence: [
      {
        kind: "note",
        id: "the-cats-scratch-fabric-furniture",
        stance: "supports",
        note: "Wool stands up to claws better than linen.",
      },
    ],
    requirements: [
      {
        text: "At least 2.0 × 1.4 m",
        strength: "must",
        reason: { kind: "wall", id: "living-room/wall-2", field: "length" },
      },
      {
        text: "Wool, low pile: loops catch the cats' claws",
        strength: "prefer",
        reason: { kind: "constraint", id: "two-cats" },
      },
    ],
  });
  await move("wool-rug", "leaning", 'The user: "I like the idea of wool"');
  // Rethinking the living room flags the rug, which rests on its direction; the flag stays open
  // after the direction is Settled again.
  await move("calm-evenings", "leaning", `The user: "let's rethink the living room"`);
  await move("calm-evenings", "settled", 'The user: "no, it was right; settle it again"');
  await core.run("flag_conflict", withDesign, {
    session: design,
    decision: "keep-the-original-floors",
    description: "The user now says the terracotta tiles crack every winter and wants them gone.",
  });
  await core.run("close_session", withDesign, {
    session: design,
    summary: {
      changed:
        "Settled the Design Direction Warm minimalism, keeping the original floors, and the " +
        "living room's Calm evenings.",
      open: "Storage in the hallway; the wool rug; a Conflict over the terracotta tiles.",
      next: "Color: a Palette for Warm minimalism.",
    },
  });

  const { session: color } = await core.run("open_session", agent(), { skill: "color" });
  const withColor = agent(color);
  await core.run("save_decision", withColor, {
    session: color,
    kind: "palette",
    title: "Warm clay",
    statement:
      "Soft plaster and clay tones, a warm stone for the living room, a terracotta accent.",
    content: {
      colors: [
        {
          name: "Pointing",
          brand: "Farrow & Ball",
          code: "No. 2003",
          hex: "#ece5d3",
          provenance: "measured",
          role: "base",
          note: "ceilings and woodwork throughout",
        },
        {
          name: "Setting Plaster",
          brand: "Farrow & Ball",
          code: "No. 231",
          lrv: 63,
          hex: "#d8b9a6",
          provenance: "measured",
          role: "base",
          note: "walls in the kitchen and the main bedroom",
        },
        {
          name: "Jitney",
          brand: "Farrow & Ball",
          code: "No. 293",
          hex: "#bba68a",
          provenance: "measured",
          role: "secondary",
          note: "living room walls, warm under lamplight",
        },
        {
          name: "warm terracotta",
          provenance: "estimated",
          role: "accent",
          note: "cushions and a rug, echoing the dining-end tiles",
        },
      ],
    },
    evidence: [
      {
        kind: "session",
        id: color,
        stance: "supports",
        note: "The user held the samples up to the bay window at dusk.",
      },
    ],
  });
  const colorMove = (decision: string, to: DecisionState, reason: string) =>
    core.run("set_decision_state", withColor, { session: color, decision, to, reason });
  await colorMove("warm-clay", "leaning", 'The user: "I like these together"');
  await colorMove("warm-clay", "settled", 'The user: "settle the palette"');
  await core.run("save_decision", withColor, {
    session: color,
    kind: "room-color",
    room: "living-room",
    title: "Living room walls in Jitney",
    statement: "The living room walls in Jitney, matt, for a warmer glow in the evenings.",
    content: { surface: "walls", color: "Jitney", finish: "matt" },
    basis: ["calm-evenings"],
  });
  await colorMove("living-room-walls-in-jitney", "settled", 'The user: "Jitney it is, settle it"');
  await core.run("close_session", withColor, {
    session: color,
    summary: {
      changed: "Settled the Palette Warm clay and Jitney for the living room walls.",
      open: "Painting the living room.",
      next: "Color again once the living room is painted, to record it.",
    },
  });

  const { session: purchase } = await core.run("open_session", agent(), { skill: "purchase" });
  const withPurchase = agent(purchase);
  await core.run("save_decision", withPurchase, {
    session: purchase,
    decision: "wool-rug",
    kind: "purchase",
    title: "Wool rug",
    statement: "A large wool rug under the sofa.",
    requirements: [
      {
        text: "No longer than 3.4 m, to keep the walk past the west window clear",
        strength: "must",
        reason: { kind: "wall", id: "living-room/wall-5", field: "length" },
      },
      {
        text: "Warm terracotta, the Palette's accent, or close to it",
        strength: "prefer",
        reason: { kind: "decision", id: "warm-clay" },
      },
    ],
  });
  await core.run("save_guides", withPurchase, {
    session: purchase,
    decision: "wool-rug",
    lookingFor: "Wool · cut pile · warm terracotta · 2.0–3.4 m long",
    quickLines: [
      { kind: "avoid", text: "Loop pile, viscose blends — claws catch, viscose marks" },
      { kind: "test", text: "Rub the pile hard: more than a little fluff means shedding" },
      { kind: "test", text: "Turn a corner back: stiff latex cracks on tiles" },
      { kind: "ask", text: "Backing latex or felt?" },
    ],
    fullGuide: WOOL_RUG_GUIDE,
  });
  const listing = (input: Omit<OperationInput<"record_listing">, "session" | "decision">) =>
    core.run("record_listing", withPurchase, { session: purchase, decision: "wool-rug", ...input });
  await listing({
    name: "Hay Plain rug",
    url: "https://example.com/hay-plain-rug",
    price: "£450",
    dimensions: { width: 2000, depth: 3000 },
    rating: 4,
    ratingNote: "Right size, real wool, but £120 over the others",
    checks: [
      { requirement: 1, result: "pass", note: "2.0 × 3.0 m" },
      { requirement: 2, result: "pass", note: "cut pile wool" },
      { requirement: 3, result: "pass", note: "3.0 m long" },
      { requirement: 4, result: "unknown", note: "rust in the photos; see it in daylight" },
    ],
  });
  // Rated above the Hay rug although it fails two musts: the standing proof that the stars say
  // how good a product is and the checks say whether it qualifies, and that neither touches the
  // other. A platform that capped this at 1 star would hide that Requirement 1 is worth reopening.
  await listing({
    name: "Jute loop rug",
    url: "https://example.com/jute-loop-rug",
    price: "£120",
    dimensions: { width: 1200, depth: 1700 },
    rating: 5,
    ratingNote: "Exactly the terracotta wanted, and a third of the price",
    checks: [
      { requirement: 1, result: "fail", note: "1.2 × 1.7 m" },
      { requirement: 2, result: "fail", note: "loop pile, jute blend" },
      { requirement: 3, result: "pass", note: "1.7 m long" },
      { requirement: 4, result: "pass", note: "terracotta" },
    ],
  });
  // Held: good, just not buyable now, so it keeps its Rating and its place but is left out of the
  // Shopping page's best rating, which is 4 — the Hay rug's — rather than this one's 5.
  await listing({
    name: "Nordic Story wool rug",
    url: "https://example.com/nordic-story-wool-rug",
    price: "£310",
    dimensions: { width: 2000, depth: 3000 },
    rating: 5,
    ratingNote: "The terracotta and the size, £140 under the Hay",
    held: { reason: "out-of-stock", note: "back in March, the shop says" },
    checks: [
      { requirement: 1, result: "pass", note: "2.0 × 3.0 m" },
      { requirement: 2, result: "pass", note: "cut pile wool" },
      { requirement: 3, result: "pass", note: "3.0 m long" },
      { requirement: 4, result: "pass", note: "terracotta" },
    ],
  });

  const purchaseMove = (decision: string, to: DecisionState, reason: string) =>
    core.run("set_decision_state", withPurchase, { session: purchase, decision, to, reason });
  await core.run("save_decision", withPurchase, {
    session: purchase,
    kind: "purchase",
    room: "living-room",
    title: "Oak bookcase",
    statement: "A solid oak bookcase in place of the Billy.",
    requirements: [
      {
        text: "At most 80 cm wide, to stand where the Billy stands",
        strength: "must",
        reason: { kind: "item", id: "bookcase", field: "width" },
      },
      {
        text: "Solid oak or oak veneer",
        strength: "must",
        reason: { kind: "decision", id: "warm-minimalism" },
      },
      {
        text: "Closed cupboards at the bottom, out of the cats' reach",
        strength: "prefer",
        reason: { kind: "constraint", id: "two-cats" },
      },
    ],
  });
  await core.run("record_listing", withPurchase, {
    session: purchase,
    decision: "oak-bookcase",
    name: "Solid oak bookcase",
    url: "https://www.example.com/solid-oak-bookcase",
    price: "£640",
    dimensions: { width: 850, depth: 300, height: 1900 },
    checks: [
      { requirement: 1, result: "fail", note: "85 cm wide" },
      { requirement: 2, result: "pass", note: "solid oak" },
      { requirement: 3, result: "fail", note: "open shelves to the floor" },
    ],
  });
  await purchaseMove("oak-bookcase", "settled", `The user: "that's the one, settle it"`);
  await core.run("save_decision", withPurchase, {
    session: purchase,
    kind: "other",
    room: "living-room",
    title: "Books by color",
    statement: "The books on the oak bookcase arranged by the color of their spines.",
    basis: ["oak-bookcase"],
  });
  await core.run("record_fulfilment", withPurchase, {
    session: purchase,
    decision: "oak-bookcase",
    bought: "Oak bookcase, 85 cm wide, open shelves to the floor, £620",
    deviations: [
      {
        requirement: 1,
        text: "85 cm wide, not at most 80 cm",
        reason: "the only oak one under £700; the alcove has 4 cm to spare",
      },
      { requirement: 3, text: "open shelves to the floor, no cupboards" },
    ],
    item: {
      name: "Oak bookcase",
      category: "storage",
      wall: 4,
      width: measured(850),
      depth: measured(300),
      height: measured(1900),
      materials: ["oak"],
      pricePaid: "£620",
    },
    listing: "solid-oak-bookcase",
    replacesItem: "bookcase",
  });
  await core.run("close_session", withPurchase, {
    session: purchase,
    summary: {
      changed:
        "Two more Requirements for the wool rug, both its Guides, and three rugs checked and " +
        "rated; the oak bookcase bought, wider than asked, in place of the Billy.",
      open: "The west wall of the living room needs measuring before buying the rug.",
      next: "Purchase again with a rug to check against the Requirements.",
    },
  });
  return { core, home: home.slug, session };
}

/** The Wool rug's Full Guide: every must explains why. */
const WOOL_RUG_GUIDE = `## Size

- **At least 2.0 × 1.4 m** (must). The sofa's front legs should stand on the rug, or it floats
  and the seating looks smaller; the wall behind it is 2.1 m, as printed on the plan.
- **No longer than 3.4 m** (must). About 30 cm must stay clear along the west window wall to
  walk past. That wall was only estimated at 3.7 m, so measure it before buying.

## Material

- **Wool, low pile** (prefer). Two cats live here: claws catch in loops, and wool shrugs off
  scratching better than linen or viscose.

## Color

- **Warm terracotta** (prefer). The accent of the Warm clay Palette, echoing the dining-end
  tiles; a rug is the one large surface in the room that can carry it.`;
