// The server-enforced Purchase rules of slice 6 that follow its Guides, written before their
// implementation: the value_changed flag (a named field, no field, an unrelated field), Listings
// with a check per Requirement, and a Purchase's Fulfilment with its Deviations, its Item or
// Feature change, and the cascade of a Deviation from a must, which flags every Decision with the
// Fulfilled Purchase in its Basis.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import type { BuildingMeasurement, DecisionDetail } from "./operations/schemas.js";

const web: CallContext = { caller: { kind: "web" } };
const measured = (mm: number): BuildingMeasurement => ({ mm, provenance: "measured" });
const estimated = (mm: number): BuildingMeasurement => ({ mm, provenance: "estimated" });

let core: Core;
let home: string;
let session: string;
const agent = (id?: string): CallContext => ({ caller: { kind: "session", session: id }, home });

beforeEach(async () => {
  core = createCore();
  home = (await core.run("create_home", web, { name: "My flat", country: "GB", city: "London" }))
    .home.slug;
  session = (
    await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "purchase" })
  ).session;
  await core.run("save_room", agent(session), {
    session,
    name: "Living room",
    walls: [
      { position: 1, length: measured(4000) },
      { position: 2, length: estimated(3000) },
      { position: 3 },
      { position: 4 },
    ],
    features: [{ kind: "radiator", wall: 1, width: measured(1200) }],
  });
  await core.run("save_room", agent(session), {
    session,
    name: "Hallway",
    walls: [{ position: 1 }],
    doors: [{ wall: 1, otherRoom: "living-room", clearWidth: estimated(700) }],
  });
  await core.run("save_items", agent(session), {
    session,
    items: [{ name: "Old rug", category: "rugs", room: "living-room", width: estimated(1600) }],
  });
  await core.run("set_constraints", agent(session), { session, add: ["Two cats"] });
});
afterEach(() => core.close());

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
type Reason = Requirements[number]["reason"];

async function save(input: SaveInput): Promise<string> {
  return (await core.run("save_decision", agent(session), { session, ...input })).receipt;
}

async function saveRoom(input: Omit<OperationInput<"save_room">, "session">): Promise<string> {
  return (await core.run("save_room", agent(session), { session, ...input })).receipt;
}

async function setState(decision: string, to: "candidate" | "leaning" | "settled" | "rejected") {
  return core.run("set_decision_state", agent(session), {
    session,
    decision,
    to,
    reason: 'The user: "yes"',
  });
}

async function listing(input: Omit<OperationInput<"record_listing">, "session" | "decision">) {
  return (
    await core.run("record_listing", agent(session), { session, decision: "wool-rug", ...input })
  ).receipt;
}

async function fulfil(input: Omit<OperationInput<"record_fulfilment">, "session">) {
  return (await core.run("record_fulfilment", agent(session), { session, ...input })).receipt;
}

async function detail(decision = "wool-rug"): Promise<DecisionDetail> {
  return (await core.run("get_decision", web, { home, decision })).decision;
}

/** get_decision as the AI reads it. */
async function decisionText(decision = "wool-rug"): Promise<string> {
  const operation = core.operations.find((each) => each.name === "get_decision");
  const output = await core.run("get_decision", agent(session), { session, decision });
  return operation?.text?.(output) ?? "";
}

const must = (text: string, reason: Reason): Requirements[number] => ({
  text,
  strength: "must",
  reason,
});
const prefer = (text: string, reason: Reason): Requirements[number] => ({
  text,
  strength: "prefer",
  reason,
});
const cats: Reason = { kind: "constraint", id: "two-cats" };
const wall2: Reason = { kind: "wall", id: "living-room/wall-2", field: "length" };

const rug = (requirements?: Requirements, decision?: string): SaveInput => ({
  kind: "purchase",
  room: "living-room",
  title: "Wool rug",
  statement: "A large wool rug.",
  ...(decision ? { decision } : {}),
  ...(requirements ? { requirements } : {}),
});

describe("value_changed flags", () => {
  it("flag a Purchase when the field its Requirement names changes, saying so in the receipt", async () => {
    await save(rug([must("Under 2.8 m wide", wall2)]));
    const receipt = await saveRoom({
      room: "living-room",
      name: "Living room",
      walls: [{ position: 2, length: measured(2950) }],
    });
    expect(receipt).toContain(
      "Flagged for review: Wool rug (wool-rug), whose Requirement 1 rests on " +
        "living-room/wall-2 length, which changed",
    );
    expect((await detail()).openFlags).toEqual([
      expect.objectContaining({
        cause: "value_changed",
        source: {
          kind: "wall",
          slug: "living-room/wall-2",
          name: "Living room, Wall 2",
          field: "length",
        },
      }),
    ]);
    expect(await decisionText()).toContain(
      "Living room, Wall 2 (living-room/wall-2) length changed on",
    );
  });

  it("flag one naming no field on any change to its record", async () => {
    await save(
      rug([must("Through the hallway door", { kind: "door", id: "hallway-living-room-door" })]),
    );
    await saveRoom({
      room: "hallway",
      name: "Hallway",
      doors: [{ otherRoom: "living-room", glazed: true }],
    });
    expect((await detail()).openFlags.map((flag) => [flag.cause, flag.source.field])).toEqual([
      ["value_changed", "glazed"],
    ]);
  });

  it("don't flag for another field of the record named, or for another record", async () => {
    await save(rug([must("Under 2.8 m wide", wall2)]));
    const receipt = await saveRoom({
      room: "living-room",
      name: "Living room",
      walls: [
        { position: 2, label: "sofa wall" },
        { position: 1, length: measured(3990) },
      ],
    });
    expect(receipt).not.toContain("Flagged");
    expect((await detail()).openFlags).toEqual([]);
  });

  it("flag for the Home's own facts, and for a Decision's statement but not its Evidence", async () => {
    await save({ kind: "other", title: "Keep the floors", statement: "The oak stays." });
    await save(
      rug([
        must("Through the front door", { kind: "home", field: "accessWidth" }),
        prefer("Oak tones", { kind: "decision", id: "keep-the-floors" }),
      ]),
    );
    await core.run("save_home", agent(session), { session, accessWidth: measured(820) });
    expect((await detail()).openFlags.map((flag) => flag.source.kind)).toEqual(["home"]);

    const other = { kind: "other" as const, title: "Keep the floors", decision: "keep-the-floors" };
    await save({
      ...other,
      statement: "The oak stays.",
      evidence: [{ kind: "session", id: session, stance: "supports" }],
    });
    expect((await detail()).openFlags).toHaveLength(1);
    await save({ ...other, statement: "The oak boards stay, sanded." });
    expect((await detail()).openFlags.map((flag) => flag.source.kind)).toEqual([
      "home",
      "decision",
    ]);
  });

  it("raise one flag per record while it is open, and none on a Rejected Purchase", async () => {
    await save(rug([must("Under 2.8 m wide", wall2)]));
    const wall = (mm: number) =>
      saveRoom({
        room: "living-room",
        name: "Living room",
        walls: [{ position: 2, length: measured(mm) }],
      });
    await wall(2950);
    await wall(2940);
    expect((await detail()).openFlags).toHaveLength(1);

    await setState("wool-rug", "rejected");
    await wall(2930);
    expect((await detail()).flags.filter((flag) => flag.clearedAt === undefined)).toEqual([]);
  });
});

describe("record_listing", () => {
  beforeEach(async () => {
    await save(
      rug([must("At least 2.0 m wide", wall2), must("Wool", cats), prefer("Low pile", cats)]),
    );
  });

  const jute = {
    name: "Jute rug",
    url: "https://example.com/jute-rug",
    price: "£120",
    dimensions: { width: 2000, depth: 3000 },
    checks: [
      { requirement: 1, result: "pass" as const, note: "2.0 × 3.0 m" },
      { requirement: 2, result: "fail" as const, note: "jute" },
      { requirement: 3, result: "unknown" as const },
    ],
  };

  it("records a Listing with a check per Requirement, which get_decision counts, naming each must it fails", async () => {
    const receipt = await listing(jute);
    expect(receipt).toContain(
      "Listing for Wool rug (wool-rug): added: Jute rug (jute-rug), £120: 1 pass, 1 fail, " +
        "1 unknown; fails must 2 (Wool)",
    );
    const [recorded] = (await detail()).listings;
    expect(recorded).toMatchObject({
      slug: "jute-rug",
      price: "£120",
      dimensions: { width: 2000, depth: 3000 },
      counts: { pass: 1, fail: 1, unknown: 1 },
      failedMusts: [2],
    });
    expect(await decisionText()).toContain(
      "- Jute rug (jute-rug), £120: 1 pass, 1 fail, 1 unknown; fails must 2 (Wool)",
    );
  });

  it("refuses a Listing without a check for every Requirement, naming those missing", async () => {
    const error = await refusal(listing({ ...jute, checks: jute.checks.slice(0, 2) }));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("3 (prefer: Low pile)");
    expect((await detail()).listings).toEqual([]);
  });

  it("refuses a check of a Requirement the Purchase lacks or has Archived", async () => {
    const lacking = await refusal(
      listing({ ...jute, checks: [...jute.checks, { requirement: 9, result: "pass" }] }),
    );
    await save(rug([{ position: 3, archive: true }], "wool-rug"));
    const archived = await refusal(listing(jute));
    expect([lacking.code, archived.code]).toEqual(["not_found", "not_found"]);
  });

  it("changes a Listing by its slug, replacing only the fields and checks given", async () => {
    await listing(jute);
    const receipt = await listing({
      listing: "jute-rug",
      price: "£99",
      checks: [{ requirement: 2, result: "pass", note: "wool and jute" }],
    });
    expect(receipt).toContain("changed: Jute rug (jute-rug), £99: 2 pass, 0 fail, 1 unknown");
    const [recorded] = (await detail()).listings;
    expect(recorded?.checks.map((check) => [check.requirement, check.result, check.note])).toEqual([
      [1, "pass", "2.0 × 3.0 m"],
      [2, "pass", "wool and jute"],
      [3, "unknown", undefined],
    ]);
  });

  it("counts a Requirement added after it as unknown until checked", async () => {
    await listing(jute);
    await save(rug([prefer("Warm tones", cats)], "wool-rug"));
    const [recorded] = (await detail()).listings;
    expect(recorded?.checks.at(-1)).toEqual({
      requirement: 4,
      text: "Warm tones",
      strength: "prefer",
      result: "unknown",
      unchecked: true,
    });
    expect(recorded?.counts.unknown).toBe(2);
    const error = await refusal(listing({ listing: "jute-rug", price: "£99" }));
    expect(error.message).toContain("4 (prefer: Warm tones)");
  });

  it("counts a changed Requirement as unchecked until checked again, logging the check it clears", async () => {
    await listing(jute);
    const receipt = await save(rug([{ position: 1, text: "At least 2.2 m wide" }], "wool-rug"));
    expect(receipt).toContain(
      "Requirement 1 of Wool rug (wool-rug): text changed; unchecked on Jute rug (jute-rug) " +
        "until record_listing checks it again",
    );
    const [recorded] = (await detail()).listings;
    expect(recorded?.checks[0]).toEqual({
      requirement: 1,
      text: "At least 2.2 m wide",
      strength: "must",
      result: "unknown",
      unchecked: true,
    });
    expect(recorded?.counts).toEqual({ pass: 0, fail: 1, unknown: 2 });
    const error = await refusal(listing({ listing: "jute-rug", price: "£99" }));
    expect(error.message).toContain("1 (must: At least 2.2 m wide)");
    const { changes } = await core.run("get_change_log", web, { home });
    expect(changes).toContainEqual(
      expect.objectContaining({
        record: "wool-rug",
        field: "requirement 1 checks",
        old: [{ listing: "jute-rug", result: "pass", note: "2.0 × 3.0 m" }],
      }),
    );
  });

  it("is refused on a closed Session, recording nothing", async () => {
    await core.run("close_session", agent(session), {
      session,
      summary: { changed: "A rug.", open: "Nothing", next: "Nothing" },
    });
    const error = await refusal(listing(jute));
    expect(error.code).toBe("session_closed");
    expect((await detail()).listings).toEqual([]);
  });

  it("is refused for a Rejected Purchase and for a Decision that is not a Purchase", async () => {
    await save({ kind: "other", title: "Keep the floors", statement: "The oak stays." });
    await setState("wool-rug", "rejected");
    const rejected = await refusal(listing(jute));
    const other = await refusal(
      core.run("record_listing", agent(session), {
        session,
        decision: "keep-the-floors",
        ...jute,
      }),
    );
    expect([rejected.code, other.code]).toEqual(["illegal_transition", "validation"]);
  });
});

describe("record_fulfilment of a Purchase", () => {
  beforeEach(async () => {
    await save(rug([must("At least 2.0 m wide", wall2), prefer("Low pile", cats)]));
    await setState("wool-rug", "settled");
  });

  const wool = { name: "Wool rug", category: "rugs" as const, width: measured(2000) };

  it("adds the Item bought to the Purchase's Room and Archives the Item it replaces", async () => {
    const receipt = await fulfil({
      decision: "wool-rug",
      bought: "Hay Plain rug, 200 × 300 cm",
      item: wool,
      replacesItem: "old-rug",
    });
    expect(receipt).toContain("Wool rug (wool-rug): Fulfilled: bought Hay Plain rug, 200 × 300 cm");
    expect(receipt).toContain("Old rug (old-rug): archived, replaced by Wool rug (wool-rug)");

    const { room, decisions } = await core.run("get_room", web, { home, room: "living-room" });
    // The Room page's live Items; the Archived one follows, for its Show Archived switch.
    expect(room.items.map((item) => [item.slug, Boolean(item.archivedAt)])).toEqual([
      ["wool-rug", false],
      ["old-rug", true],
    ]);
    expect(decisions).toEqual([]);
    const { items } = await core.run("list_items", web, { home, archived: true });
    expect(items.find((item) => item.slug === "old-rug")).toMatchObject({
      archivedAt: expect.any(String),
      archivedReason: "replaced by Wool rug (wool-rug)",
    });
    const decision = await detail();
    expect(decision.fulfilledAt).toEqual(expect.any(String));
    expect(decision.fulfilment).toEqual({
      bought: "Hay Plain rug, 200 × 300 cm",
      item: "wool-rug",
      replacedItem: "old-rug",
    });
  });

  it("adds the Item Unplaced when told", async () => {
    await fulfil({ decision: "wool-rug", bought: "A wool rug", item: { ...wool, unplaced: true } });
    const { items } = await core.run("list_items", web, { home });
    expect(items.find((item) => item.slug === "wool-rug")?.room).toBeUndefined();
  });

  it("adds a Feature bought in the Purchase's Room and Archives the Feature it replaces", async () => {
    await save({
      kind: "purchase",
      room: "living-room",
      title: "New radiator",
      statement: "A column radiator under the window.",
    });
    await setState("new-radiator", "settled");
    const receipt = await fulfil({
      decision: "new-radiator",
      bought: "A four-column radiator, 1.2 m",
      feature: { kind: "radiator", description: "four-column", wall: 1, width: measured(1200) },
      replacesFeature: "living-room-radiator",
    });
    expect(receipt).toContain(
      "Radiator (living-room-radiator): archived, replaced by Radiator (living-room-radiator-2)",
    );
    const { room } = await core.run("get_room", web, { home, room: "living-room" });
    expect(room.features.map((feature) => [feature.slug, feature.description])).toEqual([
      ["living-room-radiator-2", "four-column"],
    ]);
    expect((await detail("new-radiator")).fulfilment).toEqual({
      bought: "A four-column radiator, 1.2 m",
      feature: "living-room-radiator-2",
      replacedFeature: "living-room-radiator",
    });
  });

  it("records its Deviations; one from a must flags every Decision resting on the Purchase", async () => {
    await save({
      kind: "other",
      room: "living-room",
      title: "Rug pad",
      statement: "A felt pad under the rug.",
      basis: ["wool-rug"],
    });
    const receipt = await fulfil({
      decision: "wool-rug",
      bought: "A wool rug, 1.9 m wide",
      deviations: [
        {
          requirement: 1,
          text: "1.9 m wide, not at least 2.0 m",
          reason: "the only wool one in stock",
        },
        { requirement: 2, text: "a medium pile" },
      ],
      item: wool,
    });
    expect(receipt).toContain("Fulfilled with 2 Deviations");
    expect(receipt).toContain(
      'Deviation from Requirement 1 of Wool rug (wool-rug): must, "At least 2.0 m wide": ' +
        "1.9 m wide, not at least 2.0 m (the only wool one in stock)",
    );
    const { deviations } = await detail("wool-rug");
    expect(deviations.map((each) => each.reason)).toEqual([
      "the only wool one in stock",
      undefined,
    ]);
    expect(receipt).toContain(
      "Flagged for review: Rug pad (rug-pad), which rests on Wool rug (wool-rug), Fulfilled " +
        "with a Deviation from a must Requirement",
    );
    expect((await detail("rug-pad")).openFlags).toEqual([
      expect.objectContaining({
        cause: "deviation",
        source: expect.objectContaining({ slug: "wool-rug" }),
      }),
    ]);
    expect(
      (await detail()).deviations.map((each) => [each.requirement, each.strength, each.text]),
    ).toEqual([
      [1, "must", "1.9 m wide, not at least 2.0 m"],
      [2, "prefer", "a medium pile"],
    ]);
    expect(await decisionText()).toContain(
      "Deviations:\n- Requirement 1, must (At least 2.0 m wide): 1.9 m wide, not at least 2.0 m",
    );
  });

  it("flags nothing for a Deviation from a prefer", async () => {
    await save({
      kind: "other",
      room: "living-room",
      title: "Rug pad",
      statement: "A felt pad under the rug.",
      basis: ["wool-rug"],
    });
    const receipt = await fulfil({
      decision: "wool-rug",
      bought: "A wool rug",
      deviations: [{ requirement: 2, text: "a medium pile" }],
      item: wool,
    });
    expect(receipt).not.toContain("Flagged");
    expect((await detail("rug-pad")).openFlags).toEqual([]);
  });

  it("is refused while the Purchase has an open flag, naming it, and goes through once it is kept", async () => {
    await saveRoom({
      room: "living-room",
      name: "Living room",
      walls: [{ position: 2, length: measured(2950) }],
    });
    const error = await refusal(fulfil({ decision: "wool-rug", bought: "A wool rug", item: wool }));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("(wool-rug/flag-1)");
    expect(error.message).toContain("Living room, Wall 2 (living-room/wall-2) length changed");
    expect(error.message).toContain("set_decision_state");
    expect((await detail()).fulfilledAt).toBeUndefined();
    const { items } = await core.run("list_items", web, { home });
    expect(items.map((item) => item.slug)).toEqual(["old-rug"]);

    await setState("wool-rug", "settled");
    await fulfil({ decision: "wool-rug", bought: "A wool rug", item: wool });
    expect((await detail()).fulfilledAt).toEqual(expect.any(String));
  });

  it("is refused while the Purchase has an open Conflict, naming it", async () => {
    await core.run("flag_conflict", agent(session), {
      session,
      decision: "wool-rug",
      description: "The user now wants a jute rug.",
    });
    const error = await refusal(fulfil({ decision: "wool-rug", bought: "A wool rug" }));
    expect(error.message).toContain("wool-rug/conflict-1");
    expect(error.message).toContain("The user now wants a jute rug.");
    expect((await detail()).fulfilledAt).toBeUndefined();
  });

  it("leaves a Fulfilled Purchase Settled for good, so what its Deviations differ from never changes", async () => {
    await fulfil({
      decision: "wool-rug",
      bought: "A wool rug, 1.9 m wide",
      deviations: [{ requirement: 1, text: "1.9 m wide, not at least 2.0 m" }],
      item: wool,
    });
    const reopen = await refusal(setState("wool-rug", "leaning"));
    const reject = await refusal(
      core.run("set_decision_state", web, { home, decision: "wool-rug", to: "rejected" }),
    );
    const edit = await refusal(
      save(rug([{ position: 1, text: "At least 1.8 m wide" }], "wool-rug")),
    );
    expect([reopen.code, reject.code, edit.code]).toEqual([
      "illegal_transition",
      "illegal_transition",
      "illegal_transition",
    ]);
    expect(reopen.message).toContain("Wool rug (wool-rug) was Fulfilled on");
    expect(reopen.message).toContain("save a new Decision");
    const decision = await detail();
    expect(decision.state).toBe("settled");
    expect(decision.deviations[0]).toMatchObject({ requirementText: "At least 2.0 m wide" });
  });

  it("leaves a Fulfilled Purchase alone when a new one of the same title is saved", async () => {
    await fulfil({ decision: "wool-rug", bought: "A wool rug", item: wool });
    const receipt = await save(rug([must("Wool", cats)]));
    expect(receipt).toContain("Wool rug (wool-rug-2): created as a Candidate Purchase");
    expect((await detail()).requirements.map((each) => each.text)).toEqual([
      "At least 2.0 m wide",
      "Low pile",
    ]);
    expect((await detail("wool-rug-2")).requirements.map((each) => each.text)).toEqual(["Wool"]);
  });

  it("refuses a Purchase that is not Settled, changing nothing", async () => {
    await save({ ...rug([must("Wool", cats)]), title: "Hall runner", statement: "A runner." });
    const error = await refusal(
      fulfil({ decision: "hall-runner", bought: "A runner", item: { ...wool, name: "Runner" } }),
    );
    expect(error.code).toBe("not_settled");
    const { items } = await core.run("list_items", web, { home });
    expect(items.map((item) => item.slug)).toEqual(["old-rug"]);
    expect((await detail("hall-runner")).fulfilledAt).toBeUndefined();
  });

  it("needs bought, and refuses a Deviation from a Requirement it does not have", async () => {
    const noBought = await refusal(fulfil({ decision: "wool-rug", item: wool }));
    const noRequirement = await refusal(
      fulfil({
        decision: "wool-rug",
        bought: "A rug",
        deviations: [{ requirement: 7, text: "x" }],
      }),
    );
    expect([noBought.code, noRequirement.code]).toEqual(["validation", "not_found"]);
    expect((await detail()).fulfilledAt).toBeUndefined();
  });

  it("refuses Purchase fields on a Room use, and roomFunctions on a Purchase", async () => {
    await save({
      kind: "room-use",
      room: "hallway",
      title: "Storage too",
      statement: "Coats in the hall.",
      content: { functions: ["hallway", "storage"] },
    });
    await setState("storage-too", "settled");
    const onRoomUse = await refusal(fulfil({ decision: "storage-too", bought: "Hooks" }));
    const onPurchase = await refusal(
      fulfil({ decision: "wool-rug", bought: "A rug", roomFunctions: ["living"] }),
    );
    expect(onRoomUse.message).toContain("bought is for a Purchase");
    expect(onPurchase.message).toContain("roomFunctions is for a Room use");
  });

  it("refuses to replace an Item already Archived", async () => {
    await core.run("save_items", agent(session), {
      session,
      items: [{ item: "old-rug", archive: true, archiveReason: "given away" }],
    });
    const error = await refusal(
      fulfil({ decision: "wool-rug", bought: "A rug", item: wool, replacesItem: "old-rug" }),
    );
    expect(error.code).toBe("validation");
  });
});
