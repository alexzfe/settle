// Seeds the demo Home through its MCP endpoint, as five Sessions would leave it: a rented top-floor
// flat in Lisbon, with an attic study and a roof terrace, for the README's screenshots and for a
// stranger's first look at the app. The flat, its people, and every Listing are invented, and the
// Listings' URLs are example.com; the paints and owned appliances use real brands, as anyone's would.
//
// It leaves behind: two Levels and seven measured Rooms with Walls, Windows, Doors, Surfaces, and
// Features; twenty-two Items, one with a full register and one Archived; three Constraints and
// four Notes; and Decisions in every state — a Settled Design Direction and Palette, Settled and
// Leaning Room Directions, a Fulfilled Room color, a Candidate one, a Rejected idea, and four
// Purchases: a Leaning sofa with a full Quick Guide and four rated, pictured Listings (one Held),
// Settled curtains flagged by a re-measured ceiling, a Fulfilled dining table, and a Candidate
// sofa bed. The sofa pictures are drawings in scripts/demo-home/, uploaded through the web API.
//
// Lisbon because it is metric, prices in euros read anywhere, and its latitude and a south-west
// street front give the daylight machinery something real to say.
//
// Create the Home first, then seed it; it refuses a Home that already has Rooms:
//   curl -X POST http://127.0.0.1:4391/api/create_home -H 'content-type: application/json' \
//     -d '{"name":"Lisbon flat","country":"PT","city":"Lisbon"}'
// Usage: node scripts/seed-demo-home.mjs http://127.0.0.1:4391/mcp/homes/lisbon-flat [token]
//
// Against a server with SETTLE_PASSWORD, log in for the create_home call first (curl -c jar -d
// password=… <origin>/login, then -b jar on the call above), and give the Home's key, from its
// About page's .mcp.json, as the second argument or SETTLE_TOKEN; the script sends it on every
// MCP call, and logs in with SETTLE_PASSWORD for the picture uploads. Without a password, on
// loopback, neither is needed.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [url, tokenArgument] = process.argv.slice(2);
if (!url) throw new Error("Usage: node scripts/seed-demo-home.mjs <MCP endpoint URL> [token]");
// The listing pictures go through the web API beside the MCP endpoint, as the app uploads them.
const { origin, pathname } = new URL(url);
const home = pathname.split("/").at(-1);
const token = tokenArgument ?? process.env.SETTLE_TOKEN;
const authorization = token ? { authorization: `Bearer ${token}` } : {};

/** The web API's session cookie, from logging in with SETTLE_PASSWORD; none without one. */
async function logIn() {
  const password = process.env.SETTLE_PASSWORD;
  if (!password) return {};
  const response = await fetch(`${origin}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (response.status !== 303 || !cookie) {
    throw new Error(`Logging in at ${origin}/login failed: HTTP ${response.status}`);
  }
  return { cookie };
}

let id = 0;

/** Calls one tool and returns its result; throws on a JSON-RPC error or a refused call. */
async function call(name, args) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...authorization,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} from ${url}`);
  const body = await response.json();
  if (body.error || body.result?.isError) {
    throw new Error(`${name}: ${JSON.stringify(body.error ?? body.result.content)}`);
  }
  return body.result;
}

const textOf = (result) => result.content?.find((block) => block.type === "text")?.text ?? "";

/** Opens a Session and returns its id and a writer that passes it on every call. */
async function open(skill) {
  const opening = textOf(await call("open_session", { skill }));
  // The opening's first line is "Session: <id>".
  const session = /^Session: (\S+)/m.exec(opening)?.[1];
  if (!session) throw new Error(`open_session returned no Session id: ${opening}`);
  return { session, opening, run: (name, args) => call(name, { session, ...args }) };
}

const measured = (mm) => ({ mm, provenance: "measured" });
const estimated = (mm) => ({ mm, provenance: "estimated" });

// ─── Home Intake ────────────────────────────────────────────────────────────────────────────

const intake = await open("home-intake");
if (!/^Rooms: none recorded yet/m.test(intake.opening)) {
  await intake.run("close_session", {
    summary: { changed: "Nothing.", open: "Nothing.", next: "Nothing." },
  });
  throw new Error("This Home already has Rooms. Seed a freshly created Home.");
}
const { run } = intake;

await run("save_home", {
  tenure: "rented",
  plannedStay: "3-10-years",
  buildingType: "apartment",
  buildingEra: "1940s block, top floor",
  lift: true,
  liftDoorWidth: measured(700),
  liftCarDepth: measured(1050),
  accessWidth: measured(700),
  accessNote: "the lift door; the stairwell turns tighter still",
  levels: [
    { name: "Fourth floor", storey: 4 },
    { name: "Attic", storey: 5 },
    { level: "ground", remove: true },
  ],
});

// The Hallway comes first so the Rooms off it can name it beyond their Walls; its Doors follow
// once those Rooms exist.
await run("save_room", {
  name: "Hallway",
  level: "fourth-floor",
  functions: ["hallway"],
  ceilingHeight: measured(2950),
  windowless: true,
  walls: [
    { position: 1, length: measured(1100), label: "front door end" },
    { position: 2, length: measured(6800) },
    { position: 3, length: measured(1100), label: "attic stair end" },
    { position: 4, length: measured(6800) },
  ],
  surfaces: { floor: { materials: [{ material: "pine boards, original" }] } },
  features: [
    { kind: "other", description: "steep timber stair up to the attic", wall: 3 },
    { kind: "light-point", description: "two ceiling lights" },
  ],
});

await run("save_room", {
  name: "Living room",
  level: "fourth-floor",
  functions: ["living", "dining"],
  ceilingHeight: measured(2950),
  timesOfUse: ["daytime", "evening"],
  walls: [
    {
      position: 1,
      length: measured(5200),
      facing: "sw",
      beyond: "outside",
      obstruction: "partly",
      label: "street wall",
    },
    // Clockwise from the street wall, each Wall faces a quarter-turn further round.
    { position: 2, length: measured(3900), facing: "nw", beyond: "unknown", label: "party wall" },
    {
      position: 3,
      length: measured(5200),
      facing: "ne",
      label: "hallway wall",
      beyond: "hallway",
    },
    { position: 4, length: estimated(3900), facing: "se", beyond: "unknown", label: "sofa wall" },
  ],
  surfaces: {
    walls: {
      materials: [{ material: "lime plaster" }],
      color: { name: "warm off-white", hex: "#eeebe3", provenance: "estimated" },
      finish: "matt",
    },
    ceiling: {
      materials: [{ material: "plaster" }],
      color: { name: "white", hex: "#f7f5f0", provenance: "estimated" },
    },
    floor: {
      materials: [{ material: "pine boards, original" }],
      color: { name: "honey pine", hex: "#c79a66", provenance: "estimated" },
    },
    woodwork: {
      color: { name: "white", hex: "#f4f2ec", provenance: "estimated" },
      finish: "satin",
    },
  },
  windows: [
    {
      wall: 1,
      width: measured(1100),
      height: measured(2200),
      sillHeight: measured(450),
      offset: measured(700),
    },
  ],
  doors: [
    {
      wall: 1,
      sideB: "outside",
      glazed: true,
      clearWidth: measured(1100),
      height: measured(2400),
      offset: measured(3100),
    },
    // Recorded from this side, so the Living room page can place it: a Door's offset runs along
    // the Wall of the Room it was first recorded in. It opens by the sofa wall's corner.
    {
      wall: 3,
      otherRoom: "hallway",
      otherWall: 2,
      clearWidth: measured(780),
      height: measured(2100),
      offset: measured(4220),
    },
  ],
  features: [
    { kind: "light-point", positionNote: "ceiling centre, with a plaster rose" },
    {
      kind: "other",
      description: "wall-mounted air conditioning unit",
      wall: 2,
      positionNote: "high, near the window",
    },
  ],
});

await run("save_room", {
  name: "Kitchen",
  level: "fourth-floor",
  functions: ["kitchen"],
  ceilingHeight: measured(2950),
  timesOfUse: ["morning", "evening"],
  walls: [
    { position: 1, length: measured(3100), facing: "ne", beyond: "outside", obstruction: "partly" },
    { position: 2, length: measured(2600) },
    { position: 3, length: measured(3100), label: "hallway wall", beyond: "hallway" },
    { position: 4, length: measured(2600) },
  ],
  surfaces: {
    walls: { color: { name: "white", provenance: "estimated" }, finish: "eggshell" },
    floor: { materials: [{ material: "hydraulic cement tiles, grey and ochre" }] },
  },
  windows: [{ wall: 1, width: measured(900), height: measured(1400), sillHeight: measured(1050) }],
  features: [
    { kind: "fitted-units", description: "white units along one wall, laminate worktop", wall: 2 },
    {
      kind: "tiling-or-panelling",
      description: "blue-and-white azulejo tiles to 1.5 m, 1940s",
      wall: 2,
    },
    {
      kind: "light-point",
      description: "strip light over the worktop",
      light: { role: "task", colorTemperature: "cool", brightness: 900, dimming: "none" },
    },
  ],
});

await run("save_room", {
  name: "Bedroom",
  level: "fourth-floor",
  functions: ["bedroom"],
  ceilingHeight: measured(2950),
  timesOfUse: ["night", "morning"],
  walls: [
    { position: 1, length: measured(4000), facing: "ne", beyond: "outside", obstruction: "open" },
    { position: 2, length: measured(3400), beyond: "kitchen" },
    { position: 3, length: measured(4000), label: "hallway wall", beyond: "hallway" },
    { position: 4, length: measured(3400), beyond: "unknown", label: "bed wall" },
  ],
  surfaces: {
    walls: {
      color: {
        name: "Joa's White",
        brand: "Farrow & Ball",
        code: "No. 226",
        provenance: "measured",
      },
      finish: "matt",
    },
    floor: { materials: [{ material: "pine boards, original" }] },
  },
  windows: [
    {
      wall: 1,
      width: measured(1100),
      height: measured(1900),
      sillHeight: measured(800),
      offset: measured(1450),
    },
  ],
  features: [
    {
      kind: "light-point",
      description: "ceiling fan with a light",
      positionNote: "ceiling centre",
      light: { role: "ambient", colorTemperature: "neutral", brightness: 600, dimming: "none" },
    },
    { kind: "built-in-storage", description: "shallow cupboard beside the chimney", wall: 2 },
  ],
});

await run("save_room", {
  name: "Bathroom",
  level: "fourth-floor",
  functions: ["bathroom"],
  ceilingHeight: measured(2950),
  timesOfUse: ["morning", "night"],
  walls: [
    { position: 1, length: measured(1800), facing: "ne", beyond: "outside" },
    { position: 2, length: measured(2200) },
    { position: 3, length: measured(1800), label: "hallway wall", beyond: "hallway" },
    { position: 4, length: measured(2200), beyond: "bedroom" },
  ],
  surfaces: {
    walls: { materials: [{ material: "white ceramic tiles" }] },
    floor: { materials: [{ material: "terrazzo" }] },
  },
  windows: [{ wall: 1, width: measured(600), height: measured(900), glass: "obscured" }],
  features: [
    { kind: "fitted-units", description: "bath with shower over, pedestal basin", wall: 2 },
  ],
});

await run("save_room", {
  room: "hallway",
  name: "Hallway",
  walls: [{ position: 2, beyond: "living-room" }],
  doors: [
    { wall: 1, sideB: "outside", clearWidth: measured(820), height: measured(2100) },
    {
      wall: 4,
      otherRoom: "kitchen",
      otherWall: 3,
      clearWidth: measured(720),
      offset: measured(300),
    },
    {
      wall: 4,
      otherRoom: "bedroom",
      otherWall: 3,
      clearWidth: measured(780),
      offset: measured(3000),
    },
    {
      wall: 4,
      otherRoom: "bathroom",
      otherWall: 3,
      clearWidth: measured(680),
      offset: measured(5700),
    },
  ],
});

await run("save_room", {
  name: "Roof terrace",
  level: "attic",
  outdoor: true,
  functions: ["dining", "other"],
  surfaces: { floor: { materials: [{ material: "terracotta tiles" }] } },
});

await run("save_room", {
  name: "Study",
  level: "attic",
  functions: ["office"],
  ceilingHeight: estimated(2300),
  timesOfUse: ["daytime"],
  walls: [
    { position: 1, length: measured(3600), label: "low wall under the eaves" },
    { position: 2, length: measured(2800), facing: "sw", beyond: "roof-terrace" },
    { position: 3, length: measured(3600) },
    { position: 4, length: measured(2800) },
  ],
  surfaces: {
    walls: { color: { name: "white", provenance: "estimated" }, finish: "matt" },
    floor: { materials: [{ material: "cork tiles" }] },
    ceiling: { materials: [{ material: "painted timber boards" }] },
  },
  windows: [{ wall: "roof", roofFacing: "sw", kind: "roof", width: measured(780) }],
  // The terrace is reachable only through this glazed door.
  doors: [{ wall: 2, otherRoom: "roof-terrace", glazed: true, clearWidth: measured(760) }],
  features: [
    { kind: "beam-or-column", description: "exposed roof beam, 2.0 m off the floor at its lowest" },
  ],
});

await run("save_items", {
  items: [
    {
      name: "Old two-seat sofa",
      category: "seating",
      room: "living-room",
      wall: 4,
      width: measured(1650),
      depth: measured(880),
      height: measured(800),
      colors: [{ name: "faded blue", provenance: "estimated" }],
      materials: ["cotton"],
      condition: "worn",
      positionNote: "a hand-me-down; the dog's bed in all but name",
    },
    {
      name: "Flea-market armchair",
      category: "seating",
      room: "living-room",
      positionNote: "by the window",
      materials: ["beech", "rattan"],
      condition: "good",
      boughtOn: "2024-05",
      boughtFrom: "Feira da Ladra",
      pricePaid: "€60",
    },
    {
      name: "Teak sideboard",
      category: "storage",
      room: "living-room",
      wall: 2,
      width: measured(1600),
      depth: measured(450),
      height: measured(750),
      materials: ["teak"],
      condition: "good",
      boughtOn: "2024-02",
      boughtFrom: "OLX",
      pricePaid: "€180",
    },
    {
      name: "Record player",
      category: "electronics",
      room: "living-room",
      positionNote: "on the sideboard",
    },
    {
      name: "Bentwood dining chair",
      category: "seating",
      quantity: 4,
      room: "living-room",
      positionNote: "round the table, by the window",
      materials: ["beech"],
      condition: "worn",
    },
    {
      name: "Linen floor lamp",
      category: "lighting",
      room: "living-room",
      positionNote: "behind the armchair",
      light: { role: "ambient", colorTemperature: 2700, brightness: 600, dimming: "standard" },
    },
    {
      name: "Olive tree in a clay pot",
      category: "plants",
      room: "living-room",
      positionNote: "by the balcony door",
      height: estimated(1500),
    },
    {
      name: "Azulejo tile print",
      category: "art-and-mirrors",
      room: "living-room",
      wall: 3,
      width: measured(500),
      height: measured(700),
    },
    {
      name: "Fridge-freezer",
      category: "appliances",
      room: "kitchen",
      wall: 4,
      width: measured(600),
      depth: measured(660),
      height: measured(1860),
      brand: "Bosch",
      model: "KGN36",
      boughtOn: "2025-03-14",
      boughtFrom: "Worten",
      pricePaid: "€649",
      warrantyUntil: "2028-03-14",
      serialNumber: "KGN36-4471902",
    },
    {
      name: "Espresso machine",
      category: "appliances",
      room: "kitchen",
      positionNote: "on the worktop by the window",
      boughtOn: "2024",
      pricePaid: "€119",
    },
    {
      name: "Bistro table",
      category: "tables",
      room: "kitchen",
      wall: 1,
      width: measured(700),
      depth: measured(700),
      materials: ["marble", "cast iron"],
    },
    {
      name: "Double bed",
      category: "beds",
      room: "bedroom",
      wall: 4,
      width: measured(1600),
      depth: measured(2050),
      materials: ["pine"],
    },
    {
      name: "Wardrobe",
      category: "storage",
      room: "bedroom",
      wall: 2,
      width: estimated(1000),
      depth: estimated(580),
      height: estimated(2010),
      brand: "IKEA",
    },
    {
      name: "Bedside lamp",
      category: "lighting",
      quantity: 2,
      room: "bedroom",
      light: { role: "task", colorTemperature: 2700, brightness: 400, dimming: "none" },
    },
    {
      name: "Linen bedding",
      category: "textiles",
      room: "bedroom",
      colors: [{ name: "terracotta", provenance: "estimated" }],
      materials: ["linen"],
    },
    {
      name: "Trestle desk",
      category: "tables",
      room: "study",
      wall: 4,
      width: measured(1400),
      depth: measured(700),
      materials: ["oak veneer", "steel"],
    },
    {
      name: "Desk chair",
      category: "seating",
      room: "study",
      boughtOn: "2023-09",
      pricePaid: "€240",
      warrantyUntil: "2028-09",
    },
    {
      name: "Bookshelves",
      category: "storage",
      room: "study",
      wall: 3,
      width: measured(1600),
      height: measured(1800),
      depth: measured(300),
    },
    {
      name: "Folding bistro set",
      category: "outdoor",
      room: "roof-terrace",
      materials: ["painted steel"],
      colors: [{ name: "sage green", provenance: "estimated" }],
    },
    {
      name: "Herb pots",
      category: "plants",
      quantity: 5,
      room: "roof-terrace",
      positionNote: "along the parapet: rosemary, basil, mint",
    },
    {
      name: "Guest mattress",
      category: "beds",
      positionNote: "rolled up under the bed until the sofa bed arrives",
    },
    { name: "Desk lamp", category: "lighting", room: "study" },
  ],
});
await run("save_items", {
  items: [{ item: "desk-lamp", archive: true, archiveReason: "broken" }],
});

await run("set_constraints", {
  add: [
    "Rented: no drilling into the azulejo tiles",
    "Our dog, Sardinha, sleeps on the sofa",
    "Everything has to come up in the lift or the stairwell",
  ],
  reason: 'The user: "yes, those three"',
});
/** Saves a Note and returns its slug, which the receipt gives as "Note (<slug>): saved". */
async function note(text) {
  const receipt = textOf(await run("save_note", { text }));
  const slug = /^Note \((\S+)\)/.exec(receipt)?.[1];
  if (!slug) throw new Error(`save_note returned no slug: ${receipt}`);
  return slug;
}
const legsTuckedUp = await note("We both sit with our legs tucked up on the sofa");
const afternoonSun = await note("The afternoon sun hits the living room from about 3 pm in summer");
const familyVisits = await note("Family visit from Porto three or four times a year");
await note("We both work from home on Mondays and Fridays");

await run("close_session", {
  summary: {
    changed:
      "Recorded the flat: two Levels, seven Rooms with their Walls, Windows, Doors, Surfaces, " +
      "and Features, twenty-two Items, three Constraints, and four Notes.",
    open: "The sofa wall in the living room was only estimated; the Study's ceiling height too.",
    next: "Design Direction, to settle how the flat should feel.",
  },
});

// ─── Design Direction ───────────────────────────────────────────────────────────────────────

const design = await open("design-direction");
const move = (session) => (decision, to, reason) =>
  call("set_decision_state", { session: session.session, decision, to, reason });
const designMove = move(design);

await design.run("save_decision", {
  kind: "design-direction",
  title: "Lisbon light",
  statement:
    "Bright, warm rooms that let the light do the work: limewash, oak, linen, and cork, and a " +
    "few old things with a story.",
  content: {
    mood: "bright by day, warm and low at night",
    temperature: "warm",
    contrast: "medium",
    keyMaterials: ["limewash", "oak", "linen", "cork", "terracotta", "rattan"],
    styleReferences: ["Portuguese vernacular", "1960s Scandinavian", "Siza's white interiors"],
    principles: [
      "Take the glare off the sun with linen, never blackout",
      "Second-hand first; new only when it has to last",
      "Nothing precious where the dog goes",
      "Every piece has to fit the lift",
    ],
  },
  evidence: [
    {
      kind: "session",
      id: design.session,
      stance: "supports",
      note: "The user showed photos of a whitewashed Alentejo house they rented one summer.",
    },
  ],
});
await designMove("lisbon-light", "leaning", "The user: \"that's it, that's the feeling\"");
await designMove("lisbon-light", "settled", 'The user: "settle it"');

await design.run("save_decision", {
  kind: "other",
  room: "kitchen",
  title: "Keep the azulejos",
  statement: "The 1940s blue-and-white tiles stay, and everything in the kitchen works with them.",
});
await designMove("keep-the-azulejos", "settled", 'The user: "we love them, they stay"');

await design.run("save_decision", {
  kind: "room-direction",
  room: "living-room",
  title: "Afternoon room",
  statement: "A room for long afternoons: soft light through linen, low seating, lamps at night.",
  content: {
    direction:
      "Keep the afternoon sun but take the glare off it with unlined linen at the window and " +
      "the balcony door. The sofa sits side-on to the light along the sofa wall, facing the " +
      "sideboard and the record player; the table stays by the window for lunch. After dark, " +
      "no ceiling light — the floor lamp, a table lamp on the sideboard, candles.",
    mood: "slow, sunlit",
  },
});
await designMove("afternoon-room", "settled", 'The user: "yes, exactly, settle the living room"');

await design.run("save_decision", {
  kind: "room-direction",
  room: "bedroom",
  title: "Quiet and cool",
  statement: "A calm, cool bedroom on the quiet side: pale walls, nothing on the floor.",
  content: {
    direction:
      "The bedroom faces the courtyard and gets only early sun, so keep it pale and cool, with " +
      "terracotta only in the bedding. Clear the floor: the wardrobe takes everything.",
    contrast: "low",
  },
});
await designMove(
  "quiet-and-cool",
  "leaning",
  'The user: "probably, let\'s see how the paint looks"',
);

await design.run("save_decision", {
  kind: "room-use",
  room: "study",
  title: "A study that sleeps a guest",
  statement: "The attic stays a study, and takes a sofa bed for when family visit.",
  content: { functions: ["office", "bedroom"] },
  evidence: [
    {
      kind: "note",
      id: familyVisits,
      stance: "supports",
    },
  ],
});
await designMove(
  "a-study-that-sleeps-a-guest",
  "leaning",
  'The user: "I think so, if a sofa bed fits up the stair"',
);

await design.run("save_decision", {
  kind: "other",
  room: "hallway",
  title: "Built-in wardrobe along the hallway",
  statement: "Floor-to-ceiling cupboards down one side of the hallway.",
});
await designMove(
  "built-in-wardrobe-along-the-hallway",
  "rejected",
  'The user: "the landlord said no, and it would make the hallway a tunnel"',
);

await design.run("close_session", {
  summary: {
    changed:
      "Settled the Design Direction Lisbon light, keeping the azulejos, and the living room's " +
      "Afternoon room.",
    open: "The bedroom's direction; the study as a guest room.",
    next: "Color: a Palette for Lisbon light.",
  },
});

// ─── Color ──────────────────────────────────────────────────────────────────────────────────

const color = await open("color");
const colorMove = move(color);

await color.run("save_decision", {
  kind: "palette",
  title: "Chalk and terracotta",
  statement: "Warm chalky whites throughout, a stone for the bedroom, terracotta and sage accents.",
  content: {
    colors: [
      {
        name: "Wimborne White",
        brand: "Farrow & Ball",
        code: "No. 239",
        hex: "#eee9da",
        provenance: "measured",
        role: "base",
        note: "walls and ceilings throughout",
      },
      {
        name: "Joa's White",
        brand: "Farrow & Ball",
        code: "No. 226",
        hex: "#e2d6c2",
        provenance: "measured",
        role: "base",
        note: "the bedroom walls",
      },
      {
        name: "Green Smoke",
        brand: "Farrow & Ball",
        code: "No. 47",
        hex: "#6b7766",
        provenance: "measured",
        role: "secondary",
        note: "the study, under the eaves",
      },
      {
        name: "Red Earth",
        brand: "Farrow & Ball",
        code: "No. 64",
        hex: "#ad6a50",
        provenance: "measured",
        role: "accent",
        note: "textiles and pots, never a whole wall",
      },
    ],
  },
  evidence: [
    {
      kind: "session",
      id: color.session,
      stance: "supports",
      note: "The user compared the samples at the window at 5 pm.",
    },
  ],
});
await colorMove("chalk-and-terracotta", "settled", 'The user: "these four, settle them"');

await color.run("save_decision", {
  kind: "room-color",
  room: "bedroom",
  title: "Bedroom walls in Joa's White",
  statement: "The bedroom walls in Joa's White, matt, warmer than the courtyard light.",
  content: { surface: "walls", color: "Joa's White", finish: "matt" },
  basis: ["quiet-and-cool"],
});
await colorMove("bedroom-walls-in-joas-white", "settled", 'The user: "go on, settle it"');
await color.run("record_fulfilment", { decision: "bedroom-walls-in-joas-white" });

await color.run("save_decision", {
  kind: "room-color",
  room: "study",
  title: "Study walls in Green Smoke",
  statement:
    "The study's walls in Green Smoke, to make the low room feel held rather than cramped.",
  content: { surface: "walls", color: "Green Smoke", finish: "matt" },
});

await color.run("close_session", {
  summary: {
    changed: "Settled the Palette Chalk and terracotta; painted the bedroom in Joa's White.",
    open: "Whether the study goes Green Smoke.",
    next: "Purchase: the sofa.",
  },
});

// ─── Purchase ───────────────────────────────────────────────────────────────────────────────

const purchase = await open("purchase");
const purchaseMove = move(purchase);

await purchase.run("save_decision", {
  kind: "purchase",
  room: "living-room",
  title: "A sofa for the living room",
  statement: "A deep three-seater along the sofa wall, in place of the old two-seater.",
  basis: ["afternoon-room"],
  evidence: [
    {
      kind: "note",
      id: legsTuckedUp,
      stance: "supports",
      note: "Deep seats, not a formal sofa.",
    },
  ],
  requirements: [
    {
      text: "At most 2.2 m wide, so the hallway door still opens past it",
      strength: "must",
      reason: { kind: "wall", id: "living-room/wall-4", field: "length" },
    },
    {
      text: "Comes up in the 70 cm lift: modular, or boxes under 68 cm deep",
      strength: "must",
      reason: { kind: "home", field: "liftDoorWidth" },
    },
    {
      text: "Seat 55–60 cm deep, for sitting with legs tucked up",
      strength: "must",
      reason: { kind: "note", id: legsTuckedUp },
    },
    {
      text: "Covers that zip off and go in the wash",
      strength: "prefer",
      reason: { kind: "constraint", id: "our-dog-sardinha-sleeps-on-the-sofa" },
    },
    {
      text: "A warm mid-tone — oatmeal, rust, or olive — never white",
      strength: "prefer",
      reason: { kind: "decision", id: "chalk-and-terracotta" },
    },
  ],
});
await purchaseMove(
  "a-sofa-for-the-living-room",
  "leaning",
  'The user: "the modular one, probably, but we want to sit on it first"',
);

await purchase.run("save_guides", {
  decision: "a-sofa-for-the-living-room",
  lookingFor: "Deep 3-seater · modular · washable covers · oatmeal, rust or olive · ≤ 2.2 m",
  quickLines: [
    { kind: "avoid", text: "One-piece frames over 68 cm deep — they won't turn into the lift" },
    { kind: "avoid", text: "Bouclé and loose weaves — the dog's claws pull the loops" },
    { kind: "test", text: "Sit 5 min with your legs tucked up: no front rail in your calves" },
    { kind: "test", text: "Lift one corner: a solid frame doesn't twist or creak" },
    { kind: "test", text: "Unzip a seat cushion: foam wrapped in fibre, not loose fibre" },
    { kind: "ask", text: "Can the covers go in a 40 °C wash, or dry-clean only?" },
    { kind: "ask", text: "Is carrying it up four floors included, or extra?" },
  ],
  fullGuide: sofaGuide(),
});

const listing = (input) =>
  purchase.run("record_listing", { decision: "a-sofa-for-the-living-room", ...input });
await listing({
  name: "Tejo modular sofa, 3 seats",
  url: "https://www.example.com/tejo-modular-sofa-3-seats",
  price: "€1,390",
  dimensions: { width: 2120, depth: 980, height: 780 },
  rating: 4,
  ratingNote: "Ticks every box; the corduroy may not survive the dog",
  checks: [
    { requirement: 1, result: "pass", note: "212 cm" },
    { requirement: 2, result: "pass", note: "three modules, 66 cm boxes" },
    { requirement: 3, result: "pass", note: "58 cm seat" },
    { requirement: 4, result: "pass", note: "zip-off, 30 °C" },
    { requirement: 5, result: "pass", note: "rust corduroy" },
  ],
});
// The best-made of the four, rated so although it fails the lift: the strongest sign that the
// Requirement deserves a second look (could it go up the stairwell?).
await listing({
  name: "Linho 2.5-seat sofa",
  url: "https://www.example.com/linho-sofa",
  price: "€1,180",
  dimensions: { width: 1980, depth: 900, height: 820 },
  rating: 5,
  ratingNote: "The best one we sat on, but one piece, 90 cm deep",
  checks: [
    { requirement: 1, result: "pass", note: "198 cm" },
    { requirement: 2, result: "fail", note: "one piece, 90 cm deep" },
    { requirement: 3, result: "pass", note: "57 cm seat" },
    { requirement: 4, result: "pass", note: "loose linen covers" },
    { requirement: 5, result: "pass", note: "oatmeal linen" },
  ],
});
await listing({
  name: "Kobe sofa, flat-pack",
  url: "https://www.example.com/kobe-sofa",
  price: "€590",
  dimensions: { width: 2080, depth: 880, height: 760 },
  rating: 2,
  ratingNote: "Cheap and easy up the lift, but shallow and wobbly",
  checks: [
    { requirement: 1, result: "pass", note: "208 cm" },
    { requirement: 2, result: "pass", note: "flat-packed" },
    { requirement: 3, result: "fail", note: "48 cm seat" },
    { requirement: 4, result: "unknown", note: "not stated" },
    { requirement: 5, result: "pass", note: "olive" },
  ],
});
await listing({
  name: "Estrela corner sofa",
  url: "https://www.example.com/estrela-corner-sofa",
  price: "€1,850",
  dimensions: { width: 2600, depth: 1650, height: 800 },
  rating: 3,
  ratingNote: "Lovely and deep, but too long for the wall and pricey",
  held: { reason: "too-expensive-now", note: "waiting for the January sale" },
  checks: [
    { requirement: 1, result: "fail", note: "260 cm" },
    { requirement: 2, result: "pass", note: "four modules" },
    { requirement: 3, result: "pass", note: "60 cm seat" },
    { requirement: 4, result: "pass", note: "zip-off" },
    { requirement: 5, result: "unknown", note: "swatches only online" },
  ],
});

// Each sofa's picture, a drawing beside this script, sent the way the app's picture box sends one.
const session = await logIn();
for (const sofa of [
  "tejo-modular-sofa-3-seats",
  "linho-2-5-seat-sofa",
  "kobe-sofa-flat-pack",
  "estrela-corner-sofa",
]) {
  const form = new FormData();
  form.append("home", home);
  form.append("listing", sofa);
  const bytes = readFileSync(join(import.meta.dirname, "demo-home", `${sofa}.png`));
  form.append("file", new Blob([bytes], { type: "image/png" }), `${sofa}.png`);
  const response = await fetch(`${origin}/api/set_listing_photo`, {
    method: "POST",
    headers: session,
    body: form,
  });
  if (!response.ok) throw new Error(`set_listing_photo ${sofa}: ${await response.text()}`);
}

await purchase.run("save_decision", {
  kind: "purchase",
  room: "living-room",
  title: "Linen curtains",
  statement: "Unlined linen curtains at the window and the balcony door, ceiling to floor.",
  basis: ["afternoon-room"],
  evidence: [
    {
      kind: "note",
      id: afternoonSun,
      stance: "supports",
    },
  ],
  requirements: [
    {
      text: "2.8 m drop, from a ceiling track to just off the floor",
      strength: "must",
      reason: { kind: "room", id: "living-room", field: "ceilingHeight" },
    },
    {
      text: "Unlined: the sun comes through, softened, not shut out",
      strength: "must",
      reason: { kind: "decision", id: "lisbon-light" },
    },
    {
      text: "Natural linen or a warm white, not grey",
      strength: "prefer",
      reason: { kind: "decision", id: "chalk-and-terracotta" },
    },
  ],
});
await purchase.run("save_guides", {
  decision: "linen-curtains",
  lookingFor: "Unlined linen · natural or warm white · 280 cm drop · 4 panels",
  quickLines: [
    { kind: "avoid", text: "Linen-look polyester — it shines in low sun" },
    { kind: "test", text: "Hold it to the light: you see the glow, not the street" },
    { kind: "ask", text: "Pre-washed? Unwashed linen shrinks 3–5%" },
  ],
});
await purchase.run("record_listing", {
  decision: "linen-curtains",
  name: "Stonewashed linen curtain, 140 × 290 cm",
  url: "https://www.example.com/stonewashed-linen-curtain",
  price: "€89 each",
  rating: 4,
  ratingNote: "Right weight and colour; hem them to 280 at home",
  checks: [
    { requirement: 1, result: "pass", note: "290 cm, hem to fit" },
    { requirement: 2, result: "pass", note: "unlined" },
    { requirement: 3, result: "pass", note: "natural" },
  ],
});
await purchaseMove("linen-curtains", "settled", 'The user: "four of those, settle it"');

await purchase.run("save_decision", {
  kind: "purchase",
  room: "living-room",
  title: "Extending dining table",
  statement: "A table for four by the window that opens out to six when family visit.",
  basis: ["afternoon-room"],
  requirements: [
    {
      text: "Seats four, extends to six",
      strength: "must",
      reason: { kind: "note", id: familyVisits },
    },
    {
      text: "At most 85 cm wide, to leave the window clear",
      strength: "must",
      reason: { kind: "window", id: "living-room-window" },
    },
    {
      text: "Solid oak",
      strength: "prefer",
      reason: { kind: "decision", id: "lisbon-light" },
    },
  ],
});
await purchase.run("record_listing", {
  decision: "extending-dining-table",
  name: "Oak extending table, 140–190 cm",
  url: "https://www.example.com/oak-extending-table",
  price: "€520",
  dimensions: { width: 1400, depth: 850, height: 750 },
  rating: 4,
  ratingNote: "Solid-looking and the right size; the top is veneer",
  checks: [
    { requirement: 1, result: "pass", note: "4, or 6 extended" },
    { requirement: 2, result: "pass", note: "85 cm" },
    { requirement: 3, result: "fail", note: "oak veneer on the top" },
  ],
});
await purchaseMove("extending-dining-table", "settled", 'The user: "we\'re buying it, settle it"');
await purchase.run("record_fulfilment", {
  decision: "extending-dining-table",
  bought: "Oak extending table, 140–190 cm, veneer top, €520",
  deviations: [
    {
      requirement: 3,
      text: "oak veneer top, not solid oak",
      reason: "solid ones were twice the price",
    },
  ],
  listing: "oak-extending-table-140-190-cm",
  item: {
    name: "Oak dining table",
    category: "tables",
    positionNote: "by the window",
    width: measured(1400),
    depth: measured(850),
    height: measured(750),
    materials: ["oak veneer"],
    boughtOn: "2026-06-20",
    warrantyUntil: "2028-06-20",
  },
});

await purchase.run("save_decision", {
  kind: "purchase",
  room: "study",
  title: "Sofa bed for the study",
  statement: "A sofa bed for the study, for guests, that comes up the attic stair in pieces.",
  basis: ["a-study-that-sleeps-a-guest"],
});

// A second tape measure, mid-Purchase: the ceiling is 5 cm lower than first recorded, which flags
// the curtains resting on it. Closed before the Purchase, so the Purchase stays the last Session.
const remeasure = await open("home-intake");
await remeasure.run("save_room", {
  room: "living-room",
  name: "Living room",
  ceilingHeight: measured(2900),
});
await remeasure.run("close_session", {
  summary: {
    changed: "Re-measured the living room ceiling: 2.90 m, not 2.95 m.",
    open: "The curtains' drop, which rests on the ceiling height.",
    next: "Back to Purchase.",
  },
});

await purchase.run("close_session", {
  summary: {
    changed:
      "Requirements, both Guides, and four rated Listings for the sofa; curtains settled; the " +
      "dining table bought, with a veneer top rather than solid oak.",
    open: "Measure the sofa wall before buying; the sofa bed has no Requirements yet.",
    next: "Sit on the Tejo and the Linho in the showroom, with the Quick Guide open.",
  },
});

console.log(`Seeded the demo Home at ${url}.`);

/** The sofa's Full Guide: every must explains why. A function, so it can sit below its use. */
function sofaGuide() {
  return `## Size

- **At most 2.2 m wide** (must). The sofa wall was only estimated at 3.9 m, and the hallway door
  swings in at its far end: past 2.2 m it catches the arm. Measure the wall before buying.
- **Seat 55–60 cm deep** (must). You both sit with your legs tucked up; a shallow seat puts the
  front rail in your calves and you end up on the floor.

## Getting it in

- **Up the lift** (must). The lift door is 70 cm clear and the car 1.05 m deep, and the stairwell
  turns tighter still. A modular sofa, or one that ships in boxes under 68 cm deep, is the only
  kind that reaches the fourth floor without a hoist through the window.

## Fabric

- **Covers that zip off** (prefer). Sardinha sleeps on it: covers you can wash at 40 °C outlast
  any stain treatment.
- **Tight weaves only.** Claws pull the loops of bouclé and chunky weaves; corduroy, canvas and
  tightly woven linen shrug them off.

## Colour

- **Oatmeal, rust, or olive** (prefer). The Palette's warm whites need something to sit against,
  and Red Earth is its accent; white shows every paw print.`;
}
