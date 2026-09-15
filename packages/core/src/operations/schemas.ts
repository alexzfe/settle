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
  /**
   * In LAN mode (IDH_LAN=1): the address phones on the user's network reach, e.g.
   * "http://192.168.1.20:4380". It serves only the Quick Guide pages, at each Purchase's
   * guides.lanUrl.
   */
  lanUrl: z.string().optional(),
});

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

// ─── Decisions (slice 4: docs/specs/skill-set.md#decision-kinds and #rule-enforcement) ─────────

export const DECISION_KINDS = [
  "design-direction",
  "room-direction",
  "room-use",
  "palette",
  "room-color",
  "purchase",
  "other",
] as const;
export const DECISION_STATES = ["candidate", "leaning", "locked", "rejected"] as const;
export const CONTRASTS = ["low", "medium", "high"] as const;
export const PALETTE_ROLES = ["base", "secondary", "accent"] as const;
export const EVIDENCE_KINDS = ["note", "session", "decision"] as const;
export const STANCES = ["supports", "undermines"] as const;
export const STRENGTHS = ["must", "prefer"] as const;
/** What a Requirement's reason can point at: a Decision, a Constraint, a Note, or a recorded part. */
export const REQUIREMENT_REASON_KINDS = [
  "decision",
  "constraint",
  "note",
  "home",
  "room",
  "wall",
  "window",
  "door",
  "feature",
  "surface",
  "item",
] as const;
export const FLAG_CAUSES = ["reopened", "rejected", "deviation", "value_changed"] as const;
/** How the user resolves a flag or a Conflict. */
export const RESOLUTIONS = ["keep", "reopen", "reject"] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];
export type DecisionState = (typeof DECISION_STATES)[number];
export type Contrast = (typeof CONTRASTS)[number];
export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type Stance = (typeof STANCES)[number];
export type Strength = (typeof STRENGTHS)[number];
export type RequirementReasonKind = (typeof REQUIREMENT_REASON_KINDS)[number];
export type FlagCause = (typeof FLAG_CAUSES)[number];
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * The legal state transitions; the server refuses any other. Locked to leaning is a Reopen, and
 * rejected to candidate a revival.
 */
export const LEGAL_TRANSITIONS: Record<DecisionState, readonly DecisionState[]> = {
  candidate: ["leaning", "locked", "rejected"],
  leaning: ["candidate", "locked", "rejected"],
  locked: ["leaning", "rejected"],
  rejected: ["candidate"],
};

/** Where a kind's Decisions live: the Home as a whole, one Room, or either. */
export const DECISION_KIND_SCOPES: Record<DecisionKind, "home" | "room" | "either"> = {
  "design-direction": "home",
  "room-direction": "room",
  "room-use": "room",
  palette: "home",
  "room-color": "room",
  purchase: "either",
  other: "either",
};

const line = text.max(200);

/** One color of the Palette: a Color value with its role. */
export const paletteColorSchema = colorSchema.extend({
  role: z.enum(PALETTE_ROLES).describe("base, secondary, or accent."),
  note: line.optional().describe('Where it is meant to go, e.g. "walls throughout".'),
});

// Each kind's content, as stored and as results carry it. Strict: a field of another kind is
// refused, not dropped.

/** The Home's design philosophy. It names no specific colors; those belong to the Palette. */
export const designDirectionContent = z.strictObject({
  mood: line.optional(),
  temperature: z.enum(COLOR_TEMPERATURES).optional(),
  contrast: z.enum(CONTRASTS).optional(),
  keyMaterials: z.array(line).optional(),
  styleReferences: z.array(line).optional(),
  /** One line each. */
  principles: z.array(line).optional(),
});

/** One paragraph refining the Design Direction for one Room, with optional overrides. */
export const roomDirectionContent = z.strictObject({
  direction: text.max(1500),
  mood: line.optional(),
  contrast: z.enum(CONTRASTS).optional(),
});

/** What a Room will be used for; Fulfilment sets the Room's functions. */
export const roomUseContent = z.strictObject({
  functions: z.array(z.enum(ROOM_FUNCTIONS)).min(1),
});

export const paletteContent = z.strictObject({ colors: z.array(paletteColorSchema).min(1) });

/** A Surface of the Room (or one Wall's), a Palette color by name, and a finish. */
export const roomColorContent = z.strictObject({
  surface: z.enum(SURFACE_PARTS),
  wall: wallPosition.optional(),
  color: text.max(100),
  finish: text.max(60),
});

/** A Purchase carries Requirements (and, from slice 6, Guides and Listings), not content. */
export const purchaseContent = z.strictObject({});
export const otherContent = z.strictObject({});

/** Each kind's content schema, which save_decision validates the content against. */
export const DECISION_CONTENT = {
  "design-direction": designDirectionContent,
  "room-direction": roomDirectionContent,
  "room-use": roomUseContent,
  palette: paletteContent,
  "room-color": roomColorContent,
  purchase: purchaseContent,
  other: otherContent,
} as const satisfies Record<DecisionKind, z.ZodObject>;

/** A Decision's kind with its content, so a result narrows the content by kind. */
export const decisionKindContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("design-direction"), content: designDirectionContent }),
  z.object({ kind: z.literal("room-direction"), content: roomDirectionContent }),
  z.object({ kind: z.literal("room-use"), content: roomUseContent }),
  z.object({ kind: z.literal("palette"), content: paletteContent }),
  z.object({ kind: z.literal("room-color"), content: roomColorContent }),
  z.object({ kind: z.literal("purchase"), content: purchaseContent }),
  z.object({ kind: z.literal("other"), content: otherContent }),
]);

export type PaletteColor = z.infer<typeof paletteColorSchema>;
export type DesignDirectionContent = z.infer<typeof designDirectionContent>;
export type RoomDirectionContent = z.infer<typeof roomDirectionContent>;
export type RoomUseContent = z.infer<typeof roomUseContent>;
export type PaletteContent = z.infer<typeof paletteContent>;
export type RoomColorContent = z.infer<typeof roomColorContent>;
export type DecisionKindContent = z.infer<typeof decisionKindContentSchema>;

// ─── save_decision ──────────────────────────────────────────────────────────────────────────

/**
 * The Agent's content: every kind's fields in one object, each saying which kinds take it, so the
 * tool schema stays lean. save_decision validates it against the kind's own schema.
 */
export const decisionContentInput = z
  .object({
    mood: line
      .optional()
      .describe(
        'design-direction; room-direction only to override the Direction\'s: e.g. "calm, grounded".',
      ),
    temperature: z
      .enum(COLOR_TEMPERATURES)
      .optional()
      .describe("design-direction: color temperature, warm, neutral, or cool."),
    contrast: z
      .enum(CONTRASTS)
      .optional()
      .describe("design-direction; room-direction only to override: low, medium, or high."),
    keyMaterials: z
      .array(line)
      .optional()
      .describe('design-direction: key materials, one each, e.g. "oak", "linen".'),
    styleReferences: z
      .array(line)
      .optional()
      .describe(
        'design-direction: style references, one each, e.g. "Japandi", or what an inspiration ' +
          "image the user showed has.",
      ),
    principles: z
      .array(line)
      .optional()
      .describe("design-direction: guiding principles, one line each."),
    direction: text
      .max(1500)
      .optional()
      .describe(
        "room-direction, required: one paragraph on how the Room should feel, refining the " +
          "Design Direction.",
      ),
    functions: z
      .array(z.enum(ROOM_FUNCTIONS))
      .min(1)
      .optional()
      .describe(
        "room-use, required: what the Room is to be used for: kitchen, dining, living, bedroom, " +
          "office, bathroom, hallway, stairs, storage, utility, garage, other.",
      ),
    colors: z
      .array(paletteColorSchema)
      .min(1)
      .optional()
      .describe("palette, required: its colors, each with a role."),
    surface: z
      .enum(SURFACE_PARTS)
      .optional()
      .describe("room-color, required: walls, ceiling, floor, or woodwork."),
    wall: wallPosition
      .optional()
      .describe(
        "room-color, with surface walls: a Wall's position, when the color is for that Wall alone.",
      ),
    color: text
      .max(100)
      .optional()
      .describe(
        "room-color, required: the name of a color of the Palette in force (the Locked one, else " +
          "the Leaning one); any other is refused.",
      ),
    finish: text.max(60).optional().describe('room-color, required: e.g. "matt", "eggshell".'),
  })
  .describe(
    "The kind's own fields, replacing any recorded content; each field says which kinds take " +
      "it. Leave out for purchase and other.",
  );

export const evidenceInput = z.object({
  kind: z.enum(EVIDENCE_KINDS).describe("note, session, or decision."),
  id: slugInput.describe(
    "A Note's slug (search_notes lists them), a Session's id (this one's, for what the user " +
      "said or showed in it), or a Decision's slug.",
  ),
  stance: z.enum(STANCES).describe("supports or undermines."),
  note: line.optional().describe("What it shows, in one line."),
});

export const requirementReasonInput = z.object({
  kind: z
    .enum(REQUIREMENT_REASON_KINDS)
    .describe(
      "What it comes from: decision, constraint, note, home (its lift and narrowest access), " +
        "room, wall, window, door, feature, surface, or item.",
    ),
  id: slugInput
    .optional()
    .describe(
      'Its slug, e.g. "two-cats", "living-room/wall-2", "living-room/floor"; not for home.',
    ),
  field: text
    .max(60)
    .optional()
    .describe(
      'The one field it rests on, when only that field matters, e.g. "length" of a Wall or ' +
        '"accessWidth" of the home.',
    ),
});

export const requirementInput = z.object({
  position: z
    .number()
    .int()
    .min(1)
    .max(99)
    .optional()
    .describe(
      "Its place in the list, from 1. A position that exists changes that Requirement; leave " +
        "out to add one at the end.",
    ),
  text: line.optional().describe('Needed to add one: plain words, e.g. "under 85 cm tall".'),
  strength: z.enum(STRENGTHS).optional().describe("Needed to add one: must or prefer."),
  reason: requirementReasonInput.optional().describe("Needed to add one: where it comes from."),
  archive: archiveInput,
});

const decisionSlugInput = slugInput.describe(
  "The Decision's slug, as the opening, find_decisions, or a receipt gives it.",
);

export const saveDecisionInput = z.object({
  session: sessionInput,
  decision: slugInput
    .optional()
    .describe(
      "The slug of the Decision to change. Leave out to create one (one of the same kind, " +
        "scope, and title that is not Rejected is changed instead of duplicated).",
    ),
  kind: z
    .enum(DECISION_KINDS)
    .describe(
      "design-direction, room-direction, room-use, palette, room-color, purchase, or other. " +
        "It never changes once created.",
    ),
  room: slugInput
    .optional()
    .describe(
      "The slug of the Room it is about. Needed for room-direction, room-use, and room-color; " +
        "never given for design-direction or palette; left out for a Home-wide purchase or other.",
    ),
  title: text
    .max(100)
    .describe('A short name, e.g. "Warm minimalism", "Office for the spare room".'),
  statement: text.max(500).describe("The Decision itself, in one line."),
  content: decisionContentInput.optional(),
  basis: z
    .array(slugInput)
    .optional()
    .describe(
      "The slugs of the Decisions it rests on, replacing the recorded Basis. The Design " +
        "Direction is in every Basis automatically, and the Palette in force in a room-color's: " +
        "don't list them.",
    ),
  evidence: z
    .array(evidenceInput)
    .optional()
    .describe(
      "Evidence to add: Notes, Sessions, or Decisions that support or undermine it. Giving a " +
        "source already recorded changes its stance and note.",
    ),
  requirements: z
    .array(requirementInput)
    .optional()
    .describe(
      "purchase only: Requirements to add or change, by position. Those not listed stay as " +
        "they are.",
    ),
});

export type SaveDecisionInput = z.input<typeof saveDecisionInput>;
export type DecisionContentInput = z.input<typeof decisionContentInput>;
export type EvidenceInput = z.input<typeof evidenceInput>;
export type RequirementInput = z.input<typeof requirementInput>;

// ─── set_decision_state, flag_conflict, record_fulfilment ───────────────────────────────────

/** The Agent's state change: its Session and a non-empty reason are required. */
export const setDecisionStateInput = z.object({
  session: sessionInput,
  decision: decisionSlugInput,
  to: z
    .enum(DECISION_STATES)
    .describe(
      "candidate, leaning, locked, or rejected; or its current state, to keep a flagged Decision " +
        "as it is.",
    ),
  reason: z
    .string()
    .max(1000)
    .describe("Why, in a sentence; quote the user's words when they gave permission. Never empty."),
});

/** The web UI's optional reason: an empty one is no reason. */
const webReason = z.string().trim().max(1000).optional();

/** The same operation from the web UI: no Session, and the reason is optional. */
export const setDecisionStateWebInput = z.object({
  home: homeInput,
  decision: decisionSlugInput,
  to: z.enum(DECISION_STATES),
  reason: webReason,
});

export const flagConflictInput = z.object({
  session: sessionInput,
  decision: decisionSlugInput.describe("The slug of the Locked Decision it contradicts."),
  description: text
    .max(500)
    .describe("What contradicts it, in a sentence or two, e.g. what the user now says."),
});

/** A Requirement of a Purchase, by its position: its identity for as long as it lives. */
const requirementPosition = z
  .number()
  .int()
  .min(1)
  .max(99)
  .describe("The Requirement's position, as get_decision numbers it.");

/** One difference between what a Purchase asked for and what was bought. */
export const deviationInput = z.object({
  requirement: requirementPosition,
  text: line.describe(
    'The difference, in plain words: "92 cm tall, not under 85 cm", "rust, not terracotta".',
  ),
  reason: line
    .optional()
    .describe(
      'Why the user took it anyway, in their words: "only size in stock", "S/ 150 over, but the ' +
        'last one". Leave out when they gave none.',
    ),
});

/** The Item a Purchase bought: a new Item of the Inventory. */
export const fulfilmentItemInput = itemInput
  .omit({ item: true, archive: true, archiveReason: true })
  .extend({
    name: text.max(100).describe('What it is called, e.g. "Wool rug", "Oak armchair".'),
    category: itemInput.shape.category
      .unwrap()
      .describe(itemInput.shape.category.description ?? ""),
    room: slugInput
      .optional()
      .describe("The slug of the Room it is in; the Purchase's Room when left out."),
    unplaced: z.boolean().optional().describe("true when it is in no Room yet: still boxed."),
  });

/** A part of the building a Purchase bought (a radiator): a new Feature of a Room. */
export const fulfilmentFeatureInput = featureInput
  .omit({ feature: true, archive: true, archiveReason: true })
  .extend({
    kind: featureInput.shape.kind.unwrap().describe(featureInput.shape.kind.description ?? ""),
    room: slugInput
      .optional()
      .describe("The slug of the Room it is in; the Purchase's Room when left out."),
  });

export const recordFulfilmentInput = z.object({
  session: sessionInput,
  decision: decisionSlugInput.describe("The slug of the Locked Decision that was carried out."),
  bought: line
    .optional()
    .describe(
      'Purchase, required: what was actually bought, in one line, e.g. "Hay Plain rug, 200 × ' +
        '300 cm, rust, £450".',
    ),
  deviations: z
    .array(deviationInput)
    .optional()
    .describe(
      "Purchase: each Requirement what was bought differs from, with the difference. A " +
        "Deviation from a must flags every Decision resting on this Purchase.",
    ),
  item: fulfilmentItemInput
    .optional()
    .describe("Purchase: the Item bought, added to the Inventory. Leave out when it is a Feature."),
  replacesItem: slugInput
    .optional()
    .describe("Purchase: the slug of the Item it replaces, which is Archived as replaced by it."),
  feature: fulfilmentFeatureInput
    .optional()
    .describe("Purchase: a part of the building bought (a radiator, a light point), as a Feature."),
  replacesFeature: slugInput
    .optional()
    .describe(
      "Purchase: the slug of the Feature it replaces, which is Archived as replaced by it.",
    ),
  roomFunctions: z
    .array(z.enum(ROOM_FUNCTIONS))
    .optional()
    .describe(
      "Room use: the functions the Room actually has now, only when they differ from what was " +
        "decided.",
    ),
  finish: text
    .max(60)
    .optional()
    .describe(
      'Room color: the finish actually applied (e.g. "satin"), only when it differs from what ' +
        "was decided.",
    ),
  overrideProvenance: overrideProvenanceInput.describe(
    "Room color: only when the user has said to replace the Surface's color with a weaker-" +
      "Provenance one (e.g. one identified by its code with one that has none): their words, " +
      "quoted. Without it such a replacement is refused and nothing is recorded.",
  ),
});

export type SetDecisionStateInput = z.input<typeof setDecisionStateInput>;
export type SetDecisionStateWebInput = z.input<typeof setDecisionStateWebInput>;
export type FlagConflictInput = z.input<typeof flagConflictInput>;
export type RecordFulfilmentInput = z.input<typeof recordFulfilmentInput>;
export type DeviationInput = z.input<typeof deviationInput>;
export type FulfilmentItemInput = z.input<typeof fulfilmentItemInput>;
export type FulfilmentFeatureInput = z.input<typeof fulfilmentFeatureInput>;

// ─── Purchases (slice 6): save_guides, record_listing, and the web's Shopping operations ─────

/** A Listing's result against one Requirement. */
export const CHECK_RESULTS = ["pass", "fail", "unknown"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const saveGuidesInput = z.object({
  session: sessionInput,
  decision: decisionSlugInput.describe("The slug of the Purchase the Guides are for."),
  quickLines: z
    .array(line)
    .max(8)
    .optional()
    .describe(
      "The Quick Guide's own lines, replacing any saved: what to avoid and what to test in the " +
        'shop, one short line each ("Avoid loop pile: claws catch in it", "Press the pile: it ' +
        'should spring back"). Not the Requirements and not "Measure first": the app puts those ' +
        "in itself, from the Requirements, so they never go stale.",
    ),
  fullGuide: z
    .string()
    .trim()
    .min(1)
    .max(20000)
    .optional()
    .describe(
      "The Full Guide, in Markdown under headings you pick for the product, replacing any " +
        "saved: what to look for and why, to read ahead of time. Every must Requirement explains " +
        "why. It is marked out of date when a Requirement changes after it was written.",
    ),
});

export type SaveGuidesInput = z.input<typeof saveGuidesInput>;

export const listingCheckInput = z.object({
  requirement: requirementPosition,
  result: z
    .enum(CHECK_RESULTS)
    .describe("pass, fail, or unknown (the listing doesn't say, or can't be judged from it)."),
  note: line
    .optional()
    .describe('What decided it, in a few words: "200 × 140 cm", "not stated", "loop pile".'),
});

/** A product's size as its listing states it: no Provenance, since nobody measured it here. */
export const listingDimensionsSchema = z.object({
  width: z.number().int().min(1).optional().describe("Whole millimetres."),
  depth: z.number().int().min(1).optional().describe("Whole millimetres."),
  height: z.number().int().min(1).optional().describe("Whole millimetres."),
});

export const recordListingInput = z.object({
  session: sessionInput,
  decision: decisionSlugInput.describe("The slug of the Purchase the Listing is for."),
  listing: slugInput
    .optional()
    .describe("The slug of a Listing already recorded, to change it; leave out to add one."),
  name: text
    .max(150)
    .optional()
    .describe('Needed to add one: the product as its listing names it, e.g. "Hay Plain rug".'),
  url: z.url().optional().describe("The product page."),
  price: text.max(40).optional().describe('With the currency, e.g. "£450".'),
  dimensions: listingDimensionsSchema
    .optional()
    .describe("Its size as the listing states it, replacing any recorded."),
  photo: text.max(500).optional().describe("A link to the product's photo."),
  checks: z
    .array(listingCheckInput)
    .optional()
    .describe(
      "Its result against each Requirement, by position. Adding a Listing needs one for every " +
        "Requirement; changing one replaces the checks given and keeps the others, and it must " +
        "then have one for every Requirement too.",
    ),
});

export type ListingCheckInput = z.input<typeof listingCheckInput>;
export type ListingDimensions = z.infer<typeof listingDimensionsSchema>;
export type RecordListingInput = z.input<typeof recordListingInput>;

/** get_shopping: the Home's Shopping List and Considering. */
export const getShoppingInput = z.object({ home: homeInput });

export const EXPORT_SHOPPING_FORMATS = ["html", "csv"] as const;
export const EXPORT_GUIDE_FORMATS = ["html", "markdown"] as const;

/** export_shopping_list: the Shopping List as a printable page or CSV. */
export const exportShoppingListInput = z.object({
  home: homeInput,
  format: z.enum(EXPORT_SHOPPING_FORMATS),
});

/** export_guides: the Shopping Guides of one Purchase, or of every one, as a page or Markdown. */
export const exportGuidesInput = z.object({
  home: homeInput,
  decision: slugInput
    .optional()
    .describe("One Purchase's slug; every Purchase with Guides when left out."),
  format: z.enum(EXPORT_GUIDE_FORMATS),
});

/**
 * get_guide_page: the Quick Guide as a phone-readable HTML page without JavaScript, by the
 * Home and the Decision's slug (the loopback route), or by its LAN token alone (the LAN route).
 */
export const getGuidePageInput = z.object({
  home: homeInput.optional(),
  decision: slugInput.optional(),
  token: z.string().min(1).optional(),
});

export type GetShoppingInput = z.input<typeof getShoppingInput>;
export type ExportShoppingListInput = z.input<typeof exportShoppingListInput>;
export type ExportGuidesInput = z.input<typeof exportGuidesInput>;
export type GetGuidePageInput = z.input<typeof getGuidePageInput>;

// ─── find_decisions, get_decision, and the web's Decision operations ────────────────────────

export const findDecisionsInput = z.object({
  session: sessionInput,
  room: slugInput.optional().describe("Only the Decisions about this Room (its slug)."),
  homeWide: z.boolean().optional().describe("true for only the Home-wide Decisions."),
  kind: z.enum(DECISION_KINDS).optional().describe("Only Decisions of this kind."),
  state: z.enum(DECISION_STATES).optional().describe("Only Decisions in this state."),
});

const includeFullGuideInput = z
  .boolean()
  .optional()
  .describe(
    "true to include a Purchase's Full Guide in full; otherwise it is one line saying when it " +
      "was written and whether it is out of date. Only when the work needs its text.",
  );

export const getDecisionInput = z.object({
  session: sessionInput,
  decision: decisionSlugInput,
  includeFullGuide: includeFullGuideInput,
});

/** get_decision from the web UI, for the Decision page. */
export const getDecisionWebInput = z.object({
  home: homeInput,
  decision: decisionSlugInput,
  includeFullGuide: includeFullGuideInput,
});

export const listDecisionsInput = z.object({
  home: homeInput,
  room: slugInput.optional().describe("Only the Decisions about this Room (its slug)."),
  kind: z.enum(DECISION_KINDS).optional(),
  state: z.enum(DECISION_STATES).optional(),
});

export const resolveFlagInput = z.object({
  home: homeInput,
  flag: slugInput.describe('The flag\'s slug, "<decision slug>/flag-<n>".'),
  resolution: z
    .enum(RESOLUTIONS)
    .describe("keep the Decision as it is, reopen it (Locked only), or reject it."),
  reason: webReason,
});

export const resolveConflictInput = z.object({
  home: homeInput,
  conflict: slugInput.describe('The Conflict\'s slug, "<decision slug>/conflict-<n>".'),
  resolution: z.enum(RESOLUTIONS),
  reason: webReason,
});

export type FindDecisionsInput = z.input<typeof findDecisionsInput>;
export type GetDecisionInput = z.input<typeof getDecisionInput>;
export type GetDecisionWebInput = z.input<typeof getDecisionWebInput>;
export type ListDecisionsInput = z.input<typeof listDecisionsInput>;
export type ResolveFlagInput = z.input<typeof resolveFlagInput>;
export type ResolveConflictInput = z.input<typeof resolveConflictInput>;

// ─── Decision records, as results carry them ────────────────────────────────────────────────

export const decisionRefSchema = z.object({ slug: z.string(), title: z.string() });

/** A mark on a Decision that something it rests on changed; the user clears it. */
export const flagSchema = z.object({
  /** "<decision slug>/flag-<n>". */
  slug: z.string(),
  /** The flagged Decision. */
  decision: decisionRefSchema,
  cause: z.enum(FLAG_CAUSES),
  /**
   * What changed: for reopened, rejected, and deviation, the Decision in the flagged one's Basis;
   * for value_changed, the record a Requirement's reason points at (kind is a Requirement reason
   * kind), with the field that changed when the reason names one.
   */
  source: z.object({
    kind: z.string(),
    slug: z.string(),
    name: z.string(),
    field: z.string().optional(),
  }),
  raisedAt: z.string(),
  /** Set once the user kept, reopened, or rejected the flagged Decision. */
  clearedAt: z.string().optional(),
  resolution: z.enum(RESOLUTIONS).optional(),
  reason: z.string().optional(),
});

/** New Evidence contradicting a Locked Decision; only the user resolves it. */
export const conflictSchema = z.object({
  /** "<decision slug>/conflict-<n>". */
  slug: z.string(),
  decision: decisionRefSchema,
  description: z.string(),
  /** The Session that raised it. */
  session: z.string().optional(),
  raisedAt: z.string(),
  resolvedAt: z.string().optional(),
  resolution: z.enum(RESOLUTIONS).optional(),
  reason: z.string().optional(),
});

/** One Decision as a list shows it: one line's worth, with its open flags and Conflicts. */
export const decisionSummarySchema = z.object({
  slug: z.string(),
  kind: z.enum(DECISION_KINDS),
  title: z.string(),
  statement: z.string(),
  state: z.enum(DECISION_STATES),
  /** The Room it is about; absent for a Home-wide Decision. */
  room: namedRefSchema.optional(),
  createdAt: z.string(),
  /** When its action was carried out. Fulfilled is not a state: the Decision stays Locked. */
  fulfilledAt: z.string().optional(),
  openFlags: z.array(flagSchema),
  openConflicts: z.array(conflictSchema),
  /** A Palette's colors, for swatches in a list; absent for every other kind. */
  colors: z.array(paletteColorSchema).optional(),
});

/** A Decision of the Basis. */
export const basisEntrySchema = z.object({
  slug: z.string(),
  title: z.string(),
  kind: z.enum(DECISION_KINDS),
  state: z.enum(DECISION_STATES),
  fulfilledAt: z.string().optional(),
  /**
   * Joined automatically and stored: the Design Direction in force when the Decision was created
   * (in every Basis but a Design Direction's), or the Palette in force when it started using its
   * colors (a Room color, or a Purchase with a Requirement whose reason is the Palette). It stays
   * until the user keeps or Reopens the Decision after a flag from it. `kind` says which.
   */
  automatic: z.boolean(),
});

export const evidenceEntrySchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  /** The Note's, Session's, or Decision's slug. */
  id: z.string(),
  /** The Note's text, the Session's day and Skills, or the Decision's title. */
  name: z.string(),
  stance: z.enum(STANCES),
  note: z.string().optional(),
});

export const requirementSchema = z.object({
  position: z.number(),
  text: z.string(),
  strength: z.enum(STRENGTHS),
  reason: z.object({
    kind: z.enum(REQUIREMENT_REASON_KINDS),
    /** The record's slug; the Home's for home. */
    id: z.string(),
    /** A readable name for the record. */
    name: z.string(),
    field: z.string().optional(),
  }),
});

export const stateChangeSchema = z.object({
  from: z.enum(DECISION_STATES),
  to: z.enum(DECISION_STATES),
  /** The Session's slug, or "web". */
  origin: z.string(),
  reason: z.string().optional(),
  at: z.string(),
});

/** What was actually done when a Decision was Fulfilled. */
export const fulfilmentSchema = z.object({
  /** Room use: the Room's functions as set. */
  roomFunctions: z.array(z.enum(ROOM_FUNCTIONS)).optional(),
  /** Room color: the Surface painted, by slug ("living-room/walls", "living-room/wall-3/surface"). */
  surface: z.string().optional(),
  /** Room color: the color the Surface now has, with its Provenance. */
  color: colorSchema.optional(),
  /** Room color: the finish applied. */
  finish: z.string().optional(),
  /** Purchase: what was actually bought, in one line. */
  bought: z.string().optional(),
  /** Purchase: the Item it added to the Inventory, by slug. */
  item: z.string().optional(),
  /** Purchase: the Item it replaced, now Archived, by slug. */
  replacedItem: z.string().optional(),
  /** Purchase: the Feature it added, by slug. */
  feature: z.string().optional(),
  /** Purchase: the Feature it replaced, now Archived, by slug. */
  replacedFeature: z.string().optional(),
});

/**
 * One line of the Quick Guide, which core assembles and never stores whole: "Measure first" lines
 * for every must resting on an Estimated (or unrecorded) value, then the musts, then the prefers,
 * each by position, then the AI's own lines.
 */
export const QUICK_GUIDE_LINE_KINDS = ["measure-first", "must", "prefer", "line"] as const;

export const quickGuideLineSchema = z.object({
  kind: z.enum(QUICK_GUIDE_LINE_KINDS),
  /**
   * What the line says: "Measure first: living-room/wall-5 length (~3.70 m)", a Requirement's
   * text, or one of the AI's lines.
   */
  text: z.string(),
  /** For a must or prefer: its Requirement's position. */
  requirement: z.number().optional(),
});

export const quickGuideSchema = z.object({
  lines: z.array(quickGuideLineSchema),
  /** The phone page on this computer: "/guide/<decision slug>?home=<home slug>". */
  path: z.string(),
});

/** The Full Guide's state; its Markdown only when asked for with includeFullGuide. */
export const fullGuideSchema = z.object({
  writtenAt: z.string(),
  /** When a Requirement first changed after it was written; absent while it is up to date. */
  requirementsChangedAt: z.string().optional(),
  outOfDate: z.boolean(),
  markdown: z.string().optional(),
});

/** A Purchase's saved Guides: the AI's Quick Guide lines and its Full Guide. */
export const guidesSchema = z.object({
  quickLines: z.array(z.string()),
  /** Absent until a Full Guide is saved. */
  fullGuide: fullGuideSchema.optional(),
  /** In LAN mode: the Quick Guide's URL for a phone on the same network, for a QR code. */
  lanUrl: z.string().optional(),
});

/** One Listing's result against one Requirement not Archived. */
export const listingCheckSchema = z.object({
  /** The Requirement's position. */
  requirement: z.number(),
  text: z.string(),
  strength: z.enum(STRENGTHS),
  result: z.enum(CHECK_RESULTS),
  note: z.string().optional(),
  /** true when the Requirement came after the Listing was checked: counted as unknown. */
  unchecked: z.boolean().optional(),
});

/** A real product considered for a Purchase, checked against its Requirements. */
export const listingSchema = z.object({
  slug: z.string(),
  name: z.string(),
  url: z.string().optional(),
  price: z.string().optional(),
  dimensions: listingDimensionsSchema.optional(),
  photo: z.string().optional(),
  recordedAt: z.string(),
  /** One per Requirement not Archived, by position. */
  checks: z.array(listingCheckSchema),
  counts: z.object({ pass: z.number(), fail: z.number(), unknown: z.number() }),
  /** The positions of the must Requirements it fails. */
  failedMusts: z.array(z.number()),
});

/** A difference between what a Purchase asked for and what was bought, recorded on Fulfilment. */
export const deviationSchema = z.object({
  /** "<decision slug>/deviation-<n>". */
  slug: z.string(),
  /** The Requirement's position, text, and strength. */
  requirement: z.number(),
  requirementText: z.string(),
  strength: z.enum(STRENGTHS),
  text: z.string(),
  /** Why it was accepted, when the user said. */
  reason: z.string().optional(),
  recordedAt: z.string(),
});

export type QuickGuideLine = z.infer<typeof quickGuideLineSchema>;
export type QuickGuide = z.infer<typeof quickGuideSchema>;
export type FullGuide = z.infer<typeof fullGuideSchema>;
export type Guides = z.infer<typeof guidesSchema>;
export type ListingCheck = z.infer<typeof listingCheckSchema>;
export type Listing = z.infer<typeof listingSchema>;
export type Deviation = z.infer<typeof deviationSchema>;

/** One Decision in full, for get_decision and the Decision page. Its content narrows by kind. */
export const decisionDetailSchema = decisionSummarySchema
  .omit({ kind: true, colors: true })
  .extend({
    fulfilment: fulfilmentSchema.optional(),
    /**
     * Room color: its color as the Palette in its Basis has it, for a swatch; absent when it has
     * no Palette in its Basis or that Palette has no color of that name.
     */
    paletteColor: paletteColorSchema.optional(),
    /**
     * The automatic entries first (its Design Direction, then its Palette), then the Decisions
     * given, in their order.
     */
    basis: z.array(basisEntrySchema),
    /**
     * The automatic entries it lacks: a Design Direction or Palette in force that applies to it
     * but joined after it was last saved or moved, and a Room color's Palette always. Each joins
     * on its next save or state change. Absent when it lacks none.
     */
    missingAutomatic: z.array(z.enum(["design-direction", "palette"])).optional(),
    evidence: z.array(evidenceEntrySchema),
    /** Not Archived, by position. */
    requirements: z.array(requirementSchema),
    /** Every flag, cleared ones too, oldest first. */
    flags: z.array(flagSchema),
    /** Every Conflict, resolved ones too, oldest first. */
    conflicts: z.array(conflictSchema),
    /** Oldest first. */
    stateChanges: z.array(stateChangeSchema),
    /** Purchase: the Quick Guide as assembled from its Requirements and Guides. */
    quickGuide: quickGuideSchema.optional(),
    /** Purchase: its saved Guides; absent until save_guides. */
    guides: guidesSchema.optional(),
    /** Purchase: its Listings, in the order they were recorded; empty for other kinds. */
    listings: z.array(listingSchema),
    /** Purchase: the Deviations recorded when it was Fulfilled; empty otherwise. */
    deviations: z.array(deviationSchema),
  })
  .and(decisionKindContentSchema);

export type DecisionRef = z.infer<typeof decisionRefSchema>;
export type Flag = z.infer<typeof flagSchema>;
export type Conflict = z.infer<typeof conflictSchema>;
export type DecisionSummary = z.infer<typeof decisionSummarySchema>;
export type BasisEntry = z.infer<typeof basisEntrySchema>;
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type StateChange = z.infer<typeof stateChangeSchema>;
export type Fulfilment = z.infer<typeof fulfilmentSchema>;
export type DecisionDetail = z.infer<typeof decisionDetailSchema>;

// ─── Decision results ───────────────────────────────────────────────────────────────────────

/**
 * list_decisions (web) and find_decisions (Agent): Home-wide Decisions first, then each Room's in
 * the Rooms' order, each group in the order the Decisions were created. Archived ones never.
 */
export const listDecisionsResult = z.object({ decisions: z.array(decisionSummarySchema) });
export const findDecisionsResult = listDecisionsResult;
export const getDecisionResult = z.object({ decision: decisionDetailSchema });

/**
 * set_decision_state, resolve_flag, and resolve_conflict: the receipt (one line per change, then
 * the Decisions it flagged), and the Decision as it now is.
 */
export const decisionReceiptResult = z.object({
  receipt: z.string(),
  decision: decisionSummarySchema,
});

/** get_room: the Room, and its Candidate, Leaning, and Locked-but-not-Fulfilled Decisions. */
export const getRoomResult = z.object({
  room: roomDetailSchema,
  decisions: z.array(decisionSummarySchema),
});

export type ListDecisionsResult = z.infer<typeof listDecisionsResult>;
export type FindDecisionsResult = z.infer<typeof findDecisionsResult>;
export type GetDecisionResult = z.infer<typeof getDecisionResult>;
export type DecisionReceiptResult = z.infer<typeof decisionReceiptResult>;

// ─── Purchase results (slice 6) ─────────────────────────────────────────────────────────────

/** One Purchase as the Shopping section lists it. */
export const shoppingEntrySchema = z.object({
  slug: z.string(),
  title: z.string(),
  statement: z.string(),
  state: z.enum(DECISION_STATES),
  /** Absent for a Home-wide Purchase. */
  room: namedRefSchema.optional(),
  /** How many Requirements it has, not Archived. */
  requirements: z.object({ must: z.number(), prefer: z.number() }),
  /** Whether its Quick Guide lines or Full Guide are saved. */
  hasGuides: z.boolean(),
  fullGuideOutOfDate: z.boolean(),
  listings: z.number(),
  /** Its Quick Guide's "Measure first" lines, in full. */
  measureFirst: z.array(z.string()),
  openFlags: z.number(),
});

/**
 * get_shopping: the Shopping List (Locked Purchases not yet Fulfilled) and Considering (Candidate
 * and Leaning ones), each Home-wide first and then by Room, in the order they were created.
 */
export const getShoppingResult = z.object({
  shoppingList: z.array(shoppingEntrySchema),
  considering: z.array(shoppingEntrySchema),
});

/** export_shopping_list, export_guides, and get_guide_page: a file to serve as it is. */
export const exportResult = z.object({
  /** "text/html; charset=utf-8", "text/csv; charset=utf-8", or "text/markdown; charset=utf-8". */
  mimeType: z.string(),
  /** A name to save it under, e.g. "fixture-home-shopping-list.csv". */
  fileName: z.string(),
  text: z.string(),
});

export type ShoppingEntry = z.infer<typeof shoppingEntrySchema>;
export type GetShoppingResult = z.infer<typeof getShoppingResult>;
export type ExportResult = z.infer<typeof exportResult>;
