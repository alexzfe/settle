// Snapshots of the text the AI reads, rendered from the fixture Home. A new line in a snapshot
// must be justified against the Context tiers (docs/specs/home-model.md#context-tiers).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CallContext, OperationInput } from "./core.js";
import {
  createFixtureHome,
  FIXTURE_FILES,
  FIXTURE_ROOMS,
  type FixtureHome,
} from "./fixture/fixture-home.js";
import { length, renderQuickGuide } from "./render.js";
import { slugify } from "./slug.js";

let fixture: FixtureHome;
beforeAll(async () => {
  // Session ids come from this sequence, so the tool result's id is stable.
  let next = 0;
  fixture = await createFixtureHome({
    random: (max) => next++ % max,
    clock: () => new Date("2026-09-14T10:00:00.000Z"),
  });
});
afterAll(() => fixture.core.close());

const agent = (session?: string): CallContext => ({
  caller: { kind: "session", session },
  home: fixture.home,
});
const snapshot = (name: string) => `./__snapshots__/${name}.txt`;

function toolText(name: string, output: unknown): string {
  const operation = fixture.core.operations.find((each) => each.name === name);
  if (!operation?.text) throw new Error(`${name} renders no text`);
  return operation.text(output);
}

async function openSession(): Promise<string> {
  return (await fixture.core.run("open_session", agent(), { skill: "home-intake" })).session;
}

it("renders the opening: the Home's name and its Home Overview, with every Room's Gaps", async () => {
  const result = await fixture.core.run("open_session", agent(), { skill: "home-intake" });
  await expect(result.opening).toMatchFileSnapshot(snapshot("opening"));
  await expect(toolText("open_session", result)).toMatchFileSnapshot(
    snapshot("open_session-result"),
  );
});

it("renders the opening for Design Direction: the Home-wide Decisions after the Overview", async () => {
  const result = await fixture.core.run("open_session", agent(), { skill: "design-direction" });
  await expect(result.opening).toMatchFileSnapshot(snapshot("opening-design-direction"));
});

it("renders the opening for Color: the Locked Palette in full, every color with its role and note", async () => {
  const result = await fixture.core.run("open_session", agent(), { skill: "color" });
  await expect(result.opening).toMatchFileSnapshot(snapshot("opening-color"));
});

it("renders get_decision for a Palette and a Room color resting on it", async () => {
  const session = await openSession();
  const texts = [];
  for (const decision of ["warm-clay", "living-room-walls-in-jitney"]) {
    const result = await fixture.core.run("get_decision", agent(session), { session, decision });
    texts.push(toolText("get_decision", result));
  }
  await expect(texts.join("\n\n")).toMatchFileSnapshot(snapshot("get_decision-color"));
});

it("renders a join: only the blocks the Session has not been sent yet", async () => {
  const session = await openSession();
  const join = await fixture.core.run("open_session", agent(session), {
    skill: "design-direction",
    session,
  });
  const again = await fixture.core.run("open_session", agent(session), {
    skill: "purchase",
    session,
  });
  await expect(
    [toolText("open_session", join), toolText("open_session", again)].join("\n\n"),
  ).toMatchFileSnapshot(snapshot("join"));
});

it("renders find_decisions lines", async () => {
  const session = await openSession();
  const find = async (title: string, filter: Record<string, unknown>) => {
    const result = await fixture.core.run("find_decisions", agent(session), {
      session,
      ...filter,
    });
    return `# ${title}\n${toolText("find_decisions", result)}`;
  };
  const results = [
    await find("every Decision", {}),
    await find("the hallway", { room: "hallway" }),
    await find("Home-wide", { homeWide: true }),
    await find("Rejected", { state: "rejected" }),
    await find("Palettes", { kind: "palette" }),
  ];
  await expect(results.join("\n\n")).toMatchFileSnapshot(snapshot("find_decisions"));
});

it("renders get_decision: a Room Direction, a flagged Purchase, and a Decision with a Conflict", async () => {
  const session = await openSession();
  const texts = [];
  for (const decision of ["calm-evenings", "wool-rug", "keep-the-original-floors"]) {
    const result = await fixture.core.run("get_decision", agent(session), { session, decision });
    texts.push(toolText("get_decision", result));
  }
  await expect(texts.join("\n\n")).toMatchFileSnapshot(snapshot("get_decision"));
});

it("renders the Quick Guide of a Purchase: Measure first, the musts, the prefers, then the AI's lines", async () => {
  const session = await openSession();
  const { decision } = await fixture.core.run("get_decision", agent(session), {
    session,
    decision: "wool-rug",
  });
  await expect(renderQuickGuide(decision)).toMatchFileSnapshot(snapshot("quick-guide"));
});

it("renders get_decision for a Purchase with Requirements, Guides, and the Full Guide line, then with includeFullGuide", async () => {
  const session = await openSession();
  const texts = [];
  for (const [decision, includeFullGuide] of [
    ["wool-rug", false],
    ["wool-rug", true],
    ["oak-bookcase", false],
  ] as const) {
    const result = await fixture.core.run("get_decision", agent(session), {
      session,
      decision,
      includeFullGuide,
    });
    texts.push(
      `# ${decision}, includeFullGuide: ${includeFullGuide}\n${toolText("get_decision", result)}`,
    );
  }
  await expect(texts.join("\n\n")).toMatchFileSnapshot(snapshot("get_decision-purchase"));
});

it("renders every Room's Room Sheet", async () => {
  const session = await openSession();
  for (const { name } of FIXTURE_ROOMS) {
    const room = slugify(name, "room");
    const { sheet } = await fixture.core.run("get_room_sheet", agent(session), { session, room });
    await expect(sheet).toMatchFileSnapshot(snapshot(`room-sheet-${room}`));
  }
});

it("renders a Room Sheet with the Blueprint, page, and printed text of its Blueprint values", async () => {
  const session = await openSession();
  const { sheet } = await fixture.core.run("get_room_sheet", agent(session), {
    session,
    room: "living-room",
    withSources: true,
  });
  await expect(sheet).toMatchFileSnapshot(snapshot("room-sheet-living-room-sources"));
});

it("renders the view_images text block, which comes before the images", async () => {
  const session = await openSession();
  await fixture.core.run(
    "upload_blueprint",
    { caller: { kind: "web" } },
    {
      home: fixture.home,
      file: readFileSync(join(FIXTURE_FILES, "blueprint-3-pages.pdf")),
      fileName: "survey.pdf",
      label: "Survey",
    },
  );
  const view = async (input: Omit<OperationInput<"view_images">, "session">) =>
    toolText(
      "view_images",
      await fixture.core.run("view_images", agent(session), { session, ...input }),
    );
  const texts = [
    await view({ blueprint: "agent-plan", pages: [1] }),
    await view({ blueprint: "agent-plan", pages: [1], crop: "top-left" }),
    await view({ blueprint: "survey", pages: [3, 1] }),
  ];
  await expect(texts.join("\n\n")).toMatchFileSnapshot(snapshot("view_images"));
});

it("renders find_items lines", async () => {
  const session = await openSession();
  const find = async (title: string, filter: Record<string, unknown>) => {
    const result = await fixture.core.run("find_items", agent(session), { session, ...filter });
    return `# ${title}\n${toolText("find_items", result)}`;
  };
  const results = [
    await find("every Item", {}),
    await find("Unplaced", { unplaced: true }),
    await find("seating, Archived included", { category: "seating", archived: true }),
    await find('text "oak"', { text: "oak" }),
    await find("the balcony", { room: "balcony" }),
  ];
  await expect(results.join("\n\n")).toMatchFileSnapshot(snapshot("find_items"));
});

it("renders search_notes lines", async () => {
  const session = await openSession();
  const search = async (query?: string) => {
    const result = await fixture.core.run("search_notes", agent(session), { session, query });
    return `# ${query ?? "every Note"}\n${toolText("search_notes", result)}`;
  };
  const results = [await search(), await search("cat furniture"), await search("rabbit")];
  await expect(results.join("\n\n")).toMatchFileSnapshot(snapshot("search_notes"));
});

it("renders save_room receipts: created, moved, unchanged", async () => {
  const session = await openSession();
  const save = async (name: string, level?: string) =>
    (await fixture.core.run("save_room", agent(session), { session, name, level })).receipt;
  const receipts = [
    await save("Study", "First"),
    await save("Study", "ground"),
    await save("Study"),
  ];
  await expect(receipts.join("\n\n")).toMatchFileSnapshot(snapshot("receipts"));
});

it("renders a receipt with every kind of change, a refused part, and the remaining Gaps", async () => {
  const session = await openSession();
  const saveRoom = (input: Omit<OperationInput<"save_room">, "session">) =>
    fixture.core.run("save_room", agent(session), { session, ...input });
  const { receipt } = await saveRoom({
    room: "main-bedroom",
    name: "Main bedroom",
    ceilingHeight: measured(2450),
    walls: [
      { position: 1, length: measured(3620) },
      { position: 2, length: measured(3100), beyond: "unknown" },
      { position: 3, length: measured(3620) },
      { position: 4, length: measured(3100), beyond: "outside", facing: "n" },
    ],
    surfaces: {
      walls: { color: { name: "chalk white", provenance: "estimated" }, finish: "matt" },
    },
    windows: [{ window: "main-bedroom-window", width: measured(1180) }],
    doors: [{ otherRoom: "balcony", clearWidth: measured(1400), height: estimated(2100) }],
    features: [{ kind: "radiator", wall: 4, positionNote: "under the window" }],
  });
  const refused = await saveRoom({
    room: "living-room",
    name: "Living room",
    ceilingHeight: estimated(2400),
    timesOfUse: ["daytime", "evening"],
    walls: [{ position: 5, length: measured(3650) }],
    surfaces: { walls: { color: { name: "pinkish beige", provenance: "estimated" } } },
  });
  const overridden = await saveRoom({
    room: "kitchen",
    name: "Kitchen",
    ceilingHeight: estimated(2450),
    overrideProvenance: 'The user: "I measured it wrong, call it about 2.45"',
  });
  await expect([receipt, refused.receipt, overridden.receipt].join("\n\n")).toMatchFileSnapshot(
    snapshot("receipt-save_room"),
  );
});

it("renders the receipts of save_home, save_items, set_constraints, and save_note", async () => {
  const session = await openSession();
  const run = async (name: string, input: Record<string, unknown>) =>
    ((await fixture.core.run(name, agent(session), { session, ...input })) as { receipt: string })
      .receipt;
  const receipts = [
    await run("save_home", {
      tenure: "rented",
      lift: false,
      accessWidth: estimated(800),
      levels: [
        { level: "first", name: "Upstairs" },
        { name: "Loft", storey: 2 },
      ],
    }),
    await run("save_items", {
      items: [
        { name: "Rug", category: "rugs", room: "living-room", width: estimated(2000) },
        { item: "sofa", room: "kitchen", condition: "damaged" },
        { item: "standing-desk", room: "main-bedroom", wall: 2 },
        { item: "kitchen-table", unplaced: true },
      ],
    }),
    await run("set_constraints", {
      add: ["Two cats", "No smoking"],
      remove: ["two-cats"],
      reason: 'The user: "the cats moved out with my sister"',
    }),
    await run("save_note", { text: "The landlord visits every spring" }),
  ];
  await expect(receipts.join("\n\n")).toMatchFileSnapshot(snapshot("receipts-other"));
});

it("renders a save_room receipt recording Blueprint values, with the Estimated ones they replace", async () => {
  const session = await openSession();
  const saveRoom = (input: Omit<OperationInput<"save_room">, "session">) =>
    fixture.core.run("save_room", agent(session), { session, ...input });
  const hallway = await saveRoom({
    room: "hallway",
    name: "Hallway",
    walls: [
      { position: 2, length: fromPlan(4150, `13'7"`) },
      { position: 3, length: fromPlan(900, "0.90") },
      { position: 7, length: fromPlan(1600, "1.60 m") },
    ],
  });
  const living = await saveRoom({
    room: "living-room",
    name: "Living room",
    walls: [
      { position: 1, length: fromPlan(5150, `16'11"`) },
      { position: 2, length: fromPlan(2100, "2.10") },
    ],
  });
  await expect([hallway.receipt, living.receipt].join("\n\n")).toMatchFileSnapshot(
    snapshot("receipt-save_room-blueprint"),
  );
});

describe("Decision receipts", () => {
  // Their own fixture Home, since these writes change the Decisions the other snapshots show.
  let own: FixtureHome;
  let session: string;
  beforeAll(async () => {
    let next = 0;
    own = await createFixtureHome({
      random: (max) => next++ % max,
      clock: () => new Date("2026-09-14T10:00:00.000Z"),
    });
    session = (await own.core.run("open_session", ownAgent(), { skill: "design-direction" }))
      .session;
  });
  afterAll(() => own.core.close());

  function ownAgent(id?: string): CallContext {
    return { caller: { kind: "session", session: id }, home: own.home };
  }

  it("renders a set_decision_state receipt with a cascade, then one keeping a flagged Decision", async () => {
    const reopen = await own.core.run("set_decision_state", ownAgent(session), {
      session,
      decision: "warm-minimalism",
      to: "leaning",
      reason: `The user: "let's rethink the direction"`,
    });
    const keep = await own.core.run("set_decision_state", ownAgent(session), {
      session,
      decision: "calm-evenings",
      to: "locked",
      reason: 'The user: "the living room stays as it is"',
    });
    await expect([reopen.receipt, keep.receipt].join("\n\n")).toMatchFileSnapshot(
      snapshot("receipt-set_decision_state"),
    );
  });

  it("renders the receipts of save_decision, flag_conflict, and record_fulfilment", async () => {
    const run = async (name: string, input: Record<string, unknown>) =>
      (
        (await own.core.run(name, ownAgent(session), { session, ...input })) as {
          receipt: string;
        }
      ).receipt;
    const bedroom = {
      kind: "room-direction",
      room: "main-bedroom",
      title: "Dark and restful",
    };
    const receipts = [
      await run("save_decision", {
        ...bedroom,
        statement: "A dark, cocooning room for sleep.",
        content: {
          direction: "Deep, soft, and dim: heavy curtains and a low bed.",
          mood: "cocooning",
        },
        evidence: [{ kind: "session", id: session, stance: "supports" }],
      }),
      await run("save_decision", {
        ...bedroom,
        decision: "dark-and-restful",
        statement: "A dark, quiet room for sleep.",
        content: { direction: "Deep, soft, and dim: heavy curtains and a low bed.", mood: "quiet" },
        basis: ["keep-the-original-floors"],
      }),
      await run("save_decision", {
        kind: "purchase",
        title: "Hallway bench",
        room: "hallway",
        statement: "A narrow bench with shoe storage by the front door.",
        requirements: [
          {
            text: "At most 35 cm deep",
            strength: "must",
            reason: { kind: "door", id: "hallway-outside-door" },
          },
          { text: "Oak", strength: "prefer", reason: { kind: "decision", id: "warm-minimalism" } },
        ],
      }),
      await run("flag_conflict", {
        decision: "calm-evenings",
        description: "The user now wants a bright reading corner by the bay window.",
      }),
    ];
    await own.core.run("set_decision_state", ownAgent(session), {
      session,
      decision: "storage-in-the-hallway",
      to: "locked",
      reason: 'The user: "yes, storage it is"',
    });
    // The Reopen above flagged it, and a flagged Decision is Fulfilled only once it is kept.
    await own.core.run("set_decision_state", ownAgent(session), {
      session,
      decision: "storage-in-the-hallway",
      to: "locked",
      reason: 'The user: "the hallway still holds the coats"',
    });
    receipts.push(
      await run("record_fulfilment", {
        decision: "storage-in-the-hallway",
        roomFunctions: ["hallway", "storage", "utility"],
      }),
    );
    await expect(receipts.join("\n\n")).toMatchFileSnapshot(snapshot("receipts-decisions"));
  });
});

describe("Color receipts", () => {
  // Their own fixture Home, since these writes paint the living room the other snapshots show.
  let own: FixtureHome;
  let session: string;
  beforeAll(async () => {
    let next = 0;
    own = await createFixtureHome({
      random: (max) => next++ % max,
      clock: () => new Date("2026-09-14T10:00:00.000Z"),
    });
    session = (await own.core.run("open_session", ownAgent(), { skill: "color" })).session;
  });
  afterAll(() => own.core.close());

  function ownAgent(id?: string): CallContext {
    return { caller: { kind: "session", session: id }, home: own.home };
  }

  /** The text the AI reads from a tool call. */
  async function run(name: string, input: Record<string, unknown>): Promise<string> {
    return toolText(name, await own.core.run(name, ownAgent(session), { session, ...input }));
  }

  /** A refused call's message, which the MCP tool returns as its isError text. */
  async function refusal(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      await own.core.run(name, ownAgent(session), { session, ...input });
    } catch (error) {
      if (error instanceof Error) return error.message;
    }
    throw new Error(`${name} was not refused`);
  }

  it("renders a Palette and Room colors saved, a refused color, Fulfilments, and a Palette Reopen, then the Room Sheet after Fulfilment", async () => {
    const sections: [string, string][] = [];
    const add = (title: string, text: string) => sections.push([title, text]);
    add(
      "save_decision: a second Palette, which stays a Candidate",
      await run("save_decision", {
        kind: "palette",
        title: "Cool linen",
        statement: "Pale stone greys, for a cooler house.",
        content: {
          colors: [
            {
              name: "Skimming Stone",
              brand: "Farrow & Ball",
              code: "No. 241",
              hex: "#d6cdc0",
              provenance: "measured",
              role: "base",
            },
            { name: "soft slate", provenance: "estimated", role: "accent", note: "doors only" },
          ],
        },
      }),
    );
    add(
      "save_decision: a Room color, resting on the Palette in force automatically",
      await run("save_decision", {
        kind: "room-color",
        room: "kitchen",
        title: "Kitchen woodwork in Pointing",
        statement: "The kitchen woodwork in Pointing, satin, to match the ceilings.",
        content: { surface: "woodwork", color: "pointing", finish: "satin" },
      }),
    );
    add(
      "save_decision: a Room color naming a color the Palette lacks, refused",
      await refusal("save_decision", {
        kind: "room-color",
        room: "hallway",
        title: "Hallway walls in Hague Blue",
        statement: "A deep blue hallway.",
        content: { surface: "walls", color: "Hague Blue", finish: "matt" },
      }),
    );
    add(
      "record_fulfilment: the living room walls painted",
      await run("record_fulfilment", { decision: "living-room-walls-in-jitney" }),
    );
    const { sheet } = await own.core.run("get_room_sheet", ownAgent(session), {
      session,
      room: "living-room",
    });
    await run("set_decision_state", {
      decision: "kitchen-woodwork-in-pointing",
      to: "locked",
      reason: 'The user: "yes, Pointing for the woodwork"',
    });
    add(
      "record_fulfilment: the kitchen woodwork, in another finish than decided",
      await run("record_fulfilment", {
        decision: "kitchen-woodwork-in-pointing",
        finish: "eggshell",
      }),
    );
    add(
      "get_decision: the Fulfilled living room walls",
      await run("get_decision", { decision: "living-room-walls-in-jitney" }),
    );
    await run("save_decision", {
      kind: "room-color",
      room: "main-bedroom",
      title: "Bedroom walls in Setting Plaster",
      statement: "The main bedroom walls in Setting Plaster, matt.",
      content: { surface: "walls", color: "Setting Plaster", finish: "matt" },
    });
    add(
      "set_decision_state: the Palette Reopened, flagging only the Room color still open",
      await run("set_decision_state", {
        decision: "warm-clay",
        to: "leaning",
        reason: `The user: "let's rethink the accent"`,
      }),
    );
    await expect(
      sections.map(([title, text]) => `# ${title}\n${text}`).join("\n\n"),
    ).toMatchFileSnapshot(snapshot("receipts-color"));
    await expect(sheet).toMatchFileSnapshot(snapshot("room-sheet-living-room-fulfilled"));
  });
});

describe("Purchase receipts", () => {
  // Their own fixture Home, since these writes Fulfil the Wool rug the other snapshots show.
  let own: FixtureHome;
  let session: string;
  beforeAll(async () => {
    let next = 0;
    own = await createFixtureHome({
      random: (max) => next++ % max,
      clock: () => new Date("2026-09-14T10:00:00.000Z"),
    });
    session = (await own.core.run("open_session", ownAgent(), { skill: "purchase" })).session;
  });
  afterAll(() => own.core.close());

  function ownAgent(id?: string): CallContext {
    return { caller: { kind: "session", session: id }, home: own.home };
  }

  /** The text the AI reads from a tool call. */
  async function run(name: string, input: Record<string, unknown>): Promise<string> {
    return toolText(name, await own.core.run(name, ownAgent(session), { session, ...input }));
  }

  /** A refused call's message, which the MCP tool returns as its isError text. */
  async function refusal(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      await own.core.run(name, ownAgent(session), { session, ...input });
    } catch (error) {
      if (error instanceof Error) return error.message;
    }
    throw new Error(`${name} was not refused`);
  }

  it("renders Listings recorded and refused, a value_changed flag, and a Fulfilment with Deviations and the flag it raised", async () => {
    const sections: string[] = [];
    const add = (title: string, text: string) => sections.push(`# ${title}\n${text}`);
    const checks = [
      { requirement: 1, result: "pass", note: "1.7 × 2.4 m" },
      { requirement: 2, result: "pass", note: "hand-tufted wool" },
      { requirement: 3, result: "pass", note: "2.4 m long" },
    ];
    add(
      "record_listing: a Listing missing a check, refused",
      await refusal("record_listing", { decision: "wool-rug", name: "Tufted rug", checks }),
    );
    add(
      "record_listing: a third Listing",
      await run("record_listing", {
        decision: "wool-rug",
        name: "Tufted wool rug",
        price: "£310",
        checks: [...checks, { requirement: 4, result: "fail", note: "cool grey" }],
      }),
    );
    add(
      "record_listing: the jute rug marked down",
      await run("record_listing", {
        decision: "wool-rug",
        listing: "jute-loop-rug",
        price: "£95",
      }),
    );
    add(
      "save_room: the west wall measured, flagging the rug resting on it",
      await run("save_room", {
        room: "living-room",
        name: "Living room",
        walls: [{ position: 5, length: measured(3620) }],
      }),
    );
    await run("save_decision", {
      kind: "purchase",
      room: "living-room",
      title: "Rug pad",
      statement: "A felt pad cut to the rug.",
      basis: ["wool-rug"],
      requirements: [
        {
          text: "Cut 5 cm inside the rug's edges",
          strength: "must",
          reason: { kind: "decision", id: "wool-rug" },
        },
      ],
    });
    await run("set_decision_state", {
      decision: "wool-rug",
      to: "locked",
      reason: 'The user: "the Hay rug, lock it"',
    });
    add(
      "record_fulfilment: refused while the rug is flagged",
      await refusal("record_fulfilment", { decision: "wool-rug", bought: "Hay Plain rug" }),
    );
    add(
      "set_decision_state: the rug kept, clearing its flags",
      await run("set_decision_state", {
        decision: "wool-rug",
        to: "locked",
        reason: 'The user: "the wall is fine and so is the room; keep it"',
      }),
    );
    add(
      "record_fulfilment: the rug bought, longer than asked and rust, flagging the rug pad",
      await run("record_fulfilment", {
        decision: "wool-rug",
        bought: "Hay Plain rug, 200 × 350 cm, rust, £495",
        deviations: [
          { requirement: 3, text: "3.5 m long, not at most 3.4 m" },
          { requirement: 4, text: "rust, darker than the Palette's terracotta" },
        ],
        item: {
          name: "Wool rug",
          category: "rugs",
          width: measured(2000),
          depth: measured(3500),
          colors: [{ name: "rust", provenance: "estimated" }],
          materials: ["wool"],
          brand: "Hay",
          model: "Plain",
          price: "£495",
        },
      }),
    );
    add("get_decision: the rug pad, flagged", await run("get_decision", { decision: "rug-pad" }));
    await expect(sections.join("\n\n")).toMatchFileSnapshot(snapshot("receipts-purchase"));
  });
});

describe("A re-based Decision", () => {
  // Its own fixture Home, since these writes replace the Palette the other snapshots show.
  let own: FixtureHome;
  let session: string;
  beforeAll(async () => {
    let next = 0;
    own = await createFixtureHome({
      random: (max) => next++ % max,
      clock: () => new Date("2026-09-14T10:00:00.000Z"),
    });
    session = (await own.core.run("open_session", ownAgent(), { skill: "color" })).session;
  });
  afterAll(() => own.core.close());

  function ownAgent(id?: string): CallContext {
    return { caller: { kind: "session", session: id }, home: own.home };
  }

  /** The text the AI reads from a tool call. */
  async function run(name: string, input: Record<string, unknown>): Promise<string> {
    return toolText(name, await own.core.run(name, ownAgent(session), { session, ...input }));
  }

  it("renders a Room color kept after its Palette was replaced: the receipts, then get_decision", async () => {
    const sections: string[] = [];
    const add = (title: string, text: string) => sections.push(`# ${title}\n${text}`);
    add(
      "set_decision_state: the Palette Rejected, flagging the Room color resting on it",
      await run("set_decision_state", {
        decision: "warm-clay",
        to: "rejected",
        reason: `The user: "scrap the palette, it's too pink"`,
      }),
    );
    await run("save_decision", {
      kind: "palette",
      title: "Cool stone",
      statement: "Pale stone greys, keeping Jitney for the living room.",
      content: {
        colors: [
          {
            name: "Skimming Stone",
            brand: "Farrow & Ball",
            code: "No. 241",
            hex: "#d6cdc0",
            provenance: "measured",
            role: "base",
          },
          {
            name: "Jitney",
            brand: "Farrow & Ball",
            code: "No. 293",
            hex: "#bba68a",
            provenance: "measured",
            role: "secondary",
            note: "the living room walls, as before",
          },
        ],
      },
    });
    await run("set_decision_state", {
      decision: "cool-stone",
      to: "locked",
      reason: 'The user: "lock the stone palette"',
    });
    add(
      "set_decision_state: the Room color kept, so it now rests on the Palette in force",
      await run("set_decision_state", {
        decision: "living-room-walls-in-jitney",
        to: "locked",
        reason: 'The user: "keep Jitney for the living room"',
      }),
    );
    add(
      "get_decision: the re-based Room color",
      await run("get_decision", { decision: "living-room-walls-in-jitney" }),
    );
    await expect(sections.join("\n\n")).toMatchFileSnapshot(snapshot("get_decision-rebased"));
  });
});

describe("The Shopping exports and the phone page", () => {
  // Their own fixture Home, since the Wool rug is Locked here to put it on the Shopping List.
  let own: FixtureHome;
  const web: CallContext = { caller: { kind: "web" } };
  beforeAll(async () => {
    let next = 0;
    own = await createFixtureHome({
      random: (max) => next++ % max,
      clock: () => new Date("2026-09-14T10:00:00.000Z"),
    });
    await own.core.run("set_decision_state", web, {
      home: own.home,
      decision: "wool-rug",
      to: "locked",
    });
  });
  afterAll(() => own.core.close());

  const file = (name: string) => `./__snapshots__/${name}`;

  it("renders the Quick Guide's phone page: no JavaScript, Measure first on top, the Full Guide one tap away", async () => {
    const { text } = await own.core.run("get_guide_page", web, {
      home: own.home,
      decision: "wool-rug",
    });
    await expect(text).toMatchFileSnapshot(file("guide-page.html"));
  });

  it("renders the Shopping List as a printable page and as CSV", async () => {
    for (const format of ["html", "csv"] as const) {
      const { text } = await own.core.run("export_shopping_list", web, { home: own.home, format });
      await expect(text).toMatchFileSnapshot(file(`export-shopping-list.${format}`));
    }
  });

  it("renders the Shopping Guides as Markdown and as a printable page", async () => {
    for (const [format, extension] of [
      ["markdown", "md"],
      ["html", "html"],
    ] as const) {
      const { text } = await own.core.run("export_guides", web, { home: own.home, format });
      await expect(text).toMatchFileSnapshot(file(`export-guides.${extension}`));
    }
  });
});

function fromPlan(mm: number, text: string) {
  return {
    mm,
    provenance: "blueprint" as const,
    source: { blueprint: "agent-plan", page: 1, printed: text },
  };
}

function measured(mm: number) {
  return { mm, provenance: "measured" as const };
}

function estimated(mm: number) {
  return { mm, provenance: "estimated" as const };
}

describe("length", () => {
  // The same lengths as the web's format.test.ts, so the Agent and the page round alike.
  it("rounds to whole centimetres first, as the web's formatLength does", () => {
    expect(length(measured(3620))).toBe("3.62 m");
    expect(length(measured(3505))).toBe("3.51 m");
    expect(length(measured(2505))).toBe("2.51 m");
    expect(length(estimated(2504))).toBe("~2.50 m");
  });
});
