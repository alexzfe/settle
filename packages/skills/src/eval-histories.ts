// The replay behaviour evals' histories: each case's conversation up to the turn under test,
// whose user message is the case's prompt.md. The build writes them to
// plugin/evals/<case>/history.jsonl, so they always carry the current Skill text and the same
// answers the case's mocks give during the run.
import type { Turn } from "./transcript.js";

export interface HistoryContext {
  /** The built Skill's body, as Claude Code injects it when the Skill loads. */
  skill(name: string): string;
  /** The case's mock answer for `tool` (its own mock, else the suite's), with inputs filled in. */
  answer(tool: string, input: Record<string, unknown>): string;
}

/** Every tool each Skill uses; a history loads them all, as a real Session's ToolSearch does. */
const TOOLS = {
  "home-intake": [
    "open_session",
    "get_room_sheet",
    "find_items",
    "search_notes",
    "view_images",
    "save_home",
    "save_room",
    "save_items",
    "set_constraints",
    "save_note",
    "close_session",
  ],
  "design-direction": [
    "open_session",
    "get_room_sheet",
    "find_items",
    "find_decisions",
    "get_decision",
    "search_notes",
    "save_decision",
    "set_decision_state",
    "record_fulfilment",
    "flag_conflict",
    "set_constraints",
    "save_note",
    "close_session",
  ],
  color: [
    "open_session",
    "get_room_sheet",
    "find_items",
    "find_decisions",
    "get_decision",
    "search_notes",
    "save_decision",
    "set_decision_state",
    "record_fulfilment",
    "flag_conflict",
    "set_constraints",
    "save_note",
    "close_session",
  ],
  purchase: [
    "open_session",
    "get_room_sheet",
    "find_items",
    "find_decisions",
    "get_decision",
    "search_notes",
    "save_home",
    "save_room",
    "save_decision",
    "set_decision_state",
    "save_guides",
    "record_listing",
    "record_fulfilment",
    "flag_conflict",
    "set_constraints",
    "save_note",
    "close_session",
  ],
} as const;

type Skill = keyof typeof TOOLS;

/** The start of every Session: the user's message, the Skill, and the opening. */
function opening(
  context: HistoryContext,
  message: string,
  skill: Skill = "home-intake",
): { turns: Turn[]; session: string } {
  const input = { skill };
  const result = context.answer("open_session", input);
  const session = /^Session: (\S+)/m.exec(result)?.[1];
  if (!session) throw new Error("The open_session mock must start with `Session: <id>`");
  return {
    session,
    turns: [
      { user: message },
      { skill, body: context.skill(skill) },
      { toolSearch: TOOLS[skill] },
      { tool: "open_session", input, result },
    ],
  };
}

const PERMISSIONS_ROUND = `Working on Fixture Home, in London.

The Home's facts are in: rented, staying 1–3 years, a 1930s semi-detached house, and 0.76 m at the front door. One rental permission is recorded so far:

- *Rented: no drilling into the chimney breast*

Before we go Room by Room: what else has the landlord said? May you paint, drill or hang things on the other walls, change light fittings, or change the flooring? *(Recommended: tell me what you know; anything you're unsure of can wait.)*`;

const ITEMS_LIST = `Here's the Main bedroom's list:

1. **Chest of drawers**: white (storage)
2. **Bedside table**: oak (tables)
3. **Reading lamp**: black, next to the bed (lighting)

Is that right? Correct anything that's off, or say yes and I'll save them.`;

function itemsHistory(context: HistoryContext): Turn[] {
  const { turns, session } = opening(context, "I want to tell you about the furniture we own.");
  const room = { session, room: "main-bedroom" };
  return [
    ...turns,
    { tool: "get_room_sheet", input: room, result: context.answer("get_room_sheet", room) },
    {
      assistant: `Working on Fixture Home, in London.

Let's go Room by Room, starting with the Main bedroom, which has one Item recorded: the Double bed. What else do you own in there? Furniture, lamps, rugs, pictures, plants: list them as they come to mind, and I'll gather them into a list for you to check before I save anything.`,
    },
  ];
}

// ─── Blueprint cases ────────────────────────────────────────────────────────────────────────
// Their own mocks give a new Home, Flat 5, whose only record so far is an uploaded Blueprint: the
// one-page A3 ground floor of docs/research/spikes/fixtures/blueprint-a3.pdf. A mock can't return
// images, so the view_images mock lists what the page prints, keeping two of its dimension
// strings. The history's own writes get receipts in core's wording, since a canned mock answers
// every save_room alike.

const PLAN = "ground-floor-plan";

/** The plan's Rooms, as the Room-list reply names them. */
const PLAN_ROOMS = [
  { name: "Kitchen", slug: "kitchen", functions: ["kitchen"] },
  { name: "Utility", slug: "utility", functions: ["utility"] },
  { name: "Living / Dining", slug: "living-dining", functions: ["living", "dining"] },
  { name: "Hall", slug: "hall", functions: ["hallway"] },
  { name: "Landing", slug: "landing", functions: ["hallway"] },
  { name: "Bedroom 1", slug: "bedroom-1", functions: ["bedroom"] },
  { name: "Bath", slug: "bath", functions: ["bathroom"] },
  { name: "Bedroom 2", slug: "bedroom-2", functions: ["bedroom"] },
];

const NEW_ROOM_GAPS =
  "wall lengths, ceiling height, Windows or windowless, times of use, walls Surface, " +
  "ceiling Surface, floor Surface, woodwork Surface";

const ROOM_LIST = `Working on Flat 5.

The plan has one page, titled GROUND FLOOR, so I'd map page 1 to Ground. It labels eight Rooms:

1. **Kitchen**: kitchen
2. **Utility**: utility
3. **Living / Dining**: living and dining, one open-plan Room
4. **Hall**: hallway
5. **Landing**: hallway
6. **Bedroom 1**: bedroom
7. **Bath**: bathroom
8. **Bedroom 2**: bedroom

Is page 1 the ground floor, and is that the Room list? Rename any Room to what you call it. *(Recommended: yes to both.)*`;

const DIMENSIONS = `Recorded: page 1 shows Ground, and the eight Rooms are on Ground.

Now the dimensions. The plan prints sizes for two Rooms. In each Room, Wall 1 is the wall with its entrance door, and the others follow clockwise as seen on the plan:

1. **Kitchen**: *3.62 m x 4.00 m*. Its door is in the bottom wall, so Walls 1 and 3 are 3.62 m, and Walls 2 and 4 are 4.00 m.
2. **Bedroom 2**: *3.81 m x 4.80 m*. Its door is in the top wall, so Walls 1 and 3 are 3.81 m, and Walls 2 and 4 are 4.80 m.
3. **The other six Rooms** have no printed sizes, so their Wall lengths stay open until we go Room by Room after the plan.

Shall I record those two? *(Recommended: yes.)*`;

const OPENINGS = `Recorded: the Kitchen's and Bedroom 2's four Walls, with the sizes as printed.

Now the Windows and Doors. They are drawn on the plan, not printed, so please check each one. Walls are numbered as before: Wall 1 has the Room's entrance door, then clockwise.

**Windows**
1. Kitchen: one, in Wall 3 (the top wall).
2. Utility: one, in Wall 4 (top).
3. Living / Dining: two, in Wall 3 (left) and Wall 2 (bottom).
4. Bedroom 1: one, in Wall 3 (top).
5. Bath: one, in Wall 3 (bottom).
6. Bedroom 2: one, in Wall 2 (right).
7. Hall and Landing: none, so both are windowless.

**Doors**
8. Hall to outside, in Hall Wall 1: the front door.
9. Hall to Utility and to Living / Dining, both in Hall Wall 2.
10. Hall to Landing, in Hall Wall 4.
11. Kitchen to Living / Dining, in Kitchen Wall 1 and Living / Dining Wall 4.
12. Landing to Bedroom 1 (Landing Wall 2), and to Bath and Bedroom 2 (both in Landing Wall 4).

Are those right? *(Recommended: yes. None of them has a printed size, so sizes can wait.)*`;

/** A Blueprint Session's start: the plan viewed, and the Room list read back for confirming. */
function blueprintStart(context: HistoryContext): { turns: Turn[]; session: string } {
  const { turns, session } = opening(
    context,
    "I've uploaded our floor plan in the app. Can you set up the rooms from it?",
  );
  const view = { session, blueprint: PLAN, pages: [1] };
  return {
    session,
    turns: [
      ...turns,
      { tool: "view_images", input: view, result: context.answer("view_images", view) },
      { assistant: ROOM_LIST },
    ],
  };
}

/** A figure of a printed dimension string: its millimetres, and the figure as printed. */
type Printed = [mm: number, printed: string];

/**
 * The save_room that records a rectangular Room's four Walls from its printed "across x along"
 * string, each Wall quoting its own figure.
 */
function sizedRoom(
  session: string,
  room: { name: string; slug: string },
  across: Printed,
  along: Printed,
): Turn {
  const walls = [across, along, across, along];
  const input = {
    session,
    room: room.slug,
    name: room.name,
    walls: walls.map(([mm, printed], index) => ({
      position: index + 1,
      length: { mm, provenance: "blueprint", source: { blueprint: PLAN, page: 1, printed } },
    })),
  };
  const lines = walls.map(
    ([mm, printed], index) =>
      `${room.slug}/wall-${index + 1}: length ${(mm / 1000).toFixed(2)} m ` +
      `(Blueprint, ${PLAN} p.1: ${printed})`,
  );
  const gaps = NEW_ROOM_GAPS.replace("wall lengths, ", "");
  return {
    tool: "save_room",
    input,
    result: [...lines, `Gaps left in ${room.name} (${room.slug}): ${gaps}`].join("\n"),
  };
}

function throughDimensions(context: HistoryContext): Turn[] {
  const { turns, session } = blueprintStart(context);
  const pages = { session, blueprintPages: [{ blueprint: PLAN, page: 1, level: "ground" }] };
  const [kitchen, bedroom2] = [PLAN_ROOMS[0], PLAN_ROOMS[7]];
  if (!kitchen || !bedroom2) throw new Error("PLAN_ROOMS lost the Kitchen or Bedroom 2");
  return [
    ...turns,
    { user: "Yes to both." },
    { tool: "save_home", input: pages, result: context.answer("save_home", pages) },
    ...PLAN_ROOMS.map(
      ({ name, slug, functions }): Turn => ({
        tool: "save_room",
        input: { session, name, level: "ground", functions },
        result: `${name} (${slug}): created on Ground\nGaps left in ${name} (${slug}): ${NEW_ROOM_GAPS}`,
      }),
    ),
    { assistant: DIMENSIONS },
    { user: "Yes, record them." },
    sizedRoom(session, kitchen, [3620, "3.62"], [4000, "4.00"]),
    sizedRoom(session, bedroom2, [3810, "3.81"], [4800, "4.80"]),
    { assistant: OPENINGS },
  ];
}

// ─── Design Direction cases ─────────────────────────────────────────────────────────────────
// The Fixture Home at different points in settling its Design Direction. A case whose own
// open_session mock sets that point (no Direction yet, a Rejected one, a Leaning one) says so;
// the others use the suite's opening, whose Direction is Locked.

/** A Design Direction Session's start: the opening, then the Rejected Directions looked up. */
function directionStart(
  context: HistoryContext,
  message: string,
): { turns: Turn[]; session: string } {
  const { turns, session } = opening(context, message, "design-direction");
  const lookup = { session, kind: "design-direction", state: "rejected" };
  return {
    session,
    turns: [
      ...turns,
      { tool: "find_decisions", input: lookup, result: context.answer("find_decisions", lookup) },
    ],
  };
}

const NO_DIRECTION_YET = `Working on Fixture Home, in London. It has no Design Direction yet, and the Palette, each Room's direction, and what you buy will all rest on it, so let's start there.`;

const FIRST_ROUND = `${NO_DIRECTION_YET}

First round, about how you live and what you love:

1. **Coming home.** How do you want the house to feel when you walk in? *(Recommended: calm and uncluttered, somewhere to unwind.)*
2. **Places you've loved.** Homes, hotels, or places you've felt good in, and what you liked about them. Pictures are welcome. *(Recommended: two or three places, a line each.)*
3. **Everyday life.** With two cats and a rented house, what should the direction make easy? *(Recommended: tough, washable fabrics, and pieces you can take with you.)*
4. **What stays.** Anything you own and love that the direction should work around? *(Recommended: the oak dining chairs.)*`;

const MOOD_ROUND = `Saved as a Candidate: Design Direction 'Calm and natural'.

Your two places pull in slightly different directions, so this round is about the mood:

1. **Mood.** Copenhagen reads calm, airy, and pared back; Provence reads warm, earthy, and lived-in. Which is closer to how you want home to feel, or is it a mix? *(Recommended: a mix, calm and pared back with earthy warmth.)*
2. **Temperature.** Warm, neutral, or cool overall? *(Recommended: warm, since you said never cold.)*
3. **Contrast.** Low, medium, or high? *(Recommended: low, with soft steps between light and dark.)*`;

const CHARACTER_ROUND = `${NO_DIRECTION_YET}

First round:

1. **Coming home.** How do you want the house to feel when you walk in? *(Recommended: relaxed and welcoming.)*
2. **What you're drawn to.** Places, eras, or things you love the look of. *(Recommended: two or three, with what you like about each.)*
3. **Everyday life.** With two cats, what should the direction make easy? *(Recommended: tough, washable fabrics.)*
4. **What stays.** Anything you own that the direction should work around? *(Recommended: the oak dining chairs.)*`;

const LOCK_OFFER = `Working on Fixture Home, in London. Your Design Direction, **Warm minimalism**, is Leaning, not yet Locked:

- **Mood:** calm, uncluttered, unhurried
- **Temperature:** warm
- **Contrast:** low
- **Key materials:** oak, linen, wool, rough plaster, terracotta
- **Style references:** Japandi; a Copenhagen hotel's pale wood and linen; a Provence farmhouse's terracotta and plaster
- **Principles:** fewer, better things; tough, washable fabrics the cats can't ruin; the oak dining chairs stay

Every line is filled in and they agree with each other, so it could be Locked now. Once it is, the Palette and each Room's direction rest on it, and changing it later means reopening it.

Shall I Lock it as it stands? *(Recommended: yes.)*`;

const WHERE_WE_ARE = `Working on Fixture Home, in London. Your Design Direction, **Warm minimalism**, is Locked: calm and grounded, warm, low contrast, in oak, linen, limewash, and unlacquered brass. Two things are waiting for you, which we can take up when we reach them: a Conflict on *Keep the original floors* (the terracotta tiles), and a flag on the *Wool rug*.

Where next? *(Recommended: 1.)*

1. **Hallway.** Its use is still a Candidate, *Storage in the hallway*: we'd settle it together with how the Hallway should feel.
2. **Main bedroom.** No Room Direction yet.
3. **Kitchen.** No Room Direction yet.`;

// ─── Color cases ────────────────────────────────────────────────────────────────────────────
// The Fixture Home at different points in settling its colors. The suite's color opening has the
// Design Direction Locked and no Palette yet; each case's own opening sets its point instead (a
// Locked Palette "Warm clay", or a Leaning Direction) and says so.

/** A Color Session's start on one Room: the opening, the Room's Sheet, then its Rejected ones. */
function colorRoomStart(
  context: HistoryContext,
  message: string,
  room: string,
): { turns: Turn[]; session: string } {
  const { turns, session } = opening(context, message, "color");
  const sheet = { session, room };
  const lookup = { session, room, state: "rejected" };
  return {
    session,
    turns: [
      ...turns,
      { tool: "get_room_sheet", input: sheet, result: context.answer("get_room_sheet", sheet) },
      { tool: "find_decisions", input: lookup, result: context.answer("find_decisions", lookup) },
    ],
  };
}

const BEDROOM_ROUND = `Working on Fixture Home, in London. Your Design Direction, **Warm minimalism**, and your Palette, **Warm clay**, are both Locked, so the Main bedroom's colours come from Warm clay's four: Pointing, Setting Plaster, Jitney, and warm terracotta.

The Main bedroom faces west over the balcony and you use it at night, so its daylight is warmest late in the day and it's mostly seen under lamps. None of its Surfaces is recorded yet. First round:

1. **Feel.** Restful and enveloping, or light and airy? *(Recommended: restful, since it's a night-time room.)*
2. **What stays.** What colours are the bed and the bedding? *(Recommended: tell me roughly; the walls should sit with them.)*
3. **Ceiling.** The same as the walls, or lighter? *(Recommended: Pointing, the Palette's warm white, in flat matt.)*
4. **Woodwork.** Pointing, as elsewhere, or the wall colour for a softer look? *(Recommended: Pointing, in eggshell.)*`;

const DIRECTION_LEANING = `Working on Fixture Home, in London. Your Design Direction, **Warm minimalism**, is Leaning, not yet Locked, and the Palette rests on it: its warm temperature, its low contrast, and its oak, linen, plaster, and terracotta are what the colours have to suit.

I'd recommend settling the direction first in Design Direction, which can take over right here; then we come back to colours. If we start on colours anyway, the Palette can go as far as Leaning, and it waits to be Locked until the direction is.

Settle the direction in Design Direction now, or start on colours anyway? *(Recommended: the direction first.)*`;

const WHICH_ROOMS = `Working on Fixture Home, in London. Your Design Direction, **Warm minimalism**, is Locked: warm, low contrast, oak, linen, limewash, and brass. No Palette yet, so that comes first, and every Room's colours will be drawn from it.

Before I propose anything I'll read what the house came with, since the Palette is built around it. Which Rooms matter most? *(Recommended: the living room and the kitchen; I'll read their Room Sheets and name back what stays.)*`;

const PALETTE_ROUND = `Colours it is. First round, one question per colour, each drawn from the Direction and the house's light:

1. **Base, for most walls.** A warm plaster pink that glows in the south-facing living room and stays soft under lamps in the windowless hallway. *(Recommended: Setting Plaster (Farrow & Ball No. 231), which the living room walls already have.)*
2. **Ceilings and woodwork.** A warm white rather than a brilliant one, so the contrast stays low. *(Recommended: Pointing (Farrow & Ball No. 2003).)*
3. **Accent.** An earthy terracotta for the front door and one feature wall, echoing the tiles at the dining end. *(Recommended: a warm terracotta; we can pin down the exact paint later.)*`;

const KITCHEN_LOCK_OFFER = `Working on Fixture Home, in London. Your Design Direction and your Palette, **Warm clay**, are both Locked.

The Kitchen's walls are Leaning towards **Setting Plaster in eggshell** (*Kitchen walls in Setting Plaster*): the Palette's warm plaster pink stays soft in the Kitchen's east-facing morning light and sits well with the oak units and the white metro splashback, and eggshell wipes clean near the cooker. It would replace today's cream.

It's ready to Lock. Shall I Lock it? *(Recommended: yes.)*`;

const KITCHEN_LOCKED = `Locked: Room color 'Kitchen walls in Setting Plaster', in eggshell.

Next, the Kitchen's woodwork, which has nothing recorded yet:

1. **Colour.** *(Recommended: Pointing, the Palette's warm white, as for the other woodwork.)*
2. **Finish.** *(Recommended: satin, which wipes clean.)*`;

// ─── Purchase cases ─────────────────────────────────────────────────────────────────────────
// The Fixture Home with its Design Direction and its Palette "Warm clay" both Locked, as the
// suite's purchase opening has them. Each case's own find_decisions mock finds no Rejected
// Purchase.

/**
 * A Purchase Session's start on one Room: the opening, the Room's Sheet, the Notes on the thing,
 * then the Room's Rejected Purchases.
 */
function purchaseRoomStart(
  context: HistoryContext,
  message: string,
  room: string,
  query: string,
): { turns: Turn[]; session: string } {
  const { turns, session } = opening(context, message, "purchase");
  const sheet = { session, room };
  const notes = { session, query };
  const lookup = { session, room, kind: "purchase", state: "rejected" };
  return {
    session,
    turns: [
      ...turns,
      { tool: "get_room_sheet", input: sheet, result: context.answer("get_room_sheet", sheet) },
      { tool: "search_notes", input: notes, result: context.answer("search_notes", notes) },
      { tool: "find_decisions", input: lookup, result: context.answer("find_decisions", lookup) },
    ],
  };
}

const SOFA_ROUND = `Working on Fixture Home, in London. Your Design Direction, **Warm minimalism**, and your Palette, **Warm clay**, are both Locked, so the sofa's materials and colours come from them. There's also a flag on the *Wool rug* and a Conflict on *Keep the original floors*, which can wait.

Here's what the living room gives us. The sofa stands on Wall 6, which is 3.90 m and also holds the door in from the hallway. The one there now is 2.10 m wide, 0.95 m deep, and 0.85 m tall, in a worn warm-grey linen. The way in is tight: the front door is the narrowest point, at 0.76 m, and the living room door is 0.76 m too. And you have two cats, which you've noted scratch fabric furniture.

First round:

1. **Width.** How wide can it be? *(Recommended: no wider than 2.20 m, so it stays clear of the door on Wall 6.)*
2. **Getting it in.** *(Recommended: it must get through a 0.76 m doorway, with its legs off if need be.)*
3. **Cover.** *(Recommended: a tightly woven wool, which stands up to claws; no loops or loose weave.)*
4. **Colour.** *(Recommended: Jitney, the Palette's warm stone for the living room, or close to it; the terracotta can come in with cushions.)*
5. **Legs.** *(Recommended: oak, one of the Direction's key materials.)*`;

const SOFA_ANSWERS =
  "1, yes, no wider than 2.20 m. 2, yes, it has to get in. 3, wool, definitely. 4, Jitney or close to it. 5, oak legs. Please save what we've agreed so far.";

const SOFA_SAVED = `Saved as a Candidate: Purchase 'Living room sofa', with 5 Requirements. The Palette joined its Basis, since its colour comes from Warm clay.

**Must**
1. At most 2.20 m wide: from the living room's Wall 6 (3.90 m), which also holds the door.
2. Gets through a 0.76 m doorway, legs off if need be: from the narrowest point on the way in, the front door (0.76 m).
3. A tightly woven wool cover, no loops or loose weave: because of the two cats.

**Prefer**
4. Cover in Jitney, or close to it: from the Palette, Warm clay.
5. Oak legs: from the Design Direction's key materials.

That covers size, access, cover, colour, and legs, so we could stop here. Shall I write the Quick Guide for the shop and the Full Guide to read ahead? *(Recommended: yes.)*`;

/** The living room sofa's first round, answered. */
function sofaHistory(context: HistoryContext): { turns: Turn[]; session: string } {
  const { turns, session } = purchaseRoomStart(
    context,
    "Our sofa is worn out. We need a new one for the living room.",
    "living-room",
    "sofa cats",
  );
  return { session, turns: [...turns, { assistant: SOFA_ROUND }] };
}

const ALCOVE_ROUND = `Working on Fixture Home, in London. Your Design Direction, **Warm minimalism**, and your Palette, **Warm clay**, are both Locked.

The alcove by the stairs is the Hallway's Wall 4, next to the understairs cupboard on Wall 3, and it is recorded as 1.20 m wide. The Hallway is windowless and narrow, with encaustic tiles underfoot, so a cabinet there should be slim and light-looking. First round:

1. **What it holds.** Shoes only, or scarves and bags too? *(Recommended: shoes, with a top for keys and post.)*
2. **Width.** *(Recommended: at most 1.15 m wide, leaving a little room either side.)*
3. **Depth.** *(Recommended: at most 30 cm deep, so the Hallway stays easy to pass.)*
4. **Material.** *(Recommended: oak, one of the Direction's key materials.)*
5. **Finish.** Bare oak, or painted? *(Recommended: bare oak; if painted, Pointing, the Palette's warm white, as for the woodwork.)*`;

export const HISTORIES: Record<string, (context: HistoryContext) => Turn[]> = {
  // Graded turn: the user says the landlord forbids drilling into any wall. A Constraint needs
  // the user's yes first.
  "home-intake-asks-before-constraint": (context) => [
    ...opening(context, "Let's set up my home. We moved in last month.").turns,
    { assistant: PERMISSIONS_ROUND },
  ],

  // Graded turn: the user lists three Items. They are read back for confirmation, not saved.
  "home-intake-lists-items-first": itemsHistory,

  // Graded turn: the user confirms the list. Exactly those three Items are saved.
  "home-intake-saves-confirmed-items": (context) => [
    ...itemsHistory(context),
    {
      user: "In the bedroom there's a white chest of drawers, an oak bedside table, and a black reading lamp next to the bed.",
    },
    { assistant: ITEMS_LIST },
  ],

  // Graded turn: the user gives a rough length for a Wall the Home has as Measured. The case's
  // save_room mock refuses it, and the reply states both values and asks.
  "home-intake-refused-write": (context) => {
    const { turns, session } = opening(context, "Can we fill in the hallway today?");
    const room = { session, room: "hallway" };
    return [
      ...turns,
      { tool: "get_room_sheet", input: room, result: context.answer("get_room_sheet", room) },
      {
        assistant: `Working on Fixture Home, in London.

The Hallway has lengths for six of its eight Walls, its three Doors, and the understairs cupboard. First round:

1. **Walls 7 and 8.** How long is each, and is that measured or roughly? *(Recommended: rough is fine for now.)*
2. **Ceiling height.** *(Recommended: about 2.5 m, like the Kitchen.)*
3. **Surfaces.** The walls, ceiling, and woodwork: material, color, and finish for each. *(Recommended: painted plaster walls and ceiling, white gloss woodwork.)*`,
      },
    ];
  },

  // Graded turn: the user confirms the Room list and asks for the plan's sizes and facings from
  // its north arrow. Only the two printed sizes are saved, as Blueprint with the printed text,
  // and north is asked rather than read off the arrow.
  "home-intake-fills-printed-only": (context) => blueprintStart(context).turns,

  // Graded turn: the user confirms the Windows and Doors. The reply asks where north is before
  // any Wall's facing is recorded.
  "home-intake-asks-north": throughDimensions,

  // Graded turn: the user is still weighing two moods. Nothing is Locked, and the reply asks.
  // The case's own opening has no Design Direction yet.
  "design-direction-no-lock-without-commitment": (context) => {
    const { turns, session } = directionStart(
      context,
      "I don't know what style I like. Can you help me work it out?",
    );
    const candidate = {
      session,
      kind: "design-direction",
      title: "Calm and natural",
      statement: "A calm, uncluttered home in natural materials, somewhere to unwind.",
      content: {
        mood: "calm and uncluttered, never cold",
        keyMaterials: ["oak", "linen", "plaster", "terracotta"],
        styleReferences: [
          "a small Copenhagen hotel: pale wood and linen",
          "a Provence farmhouse: terracotta floors, rough plaster walls",
        ],
        principles: ["tough, washable fabrics the cats can't ruin", "the oak dining chairs stay"],
      },
    };
    return [
      ...turns,
      { assistant: FIRST_ROUND },
      {
        user: "Calm, definitely, but not cold. We loved a small hotel in Copenhagen, all pale wood and linen, and a friend's farmhouse in Provence with terracotta floors and rough plaster walls. Yes to cat-proof fabrics, and the oak chairs stay.",
      },
      // The case's save_decision mock answers the graded turn's edits, so the create gets its
      // receipt in core's wording here.
      {
        tool: "save_decision",
        input: candidate,
        result:
          "Calm and natural (calm-and-natural): created as a Candidate Design Direction, Home-wide",
      },
      { assistant: MOOD_ROUND },
    ];
  },

  // Graded turn: the user asks for directions that suit their love of character. The case's
  // find_decisions mock lists a Rejected "Industrial loft" Direction, which is never offered again.
  "design-direction-never-reproposes-rejected": (context) => [
    ...directionStart(context, "Help us pick a style for the house.").turns,
    { assistant: CHARACTER_ROUND },
  ],

  // Graded turn: the user wants to rethink the Locked Direction. The reply asks before Reopening,
  // and no state changes. The suite's opening has Warm minimalism Locked.
  "design-direction-asks-before-reopen": (context) => {
    const { turns, session } = opening(
      context,
      "Let's carry on with our style. Where had we got to?",
      "design-direction",
    );
    const everything = { session };
    return [
      ...turns,
      {
        tool: "find_decisions",
        input: everything,
        result: context.answer("find_decisions", everything),
      },
      { assistant: WHERE_WE_ARE },
    ];
  },

  // Graded turn: the user commits to the Leaning Direction. It is Locked with a reason, and the
  // reply says so. The case's own opening has the Direction Leaning.
  "design-direction-says-what-changed": (context) => [
    ...directionStart(context, "Can we finish off our style? I think we're nearly there.").turns,
    { assistant: LOCK_OFFER },
  ],

  // Graded turn: the user asks which color the Main bedroom's walls should be, and to save it.
  // The case's own opening has the Palette "Warm clay" Locked; the Room color names one of its
  // colors, and no other color is offered.
  // Graded turn: the Design Direction is Locked and there is no Palette. Color has asked which
  // Rooms matter most; the user names three. The reply reads their Room Sheets and names back
  // what the house came with instead of asking. The case's own opening has no Palette.
  "color-starts-from-what-stays": (context) => {
    const { turns, session } = opening(
      context,
      "Let's start on the colours for the house. We'd like to paint before winter.",
      "color",
    );
    const lookup = { session, kind: "palette", state: "rejected" };
    return [
      ...turns,
      { tool: "find_decisions", input: lookup, result: context.answer("find_decisions", lookup) },
      { assistant: WHICH_ROOMS },
    ];
  },

  "color-rests-on-palette": (context) => [
    ...colorRoomStart(context, "Let's do the colours for the main bedroom.", "main-bedroom").turns,
    { assistant: BEDROOM_ROUND },
  ],

  // Graded turn: after the first Palette round, the user commits and asks to Lock the Palette.
  // The case's own opening has the Design Direction Leaning, so nothing is Locked, and the reply
  // says why.
  "color-no-palette-without-locked-direction": (context) => {
    const { turns, session } = opening(
      context,
      "Can we choose our colours? We'd like to start painting soon.",
      "color",
    );
    const lookup = { session, kind: "palette", state: "rejected" };
    return [
      ...turns,
      { assistant: DIRECTION_LEANING },
      { user: "Colours now, please. The direction is basically right, and we're keen to paint." },
      { tool: "find_decisions", input: lookup, result: context.answer("find_decisions", lookup) },
      { assistant: PALETTE_ROUND },
    ];
  },

  // Graded turn: the user says they will paint the Kitchen's walls next weekend. Their Room color
  // has just been Locked; record_fulfilment waits for the painting. The case's own opening has
  // the Palette Locked, and its own record_fulfilment answers the call it should never make.
  "color-fulfils-only-when-done": (context) => {
    const { turns, session } = colorRoomStart(
      context,
      "Let's finish off the kitchen colours.",
      "kitchen",
    );
    const lock = {
      session,
      decision: "kitchen-walls-in-setting-plaster",
      to: "locked",
      reason: 'The user: "Yes, lock it in."',
    };
    return [
      ...turns,
      { assistant: KITCHEN_LOCK_OFFER },
      { user: "Yes, lock it in." },
      // The case has no set_decision_state mock of its own, so the Lock gets its receipt in core's
      // wording here.
      {
        tool: "set_decision_state",
        input: lock,
        result:
          "Kitchen walls in Setting Plaster (kitchen-walls-in-setting-plaster): Locked, was Leaning",
      },
      { assistant: KITCHEN_LOCKED },
    ];
  },

  // Graded turn: the user answers the first round about a sofa and asks to save. Every
  // Requirement saved has a reason naming a real record, and the reply says where each comes from.
  "purchase-traces-every-requirement": (context) => sofaHistory(context).turns,

  // Graded turn: the Candidate sofa has five Requirements, three of them musts, and the user asks
  // for both Guides. Every must in the Full Guide explains why.
  "purchase-full-guide-explains-musts": (context) => {
    const { turns, session } = sofaHistory(context);
    const save = {
      session,
      kind: "purchase",
      room: "living-room",
      title: "Living room sofa",
      statement: "A new sofa for the living room, replacing the worn grey one.",
      requirements: [
        {
          text: "At most 2.20 m wide",
          strength: "must",
          reason: { kind: "wall", id: "living-room/wall-6", field: "length" },
        },
        {
          text: "Gets through a 0.76 m doorway, legs off if need be",
          strength: "must",
          reason: { kind: "home", field: "accessWidth" },
        },
        {
          text: "A tightly woven wool cover, no loops or loose weave",
          strength: "must",
          reason: { kind: "constraint", id: "two-cats" },
        },
        {
          text: "Cover in Jitney, or close to it",
          strength: "prefer",
          reason: { kind: "decision", id: "warm-clay" },
        },
        {
          text: "Oak legs",
          strength: "prefer",
          reason: { kind: "decision", id: "warm-minimalism" },
        },
      ],
    };
    const of = "Living room sofa (living-room-sofa)";
    return [
      ...turns,
      { user: SOFA_ANSWERS },
      // The suite's save_decision mock answers with another Purchase, so the create gets its
      // receipt in core's wording here.
      {
        tool: "save_decision",
        input: save,
        result: [
          `${of}: created as a Candidate Purchase for Living room (living-room); Basis: Warm minimalism (warm-minimalism), the Design Direction, automatically; Warm clay (warm-clay), the Palette, automatically`,
          `Requirement 1 of ${of}: added: must, At most 2.20 m wide (reason: Wall living-room/wall-6, length)`,
          `Requirement 2 of ${of}: added: must, Gets through a 0.76 m doorway, legs off if need be (reason: Home Fixture Home (fixture-home), accessWidth)`,
          `Requirement 3 of ${of}: added: must, A tightly woven wool cover, no loops or loose weave (reason: Constraint Two cats (two-cats))`,
          `Requirement 4 of ${of}: added: prefer, Cover in Jitney, or close to it (reason: Decision Warm clay (warm-clay))`,
          `Requirement 5 of ${of}: added: prefer, Oak legs (reason: Decision Warm minimalism (warm-minimalism))`,
        ].join("\n"),
      },
      { assistant: SOFA_SAVED },
    ];
  },

  // Graded turn: the user answers the first round about a cabinet for the Hallway's alcove, whose
  // width the case's own Room Sheet gives as Estimated, and asks to save. The reply carries a
  // Measure-first line and offers to record the measurement.
  "purchase-measures-first-on-estimate": (context) => [
    ...purchaseRoomStart(
      context,
      "We want a shoe cabinet for the little alcove in the hallway, by the stairs.",
      "hallway",
      "shoes hallway",
    ).turns,
    { assistant: ALCOVE_ROUND },
  ],
};
