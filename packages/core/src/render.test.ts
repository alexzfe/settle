// Snapshots of the text the AI reads, rendered from the fixture Home. A new line in a snapshot
// must be justified against the Context tiers (docs/specs/home-model.md#context-tiers).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { CallContext, OperationInput } from "./core.js";
import {
  createFixtureHome,
  FIXTURE_FILES,
  FIXTURE_ROOMS,
  type FixtureHome,
} from "./fixture/fixture-home.js";
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
    await run("set_constraints", { add: ["Two cats", "No smoking"], remove: ["two-cats"] }),
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
