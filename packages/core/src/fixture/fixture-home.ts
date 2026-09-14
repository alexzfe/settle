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
 * Session, Decisions in every state: a Locked Design Direction "Warm minimalism"; a Locked
 * Home-wide "Keep the original floors" with an open Conflict; a Locked living-room Room Direction
 * "Calm evenings" resting on both; a Candidate Room use for the Hallway; a Rejected hallway paint
 * idea; and a Leaning "Wool rug" Purchase with two Requirements and Evidence, resting on the Room
 * Direction and flagged because it was reopened (and then Locked again).
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
        price: "£350",
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
  await move("warm-minimalism", "locked", 'The user: "yes, lock it"');
  await decide({
    kind: "other",
    title: "Keep the original floors",
    statement: "The oak boards and terracotta tiles stay.",
  });
  await move("keep-the-original-floors", "locked", 'The user: "the floors stay, full stop"');
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
  await move("calm-evenings", "locked", 'The user: "perfect, lock the living room"');
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
  // after the direction is Locked again.
  await move("calm-evenings", "leaning", `The user: "let's rethink the living room"`);
  await move("calm-evenings", "locked", 'The user: "no, it was right; lock it again"');
  await core.run("flag_conflict", withDesign, {
    session: design,
    decision: "keep-the-original-floors",
    description: "The user now says the terracotta tiles crack every winter and wants them gone.",
  });
  await core.run("close_session", withDesign, {
    session: design,
    summary: {
      changed:
        "Locked the Design Direction Warm minimalism, keeping the original floors, and the " +
        "living room's Calm evenings.",
      open: "Storage in the hallway; the wool rug; a Conflict over the terracotta tiles.",
      next: "Color: a Palette for Warm minimalism.",
    },
  });
  return { core, home: home.slug, session };
}
