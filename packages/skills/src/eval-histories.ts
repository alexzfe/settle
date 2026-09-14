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

/** Every tool Home Intake uses; a history loads them all, as a real Session's ToolSearch does. */
const TOOLS = [
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
];

/** The start of every Home Intake Session: the user's message, the Skill, and the opening. */
function opening(context: HistoryContext, message: string): { turns: Turn[]; session: string } {
  const input = { skill: "home-intake" };
  const result = context.answer("open_session", input);
  const session = /^Session: (\S+)/m.exec(result)?.[1];
  if (!session) throw new Error("The open_session mock must start with `Session: <id>`");
  return {
    session,
    turns: [
      { user: message },
      { skill: "home-intake", body: context.skill("home-intake") },
      { toolSearch: TOOLS },
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
};
