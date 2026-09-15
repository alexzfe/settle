// The server-enforced Purchase rules of slice 6, written before their implementation: stable
// Requirement identity and Archiving, reasons of every kind, the Quick Guide's assembly (Measure
// first from Estimated values only, musts before prefers, then the AI's lines), save_guides and
// its refusals, and the Full Guide going out of date (docs/specs/skill-set.md#purchase).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import type { DecisionDetail, Measurement } from "./operations/schemas.js";

const web: CallContext = { caller: { kind: "web" } };
const measured = (mm: number): Measurement => ({ mm, provenance: "measured" });
const estimated = (mm: number): Measurement => ({ mm, provenance: "estimated" });

let core: Core;
let home: string;
let session: string;
const agent = (id?: string): CallContext => ({ caller: { kind: "session", session: id }, home });

beforeEach(async () => {
  core = createCore();
  home = (await core.run("create_home", web, { name: "My flat", country: "GB", city: "London" }))
    .home.slug;
  session = await openSession();
  await core.run("save_room", agent(session), {
    session,
    name: "Living room",
    ceilingHeight: measured(2600),
    walls: [
      { position: 1, length: measured(4000) },
      { position: 2, length: estimated(3000) },
      { position: 3 },
      { position: 4 },
    ],
    surfaces: { floor: { materials: [{ material: "oak boards" }] } },
    features: [{ kind: "radiator", wall: 1, width: estimated(1200), height: measured(600) }],
  });
  await core.run("save_room", agent(session), {
    session,
    name: "Hallway",
    walls: [{ position: 1 }],
    doors: [
      { wall: 1, otherRoom: "living-room", clearWidth: estimated(700), height: measured(1980) },
    ],
  });
  await core.run("save_items", agent(session), {
    session,
    items: [{ name: "Sofa", category: "seating", room: "living-room", height: measured(850) }],
  });
  await core.run("set_constraints", agent(session), { session, add: ["Two cats"] });
  await core.run("save_note", agent(session), { session, text: "The cats scratch linen" });
});
afterEach(() => core.close());

async function openSession(): Promise<string> {
  const context: CallContext = { caller: { kind: "session" }, home };
  return (await core.run("open_session", context, { skill: "purchase" })).session;
}

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

type SaveInput = Omit<OperationInput<"save_decision">, "session">;
type Requirements = NonNullable<SaveInput["requirements"]>;

async function save(input: SaveInput): Promise<string> {
  return (await core.run("save_decision", agent(session), { session, ...input })).receipt;
}

const rug = (requirements?: Requirements, decision?: string): SaveInput => ({
  kind: "purchase",
  room: "living-room",
  title: "Wool rug",
  statement: "A large wool rug under the sofa.",
  ...(decision ? { decision } : {}),
  ...(requirements ? { requirements } : {}),
});

async function saveGuides(input: Omit<OperationInput<"save_guides">, "session">) {
  return (await core.run("save_guides", agent(session), { session, ...input })).receipt;
}

async function detail(decision = "wool-rug", includeFullGuide?: boolean): Promise<DecisionDetail> {
  return (await core.run("get_decision", web, { home, decision, includeFullGuide })).decision;
}

const lines = async (kind?: string) =>
  ((await detail()).quickGuide?.lines ?? [])
    .filter((line) => kind === undefined || line.kind === kind)
    .map((line) => (kind === undefined ? `${line.kind}: ${line.text}` : line.text));

const must = (text: string, reason: Requirements[number]["reason"]): Requirements[number] => ({
  text,
  strength: "must",
  reason,
});
const prefer = (text: string, reason: Requirements[number]["reason"]): Requirements[number] => ({
  text,
  strength: "prefer",
  reason,
});
const cats = { kind: "constraint" as const, id: "two-cats" };

describe("Requirements", () => {
  it("rest on a reason of any kind, naming a field only when the record has it", async () => {
    await save({ kind: "other", title: "Keep the floors", statement: "The oak stays." });
    await save(
      rug([
        must("Under 4 m long", { kind: "wall", id: "living-room/wall-1", field: "length" }),
        must("Through the hallway door", { kind: "door", id: "hallway-living-room-door" }),
        must("Fits the lift", { kind: "home", field: "accessWidth" }),
        must("Low enough for the ceiling", { kind: "room", id: "living-room" }),
        prefer("Matches the floor", { kind: "surface", id: "living-room/floor" }),
        prefer("Clears the radiator", { kind: "feature", id: "living-room-radiator" }),
        prefer("Under the sofa's height", { kind: "item", id: "sofa", field: "height" }),
        prefer("Wool", cats),
        prefer("No linen", { kind: "note", id: "the-cats-scratch-linen" }),
        prefer("Oak tones", { kind: "decision", id: "keep-the-floors" }),
      ]),
    );
    const reasons = (await detail()).requirements.map(
      ({ reason }) => `${reason.kind} ${reason.id}${reason.field ? ` ${reason.field}` : ""}`,
    );
    expect(reasons).toEqual([
      "wall living-room/wall-1 length",
      "door hallway-living-room-door",
      "home my-flat accessWidth",
      "room living-room",
      "surface living-room/floor",
      "feature living-room-radiator",
      "item sofa height",
      "constraint two-cats",
      "note the-cats-scratch-linen",
      "decision keep-the-floors",
    ]);

    const noField = await refusal(
      save(rug([must("Soft", { kind: "wall", id: "living-room/wall-1", field: "softness" })])),
    );
    expect(noField.code).toBe("validation");
    expect(noField.message).toContain("softness");
  });

  it("keep their position for life: a new one never takes an Archived one's position", async () => {
    await save(rug([must("Wool", cats), prefer("Low pile", cats)]));
    await save(rug([{ position: 2, archive: true }], "wool-rug"));
    await save(rug([prefer("Warm tones", cats)], "wool-rug"));

    const { requirements } = await detail();
    expect(requirements.map((each) => [each.position, each.text])).toEqual([
      [1, "Wool"],
      [3, "Warm tones"],
    ]);
  });

  it("leave get_decision and the Quick Guide once Archived, and come back at their position when restored", async () => {
    await save(rug([must("Wool", cats), prefer("Low pile", cats)]));
    await save(rug([{ position: 1, archive: true }], "wool-rug"));
    expect((await detail()).requirements.map((each) => each.position)).toEqual([2]);
    expect(await lines()).toEqual(["prefer: Low pile"]);

    await save(rug([{ position: 1, archive: false }], "wool-rug"));
    expect(await lines()).toEqual(["must: Wool", "prefer: Low pile"]);
  });

  it("change in place: a changed Requirement keeps its position", async () => {
    await save(rug([must("Wool", cats), prefer("Low pile", cats)]));
    await save(
      rug([{ position: 1, text: "Wool or a wool blend", strength: "prefer" }], "wool-rug"),
    );
    const { requirements } = await detail();
    expect(requirements.map((each) => [each.position, each.strength, each.text])).toEqual([
      [1, "prefer", "Wool or a wool blend"],
      [2, "prefer", "Low pile"],
    ]);
  });
});

describe("the Quick Guide", () => {
  it("puts a Measure first line at the top for each must resting on an Estimated value, and none for a Measured one or a prefer", async () => {
    await save(
      rug([
        prefer("Wool", cats),
        must("Under 4 m long", { kind: "wall", id: "living-room/wall-1", field: "length" }),
        must("Under 2.8 m wide", { kind: "wall", id: "living-room/wall-2", field: "length" }),
        prefer("Under 2.9 m wide", { kind: "wall", id: "living-room/wall-2", field: "length" }),
        must("Clear of the ceiling", { kind: "room", id: "living-room", field: "ceilingHeight" }),
      ]),
    );
    expect(await lines("measure-first")).toEqual([
      "Measure first: living-room/wall-2 length (~3.00 m)",
    ]);
    expect((await lines())[0]).toBe(
      "measure-first: Measure first: living-room/wall-2 length (~3.00 m)",
    );
  });

  it("rests a must naming no field on every length of its record, each value once", async () => {
    await save(
      rug([
        must("Through the hallway door", { kind: "door", id: "hallway-living-room-door" }),
        must("Rolled, under 70 cm across", {
          kind: "door",
          id: "hallway-living-room-door",
          field: "clearWidth",
        }),
      ]),
    );
    expect(await lines("measure-first")).toEqual([
      "Measure first: hallway-living-room-door clear width (~0.70 m)",
    ]);
  });

  it("says when the length a must names is not recorded at all", async () => {
    await save(rug([must("Through the front door", { kind: "home", field: "accessWidth" })]));
    expect(await lines("measure-first")).toEqual([
      "Measure first: narrowest access width (not recorded)",
    ]);
  });

  it("lists the musts before the prefers, each by position, then the AI's own lines", async () => {
    await save(
      rug([
        prefer("Warm tones", cats),
        must("Wool", cats),
        prefer("Low pile", cats),
        must("At least 2 m long", cats),
      ]),
    );
    await saveGuides({
      decision: "wool-rug",
      quickLines: ["Avoid loop pile", "Rub the pile: it should not shed"],
    });
    expect(await lines()).toEqual([
      "must: Wool",
      "must: At least 2 m long",
      "prefer: Warm tones",
      "prefer: Low pile",
      "line: Avoid loop pile",
      "line: Rub the pile: it should not shed",
    ]);
    expect((await detail()).quickGuide?.path).toBe("/guide/wool-rug?home=my-flat");
  });

  it("follows a changed Requirement at once, since it is assembled and never stored", async () => {
    await save(rug([must("Wool", cats)]));
    await saveGuides({ decision: "wool-rug", quickLines: ["Avoid loop pile"] });
    await save(rug([{ position: 1, text: "Wool or a wool blend" }], "wool-rug"));
    expect(await lines()).toEqual(["must: Wool or a wool blend", "line: Avoid loop pile"]);
  });
});

describe("save_guides", () => {
  it("saves the Quick Guide's own lines and the Full Guide, which get_decision gives as one line unless includeFullGuide", async () => {
    await save(rug([must("Wool", cats)]));
    const receipt = await saveGuides({
      decision: "wool-rug",
      quickLines: ["Avoid loop pile"],
      fullGuide: "## Material\n\nWool, because two cats live here.",
    });
    expect(receipt).toContain("Quick Guide lines saved (1)");
    expect(receipt).toContain("Full Guide written");

    const { guides } = await detail();
    expect(guides?.quickLines).toEqual(["Avoid loop pile"]);
    expect(guides?.fullGuide).toEqual({ writtenAt: expect.any(String), outOfDate: false });
    const full = (await detail("wool-rug", true)).guides?.fullGuide;
    expect(full?.markdown).toBe("## Material\n\nWool, because two cats live here.");
  });

  it("replaces only what it is given", async () => {
    await save(rug([must("Wool", cats)]));
    await saveGuides({ decision: "wool-rug", quickLines: ["Avoid loop pile"], fullGuide: "# Rug" });
    await saveGuides({ decision: "wool-rug", quickLines: ["Avoid viscose"] });
    const { guides } = await detail("wool-rug", true);
    expect(guides?.quickLines).toEqual(["Avoid viscose"]);
    expect(guides?.fullGuide?.markdown).toBe("# Rug");
  });

  it("is refused on a closed Session, saving nothing", async () => {
    await save(rug([must("Wool", cats)]));
    await core.run("close_session", agent(session), {
      session,
      summary: { changed: "A rug.", open: "Nothing", next: "Nothing" },
    });
    const error = await refusal(saveGuides({ decision: "wool-rug", quickLines: ["Avoid loops"] }));
    expect(error.code).toBe("session_closed");
    expect((await detail()).guides).toBeUndefined();
  });

  it("is refused for a Decision that is not a Purchase, and for a Rejected Purchase", async () => {
    await save({ kind: "other", title: "Keep the floors", statement: "The oak stays." });
    await save(rug([must("Wool", cats)]));
    await core.run("set_decision_state", agent(session), {
      session,
      decision: "wool-rug",
      to: "rejected",
      reason: 'The user: "no rug after all"',
    });
    const other = await refusal(saveGuides({ decision: "keep-the-floors", fullGuide: "# Floors" }));
    const rejected = await refusal(saveGuides({ decision: "wool-rug", fullGuide: "# Rug" }));
    expect([other.code, rejected.code]).toEqual(["validation", "illegal_transition"]);
  });

  it("needs quickLines or a Full Guide", async () => {
    await save(rug([must("Wool", cats)]));
    const error = await refusal(saveGuides({ decision: "wool-rug" }));
    expect(error.code).toBe("validation");
  });
});

describe("the Full Guide", () => {
  beforeEach(async () => {
    await save(rug([must("Wool", cats), prefer("Low pile", cats)]));
    await saveGuides({ decision: "wool-rug", fullGuide: "# Rug\n\nWool, for the cats." });
  });

  const fullGuide = async () => (await detail()).guides?.fullGuide;

  it("is marked out of date when a Requirement changes after it was written, saying so in the receipt", async () => {
    const receipt = await save(rug([{ position: 2, text: "Flatweave" }], "wool-rug"));
    expect(receipt).toContain("Full Guide is now out of date");
    expect(await fullGuide()).toEqual({
      writtenAt: expect.any(String),
      requirementsChangedAt: expect.any(String),
      outOfDate: true,
    });
  });

  it("is marked out of date when a Requirement is added or Archived", async () => {
    await save(rug([prefer("Warm tones", cats)], "wool-rug"));
    expect((await fullGuide())?.outOfDate).toBe(true);
    await saveGuides({ decision: "wool-rug", fullGuide: "# Rug\n\nWool, warm tones." });
    await save(rug([{ position: 3, archive: true }], "wool-rug"));
    expect((await fullGuide())?.outOfDate).toBe(true);
  });

  it("is not marked out of date by an Evidence-only change", async () => {
    const receipt = await save({
      ...rug(undefined, "wool-rug"),
      evidence: [{ kind: "note", id: "the-cats-scratch-linen", stance: "supports" }],
    });
    expect(receipt).not.toContain("out of date");
    expect((await fullGuide())?.outOfDate).toBe(false);
  });

  it("is up to date again once written anew, even with the same text", async () => {
    await save(rug([{ position: 2, text: "Flatweave" }], "wool-rug"));
    const receipt = await saveGuides({
      decision: "wool-rug",
      fullGuide: "# Rug\n\nWool, for the cats.",
    });
    expect(receipt).toContain("Full Guide rewritten, up to date");
    expect((await fullGuide())?.outOfDate).toBe(false);
  });

  it("is not marked by a Requirement change before any Full Guide was written", async () => {
    await save({ ...rug([must("Oak", cats)]), title: "Oak bench", statement: "A bench." });
    await saveGuides({ decision: "oak-bench", quickLines: ["Check the joints"] });
    await save({
      ...rug([{ position: 1, text: "Oak or ash" }]),
      decision: "oak-bench",
      title: "Oak bench",
      statement: "A bench.",
    });
    const { guides } = await detail("oak-bench");
    expect(guides).toEqual({ quickLines: ["Check the joints"] });
  });
});
