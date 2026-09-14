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
};
