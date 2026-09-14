// The Zod schemas of the Home model's operation inputs and results (slices 2 and 3), and of the
// records and values they carry: the single source of truth that core, the web API, the MCP tools,
// the web UI, and the Skills read. Field names are the camelCase of docs/specs/home-model.md's
// field tables.
import { z } from "zod";
import { homeInput, sessionInput } from "./scope.js";

// ─── Fixed lists (docs/specs/home-model.md#fixed-lists) ─────────────────────────────────────

export const PROVENANCES = ["measured", "blueprint", "estimated"] as const;
export const ROOM_FUNCTIONS = [
  "kitchen",
  "dining",
  "living",
  "bedroom",
  "office",
  "bathroom",
  "hallway",
  "stairs",
  "storage",
  "utility",
  "garage",
  "other",
] as const;
export const ITEM_CATEGORIES = [
  "seating",
  "tables",
  "beds",
  "storage",
  "lighting",
  "rugs",
  "textiles",
  "art-and-mirrors",
  "decor",
  "plants",
  "appliances",
  "electronics",
  "outdoor",
  "other",
] as const;
export const FEATURE_KINDS = [
  "radiator",
  "fireplace",
  "built-in-storage",
  "fitted-units",
  "beam-or-column",
  "light-point",
  "tiling-or-panelling",
  "other",
] as const;
export const TIMES_OF_USE = ["morning", "daytime", "evening", "night"] as const;
export const COMPASS_POINTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export const TENURES = ["owned", "rented", "other"] as const;
export const PLANNED_STAYS = ["under-1-year", "1-3-years", "3-10-years", "indefinitely"] as const;
export const BUILDING_TYPES = ["house", "apartment", "other"] as const;
export const OBSTRUCTIONS = ["open", "partly", "heavily"] as const;
export const WINDOW_KINDS = ["standard", "bay", "roof"] as const;
export const GLASS_KINDS = ["clear", "obscured", "tinted", "filmed"] as const;
export const DOOR_SIDE_B_KINDS = ["room", "outdoor-room", "outside", "unknown"] as const;
export const SURFACE_PARTS = ["walls", "ceiling", "floor", "woodwork"] as const;
export const CONDITIONS = ["good", "worn", "damaged"] as const;
export const LIGHT_ROLES = ["ambient", "task", "accent"] as const;
export const COLOR_TEMPERATURES = ["warm", "neutral", "cool"] as const;
export const DIMMING_KINDS = ["none", "standard", "dim-to-warm", "tunable"] as const;

// ─── Blueprints (docs/research/spikes/3-pdf-to-png.md and 4-images-in-results.md) ─────────────

/** What a Blueprint file may be. HEIC is refused until conversion arrives. */
export const BLUEPRINT_FILE_TYPES = ["pdf", "png", "jpeg"] as const;
/** A quarter of a page, which view_images renders at twice the whole page's scale. */
export const QUARTERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
/** The image types view_images returns: PNG, or JPEG for a page whose PNG is over 1 MB. */
export const IMAGE_TYPES = ["image/png", "image/jpeg"] as const;
/** Every Blueprint page is rendered with its long edge at this many pixels. */
export const PAGE_LONG_EDGE = 2000;
/** The most pages one view_images call returns: six 2000 px pages fit a 25K-token tool result. */
export const MAX_PAGES_PER_VIEW = 6;

export type BlueprintFileType = (typeof BLUEPRINT_FILE_TYPES)[number];
export type Quarter = (typeof QUARTERS)[number];
export type ImageType = (typeof IMAGE_TYPES)[number];

export type Provenance = (typeof PROVENANCES)[number];
export type RoomFunction = (typeof ROOM_FUNCTIONS)[number];
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export type FeatureKind = (typeof FEATURE_KINDS)[number];
export type TimeOfUse = (typeof TIMES_OF_USE)[number];
export type CompassPoint = (typeof COMPASS_POINTS)[number];
export type SurfacePart = (typeof SURFACE_PARTS)[number];
export type DoorSideBKind = (typeof DOOR_SIDE_B_KINDS)[number];
export type Tenure = (typeof TENURES)[number];
export type PlannedStay = (typeof PLANNED_STAYS)[number];
export type BuildingType = (typeof BUILDING_TYPES)[number];
export type Obstruction = (typeof OBSTRUCTIONS)[number];
export type WindowKind = (typeof WINDOW_KINDS)[number];
export type GlassKind = (typeof GLASS_KINDS)[number];
export type Condition = (typeof CONDITIONS)[number];

// ─── Values ─────────────────────────────────────────────────────────────────────────────────

// Kept short: every length and color repeats it in the tool schemas, and each write tool's
// description states the Provenance rule in full.
export const provenanceSchema = z
  .enum(PROVENANCES)
  .describe("measured (by the user), blueprint (printed on one), or estimated (by eye, guessed).");

/** Where a Blueprint value is printed. The Blueprint and its page must exist in the Home. */
export const blueprintSourceSchema = z.object({
  blueprint: z
    .string()
    .trim()
    .min(1)
    .describe("The Blueprint's slug, as the Home Overview lists it."),
  page: z.number().int().min(1).describe("The page it is printed on, from 1."),
  printed: z.string().trim().min(1).describe(`The text exactly as printed, e.g. 12'6" or 3.62.`),
});

/** A length with its Provenance, in whole millimetres. */
export const measurementSchema = z.object({
  mm: z.number().int().min(0).describe("Whole millimetres: 3.62 m is 3620."),
  provenance: provenanceSchema,
  source: blueprintSourceSchema.optional().describe("With blueprint Provenance only."),
});

/** One color: a paint, a fabric's color. The same shape in Surfaces, Items, and the Palette. */
export const colorSchema = z.object({
  name: z.string().trim().min(1).describe('A paint\'s name, or a description ("warm grey").'),
  brand: z.string().trim().min(1).optional().describe("The paint maker."),
  code: z.string().trim().min(1).optional().describe("The maker's code."),
  lrv: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Light reflectance value, when published. Never ask the user."),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Approximate, for the screen only."),
  provenance: provenanceSchema.describe(
    "measured (identified exactly, e.g. a code from the tin) or estimated (judged by eye).",
  ),
});

/** Light attributes, on whichever Item or Feature actually gives the light. */
export const lightSchema = z.object({
  role: z.enum(LIGHT_ROLES).optional().describe("ambient, task, or accent."),
  colorTemperature: z
    .union([z.number().int().min(1000).max(10000), z.enum(COLOR_TEMPERATURES)])
    .optional()
    .describe('Kelvin (2700), or "warm", "neutral", or "cool" when that is all the user knows.'),
  brightness: z.number().int().min(1).optional().describe("Lumens, from the bulb box."),
  dimming: z
    .enum(DIMMING_KINDS)
    .optional()
    .describe("none, standard, dim-to-warm, or tunable. Only the last two change the color."),
  cri: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Color rendering index, when stated. Leave out when unknown."),
});

export const materialSchema = z.object({
  material: z.string().trim().min(1).describe('e.g. "plaster", "oak boards", "carpet".'),
  where: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Where in the Room, when a floor has several materials ("tiles, kitchen end").'),
});

/** A Surface as a write gives it: only the fields given change. */
export const surfaceInput = z.object({
  materials: z
    .array(materialSchema)
    .optional()
    .describe("Its materials, replacing any recorded. Usually one; a floor may have several."),
  color: colorSchema.optional(),
  finish: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Paint sheen or surface finish: "matt", "eggshell", "satin", "gloss", "oiled"…'),
});

export type Measurement = z.infer<typeof measurementSchema>;
export type BlueprintSource = z.infer<typeof blueprintSourceSchema>;
export type Color = z.infer<typeof colorSchema>;
export type Light = z.infer<typeof lightSchema>;
export type Material = z.infer<typeof materialSchema>;
export type SurfaceInput = z.infer<typeof surfaceInput>;

// ─── Shared input parts ─────────────────────────────────────────────────────────────────────

const overrideProvenanceInput = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    "Only when the user has said to replace a stronger value with a weaker one (e.g. a measured " +
      "length with an estimate): their words, quoted. Without it such a replacement is refused.",
  );

const archiveInput = z
  .boolean()
  .optional()
  .describe(
    "true to Archive it: it leaves the Home's current state but is kept, so anything referring " +
      "to it keeps working. Nothing is ever deleted. false restores an Archived one.",
  );

const archiveReasonInput = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe('With archive: why, e.g. "sold", "broken", "removed when the kitchen was refitted".');

const wallPosition = z.number().int().min(1).max(99);

const slugInput = z.string().trim().min(1);

/** A file's bytes: web only, never part of a tool's JSON schema. */
const bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: "Expected the file's bytes",
});

const text = z.string().trim().min(1);

// ─── save_home ──────────────────────────────────────────────────────────────────────────────

export const levelInput = z.object({
  level: slugInput
    .optional()
    .describe(
      "The slug of an existing Level to rename, renumber, or remove; leave out to add one.",
    ),
  name: text.max(60).optional().describe('The Level\'s name, e.g. "Ground", "First", "Loft".'),
  storey: z
    .number()
    .int()
    .min(-5)
    .max(200)
    .optional()
    .describe(
      "Storey in the building: 0 for ground, -1 for a basement, 5 for a fifth-floor flat. " +
        "Needed to add a Level.",
    ),
  remove: z
    .boolean()
    .optional()
    .describe("true to remove the Level. Refused while any Room, even an Archived one, is on it."),
});

export const blueprintPageLevelInput = z.object({
  blueprint: slugInput.describe("The Blueprint's slug, as the Home Overview lists it."),
  page: z.number().int().min(1).describe("The page, from 1."),
  level: slugInput.describe('The Level the page shows, by slug or name ("ground").'),
});

export const saveHomeInput = z.object({
  session: sessionInput,
  tenure: z.enum(TENURES).optional().describe("owned, rented, or other."),
  plannedStay: z
    .enum(PLANNED_STAYS)
    .optional()
    .describe(
      "How long the user expects to live there: under-1-year, 1-3-years, 3-10-years, or indefinitely.",
    ),
  buildingType: z.enum(BUILDING_TYPES).optional().describe("house, apartment, or other."),
  buildingEra: text
    .max(100)
    .optional()
    .describe('The building\'s approximate age, e.g. "1890s terrace", "1970s block".'),
  lift: z.boolean().optional().describe("Whether the building has a lift."),
  liftDoorWidth: measurementSchema.optional().describe("The lift door's clear width."),
  liftCarDepth: measurementSchema.optional().describe("The lift car's depth."),
  accessWidth: measurementSchema
    .optional()
    .describe("The width of the narrowest point on the way into the Home."),
  accessNote: text
    .max(200)
    .optional()
    .describe('What that narrowest point is, e.g. "turn in the communal stair".'),
  levels: z
    .array(levelInput)
    .optional()
    .describe("Levels to add, change, or remove. Levels not listed stay as they are."),
  blueprintPages: z
    .array(blueprintPageLevelInput)
    .optional()
    .describe(
      "Which Level each Blueprint page shows. Applied after `levels`, so a Level added in the " +
        "same call can be named. Pages not listed stay as they are.",
    ),
  overrideProvenance: overrideProvenanceInput,
});

export type SaveHomeInput = z.input<typeof saveHomeInput>;
export type LevelInput = z.input<typeof levelInput>;
export type BlueprintPageLevelInput = z.input<typeof blueprintPageLevelInput>;

// ─── save_room ──────────────────────────────────────────────────────────────────────────────

export const wallInput = z.object({
  position: wallPosition.describe(
    "The Wall's place in clockwise order around the Room seen from above, from 1. It names the " +
      "Wall: position 2 of living-room is living-room/wall-2. A rectangular Room has Walls 1-4, " +
      "an L-shaped one 1-6. Saving a position that exists changes that Wall.",
  ),
  length: measurementSchema
    .optional()
    .describe("The Wall's length. Wall lengths are the Room's dimensions."),
  facing: z
    .enum(COMPASS_POINTS)
    .optional()
    .describe(
      "Exterior Walls only: the compass direction the Wall faces outward (n, ne, e, se, s, sw, " +
        "w, nw). Always confirm north with the user.",
    ),
  beyond: slugInput
    .optional()
    .describe(
      'What is on the other side: another Room\'s slug, "outside", or "unknown". A Wall with an ' +
        "outdoor Room (a balcony) beyond it counts as exterior.",
    ),
  label: text.max(60).optional().describe('e.g. "window wall", "chimney wall".'),
  obstruction: z
    .enum(OBSTRUCTIONS)
    .optional()
    .describe("Exterior Walls only: how much sky outside is blocked: open, partly, or heavily."),
  deciduous: z
    .boolean()
    .optional()
    .describe("Exterior Walls only: true when deciduous trees do the blocking (bare in winter)."),
  surface: surfaceInput
    .optional()
    .describe("A whole-Wall exception to the Room's walls Surface, such as a feature wall."),
  archive: archiveInput,
});

export const windowInput = z.object({
  window: slugInput
    .optional()
    .describe("The slug of an existing Window to change; leave out to add a Window."),
  wall: z
    .union([wallPosition, z.literal("roof")])
    .optional()
    .describe(
      'The position of the Wall it is in (2 for living-room/wall-2), or "roof" for a skylight. ' +
        "Needed to add a Window; the Wall must exist or be in this call's walls.",
    ),
  roofFacing: z
    .enum(COMPASS_POINTS)
    .optional()
    .describe("For a roof window: the direction the roof slope faces."),
  kind: z.enum(WINDOW_KINDS).optional().describe("standard, bay, or roof."),
  width: measurementSchema.optional(),
  height: measurementSchema.optional(),
  sillHeight: measurementSchema
    .optional()
    .describe("Sill height above the floor: it decides what fits beneath."),
  offset: measurementSchema
    .optional()
    .describe("From the Wall's start corner (clockwise) to the Window's near edge."),
  glass: z
    .enum(GLASS_KINDS)
    .optional()
    .describe("clear (the default), obscured, tinted, or filmed."),
  archive: archiveInput,
});

export const doorInput = z.object({
  door: slugInput
    .optional()
    .describe(
      "The slug of an existing Door to change. Leave out otherwise: when a Door already joins " +
        "this Room and otherRoom, that Door is updated rather than duplicated.",
    ),
  newDoor: z
    .boolean()
    .optional()
    .describe("true to add a second Door between two Rooms that already have one."),
  wall: wallPosition
    .optional()
    .describe(
      "The position of this Room's Wall the Door is in. Needed to add a Door, except from an " +
        "outdoor Room without Walls; the Wall must exist or be in this call's walls.",
    ),
  sideB: z
    .enum(DOOR_SIDE_B_KINDS)
    .optional()
    .describe(
      'What the Door leads to: "room" or "outdoor-room" (name it in otherRoom), "outside", or ' +
        '"unknown". With otherRoom it can be left out.',
    ),
  otherRoom: slugInput.optional().describe("The slug of the Room on the other side."),
  otherWall: wallPosition
    .optional()
    .describe("The position of the other Room's Wall the Door is in, when known."),
  clearWidth: measurementSchema.optional().describe("Clear width, for getting furniture in."),
  height: measurementSchema.optional(),
  offset: measurementSchema
    .optional()
    .describe(
      "Along this Room's Wall, from its start corner (clockwise) to the Door's near edge. Only " +
        "from the Room the Door was first recorded in.",
    ),
  glazed: z
    .boolean()
    .optional()
    .describe("true for a glazed door, e.g. French doors: it lets in daylight."),
  noDoor: z.boolean().optional().describe("true for a doorway with nothing hanging in it."),
  archive: archiveInput,
});

export const featureInput = z.object({
  feature: slugInput
    .optional()
    .describe("The slug of an existing Feature to change; leave out to add a Feature."),
  kind: z
    .enum(FEATURE_KINDS)
    .optional()
    .describe(
      "Needed to add a Feature: radiator (or heater), fireplace (or chimney breast), " +
        "built-in-storage, fitted-units (kitchen or bathroom), beam-or-column, light-point " +
        "(or downlight), tiling-or-panelling (a splashback, panelling), or other.",
    ),
  description: text.max(200).optional().describe('What it is; needed when the kind is "other".'),
  wall: wallPosition.optional().describe("The position of the Wall it is on or against."),
  positionNote: text.max(200).optional().describe('Where it is, e.g. "under the window".'),
  width: measurementSchema.optional(),
  height: measurementSchema.optional(),
  depth: measurementSchema.optional(),
  light: lightSchema.optional().describe("For a Feature that gives light, such as a downlight."),
  archive: archiveInput,
  archiveReason: archiveReasonInput,
});

export const saveRoomInput = z.object({
  session: sessionInput,
  room: slugInput
    .optional()
    .describe(
      "The slug of the Room to change, as the Home Overview lists it. Leave out for a new Room " +
        "(a Room with the same name is updated instead of duplicated).",
    ),
  name: text
    .max(100)
    .describe(
      `The Room's name as the user says it, e.g. "Living room" or "Mia's room". A new name renames it; its slug stays.`,
    ),
  level: slugInput
    .optional()
    .describe(
      'The Level the Room is on, by slug or name ("ground"). A new Room without one goes on ' +
        "the ground Level; a staircase belongs to the Level you enter it from.",
    ),
  functions: z
    .array(z.enum(ROOM_FUNCTIONS))
    .optional()
    .describe(
      "How the Room is used now, replacing the recorded list: kitchen, dining, living, bedroom, " +
        "office, bathroom, hallway, stairs, storage, utility, garage, other. May be empty.",
    ),
  outdoor: z
    .boolean()
    .optional()
    .describe(
      "true for a balcony you can step onto, a terrace, patio, or garden. A railing-only " +
        "(Juliet) balcony is not a Room but a glazed Door to outside.",
    ),
  ceilingHeight: measurementSchema.optional().describe("The full ceiling height."),
  timesOfUse: z
    .array(z.enum(TIMES_OF_USE))
    .optional()
    .describe(
      "When the Room is mostly used, replacing the recorded list: morning, daytime, evening, night.",
    ),
  windowless: z
    .boolean()
    .optional()
    .describe("true once the user confirms the Room has no Windows."),
  surfaces: z
    .object({
      walls: surfaceInput.optional(),
      ceiling: surfaceInput.optional(),
      floor: surfaceInput.optional(),
      woodwork: surfaceInput
        .optional()
        .describe("Skirting, door frames, doors, and window frames."),
    })
    .optional()
    .describe("The Room's four Surfaces. Only the Surfaces and fields given change."),
  walls: z
    .array(wallInput)
    .optional()
    .describe("Walls to add or change, by position. Walls not listed stay as they are."),
  windows: z
    .array(windowInput)
    .optional()
    .describe("Windows to add or change. Windows not listed stay as they are."),
  doors: z
    .array(doorInput)
    .optional()
    .describe(
      "Doors (doorways, with or without a door) to add or change. A Door is shared by the two " +
        "Rooms it joins; Doors not listed stay as they are.",
    ),
  features: z
    .array(featureInput)
    .optional()
    .describe(
      "Features to add or change: parts of the building that stay when the user moves out. " +
        "Features not listed stay as they are.",
    ),
  archive: archiveInput,
  archiveReason: archiveReasonInput,
  overrideProvenance: overrideProvenanceInput,
});

export type SaveRoomInput = z.input<typeof saveRoomInput>;
export type WallInput = z.input<typeof wallInput>;
export type WindowInput = z.input<typeof windowInput>;
export type DoorInput = z.input<typeof doorInput>;
export type FeatureInput = z.input<typeof featureInput>;

// ─── save_items ─────────────────────────────────────────────────────────────────────────────

export const itemInput = z.object({
  item: slugInput
    .optional()
    .describe("The slug of an existing Item to change; leave out to add an Item."),
  name: text
    .max(100)
    .optional()
    .describe('Needed to add an Item: e.g. "Grey sofa", "Oak bookcase".'),
  category: z
    .enum(ITEM_CATEGORIES)
    .optional()
    .describe(
      "Needed to add an Item: seating, tables, beds, storage, lighting, rugs, textiles " +
        "(curtains, cushions, throws), art-and-mirrors, decor, plants, appliances, electronics, " +
        "outdoor, or other.",
    ),
  quantity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Identical pieces kept as one Item, e.g. 6 dining chairs. Defaults to 1."),
  room: slugInput
    .optional()
    .describe("The slug of the Room it is in. A new Item without a Room is Unplaced."),
  unplaced: z
    .boolean()
    .optional()
    .describe("true to take it out of its Room: boxed, or in off-site storage."),
  wall: wallPosition
    .optional()
    .describe(
      "The position of the Wall of its Room it stands against; leave out if free-standing.",
    ),
  positionNote: text.max(200).optional().describe('Where it sits, e.g. "left of the window".'),
  width: measurementSchema.optional(),
  depth: measurementSchema.optional(),
  height: measurementSchema.optional(),
  colors: z.array(colorSchema).optional().describe("Its colors, replacing any recorded."),
  materials: z
    .array(text.max(60))
    .optional()
    .describe('Its materials, replacing any recorded, e.g. ["oak", "linen"].'),
  condition: z.enum(CONDITIONS).optional().describe("good, worn, or damaged."),
  brand: text.max(100).optional(),
  model: text.max(100).optional(),
  price: text.max(40).optional().describe('What it cost, with the currency, e.g. "£450".'),
  link: z.url().optional().describe("A link to the product page."),
  light: lightSchema.optional().describe("For an Item that gives light, such as a lamp."),
  archive: archiveInput,
  archiveReason: archiveReasonInput,
});

export const saveItemsInput = z.object({
  session: sessionInput,
  items: z
    .array(itemInput)
    .min(1)
    .describe("The Items to add or change, each confirmed by the user."),
  overrideProvenance: overrideProvenanceInput,
});

export type SaveItemsInput = z.input<typeof saveItemsInput>;
export type ItemInput = z.input<typeof itemInput>;

// ─── set_constraints, save_note ─────────────────────────────────────────────────────────────

export const setConstraintsInput = z.object({
  session: sessionInput,
  add: z
    .array(text.max(300))
    .optional()
    .describe(
      'Constraints to add, each in the wording the user agreed, e.g. "Rented: no painting".',
    ),
  remove: z
    .array(slugInput)
    .optional()
    .describe(
      "The slugs of Constraints to remove. A removed Constraint is Archived, never deleted.",
    ),
  reason: text.max(300).optional().describe("Why they are removed, quoting the user's permission."),
});

export const saveNoteInput = z.object({
  session: sessionInput,
  text: text
    .max(1000)
    .describe('One fact, in plain words, e.g. "The cat scratches fabric furniture".'),
});

export type SetConstraintsInput = z.input<typeof setConstraintsInput>;
export type SaveNoteInput = z.input<typeof saveNoteInput>;

// ─── find_items, search_notes ───────────────────────────────────────────────────────────────

export const findItemsInput = z.object({
  session: sessionInput,
  room: slugInput.optional().describe("Only Items in this Room (its slug)."),
  unplaced: z.boolean().optional().describe("true for only the Unplaced Items."),
  category: z.enum(ITEM_CATEGORIES).optional().describe("Only Items of this category."),
  text: text
    .optional()
    .describe("Only Items whose name, brand, model, materials, colors, or note contain this."),
  archived: z
    .boolean()
    .optional()
    .describe("true to include Archived Items (sold, broken, replaced)."),
});

export const searchNotesInput = z.object({
  session: sessionInput,
  query: text
    .optional()
    .describe("Words to look for; Notes with any of them come first. Leave out for every Note."),
});

export type FindItemsInput = z.input<typeof findItemsInput>;
export type SearchNotesInput = z.input<typeof searchNotesInput>;

export const getRoomSheetInput = z.object({
  session: sessionInput,
  room: slugInput.describe(
    'The Room\'s slug as the opening lists it ("living-room"); its name also works.',
  ),
  withSources: z
    .boolean()
    .optional()
    .describe(
      "true to show, after each value printed on a Blueprint, its Blueprint, page, and the text " +
        "exactly as printed: 3.62 m [agent-plan p.1: 3.62]. Only when a question needs them.",
    ),
});

export type GetRoomSheetInput = z.input<typeof getRoomSheetInput>;

// ─── Blueprints ─────────────────────────────────────────────────────────────────────────────

export const viewImagesInput = z.object({
  session: sessionInput,
  blueprint: slugInput.describe("The Blueprint's slug, as the Home Overview lists it."),
  pages: z
    .array(z.number().int().min(1))
    .min(1)
    .max(MAX_PAGES_PER_VIEW)
    .describe(
      "The pages to look at, from 1: at most 6 per call, usually the pages of one Level. Call " +
        "again for more.",
    ),
  crop: z
    .enum(QUARTERS)
    .optional()
    .describe(
      "Only this quarter of each page (top-left, top-right, bottom-left, bottom-right), at twice " +
        "the scale: for printed text too small to read on the whole page.",
    ),
});

/** Web only: the multipart form's fields, with the file as bytes. */
export const uploadBlueprintInput = z.object({
  home: homeInput,
  file: bytes.describe("The file's bytes: a PDF, PNG, or JPEG."),
  fileName: z.string().trim().min(1).max(255).describe("The file's name as uploaded."),
  label: text
    .max(100)
    .optional()
    .describe('e.g. "Estate agent plan". The file\'s name, without its extension, when left out.'),
});

export const listBlueprintsInput = z.object({ home: homeInput });

export const getBlueprintPageInput = z.object({
  home: homeInput,
  blueprint: slugInput.describe("The Blueprint's slug."),
  page: z.number().int().min(1).describe("The page, from 1."),
});

export type ViewImagesInput = z.input<typeof viewImagesInput>;
export type UploadBlueprintInput = z.input<typeof uploadBlueprintInput>;
export type ListBlueprintsInput = z.input<typeof listBlueprintsInput>;
export type GetBlueprintPageInput = z.input<typeof getBlueprintPageInput>;

// ─── Web read views ─────────────────────────────────────────────────────────────────────────

export const getRoomInput = z.object({
  home: homeInput,
  room: slugInput.describe("The Room's slug. Archived Rooms are found too."),
});

export const listItemsInput = z.object({
  home: homeInput,
  archived: z.boolean().optional().describe("true to include Archived Items."),
});

export const listConstraintsInput = z.object({
  home: homeInput,
  archived: z.boolean().optional().describe("true to include Archived Constraints."),
});

export const listNotesInput = z.object({ home: homeInput });

export const getChangeLogInput = z.object({
  home: homeInput,
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("At most this many; 200 by default."),
});

// ─── Records, as results carry them ─────────────────────────────────────────────────────────

export const namedRefSchema = z.object({ slug: z.string(), name: z.string() });

export const homeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  country: z.string(),
  city: z.string(),
  latitude: z.number(),
  homeFolderPath: z.string().optional(),
  tenure: z.enum(TENURES).optional(),
  plannedStay: z.enum(PLANNED_STAYS).optional(),
  buildingType: z.enum(BUILDING_TYPES).optional(),
  buildingEra: z.string().optional(),
  lift: z.boolean().optional(),
  liftDoorWidth: measurementSchema.optional(),
  liftCarDepth: measurementSchema.optional(),
  accessWidth: measurementSchema.optional(),
  accessNote: z.string().optional(),
});

export const levelSchema = z.object({ slug: z.string(), name: z.string(), storey: z.number() });

/** One page of a Blueprint, as rendered on upload. */
export const blueprintPageSchema = z.object({
  /** From 1. */
  page: z.number(),
  /** The Level the page shows, once mapped through save_home. */
  level: levelSchema.optional(),
  /** The rendered PNG's size in pixels, 2000 on the long edge, after the page's rotation. */
  width: z.number(),
  height: z.number(),
  /** Whether the page has a text layer, so its printed text is exact; a scan or photo has none. */
  hasText: z.boolean(),
});

export const blueprintSchema = z.object({
  slug: z.string(),
  /** The user's label, or the file's name without its extension. */
  label: z.string(),
  /** The file's name as uploaded. */
  fileName: z.string(),
  fileType: z.enum(BLUEPRINT_FILE_TYPES),
  pageCount: z.number(),
  uploadedAt: z.string(),
  /** In page order. */
  pages: z.array(blueprintPageSchema),
});

/** A Room as the Home lists it. */
export const roomSchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** The slug of the Level the Room is on. */
  level: z.string(),
});

export const surfaceSchema = z.object({
  /** "living-room/floor", or "living-room/wall-3/surface" for a whole-Wall exception. */
  slug: z.string(),
  part: z.enum(SURFACE_PARTS),
  /** For a whole-Wall exception: the Wall's slug. */
  wall: z.string().optional(),
  materials: z.array(materialSchema).optional(),
  color: colorSchema.optional(),
  finish: z.string().optional(),
});

export const wallSchema = z.object({
  /** "living-room/wall-2". */
  slug: z.string(),
  position: z.number(),
  length: measurementSchema.optional(),
  facing: z.enum(COMPASS_POINTS).optional(),
  beyond: z.object({
    kind: z.enum(["room", "outside", "unknown"]),
    room: namedRefSchema.extend({ outdoor: z.boolean() }).optional(),
  }),
  label: z.string().optional(),
  obstruction: z.enum(OBSTRUCTIONS).optional(),
  deciduous: z.boolean().optional(),
  /** The whole-Wall exception to the Room's walls Surface. */
  surface: surfaceSchema.optional(),
});

export const windowSchema = z.object({
  slug: z.string(),
  /** The Wall's slug, or "roof" for a skylight. */
  wall: z.string(),
  roofFacing: z.enum(COMPASS_POINTS).optional(),
  kind: z.enum(WINDOW_KINDS).optional(),
  width: measurementSchema.optional(),
  height: measurementSchema.optional(),
  sillHeight: measurementSchema.optional(),
  offset: measurementSchema.optional(),
  glass: z.enum(GLASS_KINDS).optional(),
});

/** A Door seen from one of the Rooms it joins: `wall` is that Room's side. */
export const doorSchema = z.object({
  slug: z.string(),
  /** The Wall of the viewing Room the Door is in, by slug. */
  wall: z.string().optional(),
  /** What is on the far side from the viewing Room. */
  to: z.enum(DOOR_SIDE_B_KINDS),
  otherRoom: namedRefSchema.optional(),
  otherWall: z.string().optional(),
  clearWidth: measurementSchema.optional(),
  height: measurementSchema.optional(),
  /** Along the Wall of the Room the Door was first recorded in (side A). */
  offset: measurementSchema.optional(),
  /** Whether the viewing Room is side A, the Room the offset is measured in. */
  sideA: z.boolean(),
  glazed: z.boolean().optional(),
  noDoor: z.boolean().optional(),
});

export const featureSchema = z.object({
  slug: z.string(),
  kind: z.enum(FEATURE_KINDS),
  description: z.string().optional(),
  wall: z.string().optional(),
  positionNote: z.string().optional(),
  width: measurementSchema.optional(),
  height: measurementSchema.optional(),
  depth: measurementSchema.optional(),
  light: lightSchema.optional(),
  archivedAt: z.string().optional(),
  archivedReason: z.string().optional(),
});

export const itemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.enum(ITEM_CATEGORIES),
  quantity: z.number(),
  /** Absent for an Unplaced Item. */
  room: namedRefSchema.optional(),
  wall: z.string().optional(),
  positionNote: z.string().optional(),
  width: measurementSchema.optional(),
  depth: measurementSchema.optional(),
  height: measurementSchema.optional(),
  colors: z.array(colorSchema).optional(),
  materials: z.array(z.string()).optional(),
  condition: z.enum(CONDITIONS).optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  price: z.string().optional(),
  link: z.string().optional(),
  light: lightSchema.optional(),
  archivedAt: z.string().optional(),
  archivedReason: z.string().optional(),
});

/** A light source in a Room: the Item or Feature that carries the light attributes. */
export const lightSourceSchema = z.object({
  source: z.enum(["item", "feature"]),
  slug: z.string(),
  name: z.string(),
  light: lightSchema,
});

/** Everything on a Room's Room Sheet, for the web UI's Room page. */
export const roomDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  level: levelSchema,
  functions: z.array(z.enum(ROOM_FUNCTIONS)),
  outdoor: z.boolean(),
  ceilingHeight: measurementSchema.optional(),
  timesOfUse: z.array(z.enum(TIMES_OF_USE)),
  windowless: z.boolean(),
  archivedAt: z.string().optional(),
  archivedReason: z.string().optional(),
  /** Clockwise, by position. */
  walls: z.array(wallSchema),
  windows: z.array(windowSchema),
  doors: z.array(doorSchema),
  /** The Room's own Surfaces, in the order walls, ceiling, floor, woodwork; only those recorded. */
  surfaces: z.array(surfaceSchema),
  features: z.array(featureSchema),
  items: z.array(itemSchema),
  lights: z.array(lightSourceSchema),
  /** What advice needs but is missing, e.g. "ceiling height". */
  gaps: z.array(z.string()),
});

export const constraintSchema = z.object({
  slug: z.string(),
  text: z.string(),
  archivedAt: z.string().optional(),
  archivedReason: z.string().optional(),
});

export const noteSchema = z.object({
  slug: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

export const changeSchema = z.object({
  at: z.string(),
  /** The Session's slug, or "web". */
  origin: z.string(),
  recordKind: z.string(),
  /** The changed record's slug. */
  record: z.string(),
  /** Absent when the record was created. */
  field: z.string().optional(),
  old: z.unknown().optional(),
  new: z.unknown().optional(),
  /** Why, when the write gave a reason: an override of Provenance, a removal. */
  reason: z.string().optional(),
});

export type Home = z.infer<typeof homeSchema>;
export type Level = z.infer<typeof levelSchema>;
export type Blueprint = z.infer<typeof blueprintSchema>;
export type BlueprintPage = z.infer<typeof blueprintPageSchema>;
export type Room = z.infer<typeof roomSchema>;
export type NamedRef = z.infer<typeof namedRefSchema>;
export type Wall = z.infer<typeof wallSchema>;
export type Window = z.infer<typeof windowSchema>;
export type Door = z.infer<typeof doorSchema>;
export type Surface = z.infer<typeof surfaceSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type Item = z.infer<typeof itemSchema>;
export type LightSource = z.infer<typeof lightSourceSchema>;
export type RoomDetail = z.infer<typeof roomDetailSchema>;
export type Constraint = z.infer<typeof constraintSchema>;
export type Note = z.infer<typeof noteSchema>;
export type ChangeEntry = z.infer<typeof changeSchema>;

// ─── Results ────────────────────────────────────────────────────────────────────────────────

/** Every Agent write returns a receipt: one line per change, refused parts, remaining Gaps. */
export const receiptResult = z.object({ receipt: z.string() });

export const getHomeResult = z.object({
  home: homeSchema,
  /** In storey order. */
  levels: z.array(levelSchema),
  /** The Rooms not Archived, by storey and then in the order they were recorded. */
  rooms: z.array(roomSchema),
  /** How many Items of the Inventory are in no Room. */
  unplacedItems: z.number(),
});

export const getRoomResult = z.object({ room: roomDetailSchema });
export const listItemsResult = z.object({ items: z.array(itemSchema) });
export const findItemsResult = z.object({ items: z.array(itemSchema) });
export const listConstraintsResult = z.object({ constraints: z.array(constraintSchema) });
export const listNotesResult = z.object({ notes: z.array(noteSchema) });
export const searchNotesResult = z.object({ notes: z.array(noteSchema) });
/** Newest first. */
export const getChangeLogResult = z.object({ changes: z.array(changeSchema) });

/** get_room_sheet: the Room Sheet as text. */
export const getRoomSheetResult = z.object({ sheet: z.string() });

export const uploadBlueprintResult = z.object({ blueprint: blueprintSchema });
/** In the order they were uploaded. */
export const listBlueprintsResult = z.object({ blueprints: z.array(blueprintSchema) });

/** One image view_images returns: a whole page, or a quarter of it. */
export const viewedPageSchema = blueprintPageSchema.extend({
  /** Set when only this quarter was rendered, at twice the page's scale. */
  crop: z.enum(QUARTERS).optional(),
  /** PNG, or JPEG (quality 85) when the page's PNG is over 1 MB. */
  mimeType: z.enum(IMAGE_TYPES),
  /** The image's bytes; `width` and `height` are its size. */
  data: bytes,
});

/** view_images: over MCP, one text block naming the pages, then one image block per page. */
export const viewImagesResult = z.object({
  blueprint: blueprintSchema,
  /** In the order asked for. */
  pages: z.array(viewedPageSchema),
});

/** get_blueprint_page: the rendered page, served as the PNG itself. */
export const getBlueprintPageResult = z.object({
  mimeType: z.literal("image/png"),
  data: bytes,
});

export type ReceiptResult = z.infer<typeof receiptResult>;
export type GetRoomSheetResult = z.infer<typeof getRoomSheetResult>;
export type UploadBlueprintResult = z.infer<typeof uploadBlueprintResult>;
export type ListBlueprintsResult = z.infer<typeof listBlueprintsResult>;
export type ViewedPage = z.infer<typeof viewedPageSchema>;
export type ViewImagesResult = z.infer<typeof viewImagesResult>;
export type GetBlueprintPageResult = z.infer<typeof getBlueprintPageResult>;
export type GetHomeResult = z.infer<typeof getHomeResult>;
export type GetRoomResult = z.infer<typeof getRoomResult>;
export type ListItemsResult = z.infer<typeof listItemsResult>;
export type FindItemsResult = z.infer<typeof findItemsResult>;
export type ListConstraintsResult = z.infer<typeof listConstraintsResult>;
export type ListNotesResult = z.infer<typeof listNotesResult>;
export type SearchNotesResult = z.infer<typeof searchNotesResult>;
export type GetChangeLogResult = z.infer<typeof getChangeLogResult>;
