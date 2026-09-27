// The stored automatic Basis of slice 5b, written before its implementation: the Design Direction
// and the Palette in force are stored in a Decision's Basis when it is created or starts using the
// Palette's colors, and never move silently; keeping or Reopening a Decision flagged by its own
// automatic entry re-bases it on the one in force; the cascade reads the stored Basis only; and a
// Room color is Fulfilled against the Palette stored in its Basis. Computing the automatic entries
// from whatever is in force now would rewrite history once a successor exists: a Room color made on
// Palette A would come to show Palette B, and nothing would record that it was made on A.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import type { DecisionDetail, DecisionState, PaletteColor } from "./operations/schemas.js";

const web: CallContext = { caller: { kind: "web" } };

let core: Core;
let home: string;
let session: string;
const agent = (id?: string): CallContext => ({ caller: { kind: "session", session: id }, home });

beforeEach(async () => {
  core = createCore();
  home = (await core.run("create_home", web, { name: "My flat", country: "GB", city: "London" }))
    .home.slug;
  session = (
    await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "color" })
  ).session;
  await core.run("save_room", agent(session), {
    session,
    name: "Living room",
    walls: [{ position: 1 }, { position: 2 }, { position: 3 }, { position: 4 }],
    surfaces: {
      walls: { color: { name: "cream", provenance: "estimated" }, finish: "matt" },
      ceiling: { color: { name: "white", provenance: "estimated" } },
    },
  });
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

async function save(input: SaveInput): Promise<string> {
  return (await core.run("save_decision", agent(session), { session, ...input })).receipt;
}

async function setState(decision: string, to: DecisionState): Promise<string> {
  const reason = 'The user: "yes, do it"';
  return (await core.run("set_decision_state", agent(session), { session, decision, to, reason }))
    .receipt;
}

async function resolveFlag(decision: string, resolution: "keep" | "reopen" | "reject") {
  const flag = (await detail(decision)).openFlags[0]?.slug ?? "";
  return (await core.run("resolve_flag", web, { home, flag, resolution })).receipt;
}

async function fulfil(decision: string) {
  return core.run("record_fulfilment", agent(session), { session, decision });
}

async function detail(decision: string): Promise<DecisionDetail> {
  return (await core.run("get_decision", web, { home, decision })).decision;
}

/** The text get_decision gives the Agent. */
async function rendered(decision: string): Promise<string> {
  const result = await core.run("get_decision", agent(session), { session, decision });
  const operation = core.operations.find((each) => each.name === "get_decision");
  return operation?.text?.(result) ?? "";
}

/** The Basis as [slug, automatic] pairs. */
async function basis(decision: string): Promise<[string, boolean][]> {
  return (await detail(decision)).basis.map((entry) => [entry.slug, entry.automatic]);
}

async function flagged(): Promise<string[]> {
  const { decisions } = await core.run("list_decisions", web, { home });
  return decisions.filter((each) => each.openFlags.length > 0).map((each) => each.slug);
}

async function surface(part: "walls" | "ceiling") {
  const { room } = await core.run("get_room", web, { home, room: "living-room" });
  return room.surfaces.find((each) => each.part === part);
}

const SETTING_PLASTER: PaletteColor = {
  name: "Setting Plaster",
  brand: "Farrow & Ball",
  code: "No. 231",
  lrv: 63,
  provenance: "measured",
  role: "base",
  note: "walls throughout",
};
const POINTING: PaletteColor = {
  name: "Pointing",
  brand: "Farrow & Ball",
  code: "No. 2003",
  provenance: "measured",
  role: "secondary",
};
const TERRACOTTA: PaletteColor = {
  name: "warm terracotta",
  provenance: "estimated",
  role: "accent",
};
const HAGUE_BLUE: PaletteColor = {
  name: "Hague Blue",
  brand: "Farrow & Ball",
  code: "No. 30",
  provenance: "measured",
  role: "accent",
};

const direction = (title: string): SaveInput => ({
  kind: "design-direction",
  title,
  statement: `${title}, as the user said.`,
  content: { mood: "calm", temperature: "warm", contrast: "low" },
});

const other = (title: string, basis?: string[]): SaveInput => ({
  kind: "other",
  title,
  statement: `${title}, as the user said.`,
  ...(basis ? { basis } : {}),
});

const palette = (title: string, colors: PaletteColor[]): SaveInput => ({
  kind: "palette",
  title,
  statement: `${title}: the Home's colors.`,
  content: { colors },
});

const roomColor = (
  title: string,
  surface: "walls" | "ceiling" | "floor" | "woodwork",
  color: string,
): SaveInput => ({
  kind: "room-color",
  room: "living-room",
  title,
  statement: `${title}, as the user chose.`,
  content: { surface, color, finish: "matt" },
});

const cushions = (requirements?: SaveInput["requirements"]): SaveInput => ({
  kind: "purchase",
  room: "living-room",
  title: "Cushions",
  statement: "Two cushions in the accent.",
  ...(requirements ? { requirements } : {}),
});

const inTerracotta = {
  text: "Warm terracotta",
  strength: "must" as const,
  reason: { kind: "decision" as const, id: "warm-clay" },
};

/** A Settled Design Direction "Warm minimalism" and a Settled Palette "Warm clay". */
async function settled(colors = [SETTING_PLASTER, POINTING, TERRACOTTA]): Promise<void> {
  await save(direction("Warm minimalism"));
  await setState("warm-minimalism", "settled");
  await save(palette("Warm clay", colors));
  await setState("warm-clay", "settled");
}

describe("two Design Directions in sequence", () => {
  it("leaves the dependents on the first until each is kept or Reopened, then rests them on the second", async () => {
    await save(direction("Warm minimalism"));
    await setState("warm-minimalism", "settled");
    await save(other("Keep the floors"));
    await setState("keep-the-floors", "settled");
    await save(other("Knock through"));
    await setState("knock-through", "settled");
    await save(other("New skirting"));

    await setState("warm-minimalism", "rejected");
    await save(direction("Industrial"));
    await setState("industrial", "settled");
    await save(other("Paint the doors"));

    for (const slug of ["keep-the-floors", "knock-through", "new-skirting"]) {
      expect(await basis(slug)).toEqual([["warm-minimalism", true]]);
    }
    expect((await detail("keep-the-floors")).basis[0]).toMatchObject({ state: "rejected" });
    expect(await basis("paint-the-doors")).toEqual([["industrial", true]]);
    expect(await basis("industrial")).toEqual([]);
    expect(await flagged()).toEqual(["keep-the-floors", "knock-through", "new-skirting"]);

    const kept = await setState("keep-the-floors", "settled");
    const reopened = await resolveFlag("knock-through", "reopen");
    const keptOnWeb = await resolveFlag("new-skirting", "keep");

    for (const slug of ["keep-the-floors", "knock-through", "new-skirting"]) {
      expect(await basis(slug)).toEqual([["industrial", true]]);
    }
    expect(kept).toContain(
      "Keep the floors (keep-the-floors): now rests on Industrial (industrial), the Design Direction",
    );
    expect(reopened).toContain(
      "Knock through (knock-through): now rests on Industrial (industrial)",
    );
    expect(keptOnWeb).toContain(
      "New skirting (new-skirting): now rests on Industrial (industrial)",
    );
    expect((await detail("knock-through")).state).toBe("leaning");
    expect(await flagged()).toEqual([]);
    const { changes } = await core.run("get_change_log", web, { home });
    expect(changes).toContainEqual(
      expect.objectContaining({
        recordKind: "decision",
        record: "keep-the-floors",
        field: "automatic design-direction",
        old: "warm-minimalism",
        new: "industrial",
      }),
    );
  });
});

describe("two Palettes in sequence", () => {
  it("leaves the Room colors on the first until kept or Reopened, then rests them on the second; Reject leaves it", async () => {
    await settled([SETTING_PLASTER, POINTING]);
    await save(roomColor("Plaster walls", "walls", "Setting Plaster"));
    await setState("plaster-walls", "settled");
    await save(roomColor("Pointing ceiling", "ceiling", "Pointing"));
    await setState("pointing-ceiling", "settled");
    await save(roomColor("Pointing woodwork", "woodwork", "Pointing"));

    await setState("warm-clay", "rejected");
    const everyWall = { ...SETTING_PLASTER, note: "every wall" };
    await save(palette("Cool stone", [everyWall, HAGUE_BLUE]));
    await setState("cool-stone", "settled");

    for (const slug of ["plaster-walls", "pointing-ceiling", "pointing-woodwork"]) {
      expect(await basis(slug)).toEqual([
        ["warm-minimalism", true],
        ["warm-clay", true],
      ]);
    }
    expect((await detail("plaster-walls")).paletteColor).toEqual(SETTING_PLASTER);

    const kept = await setState("plaster-walls", "settled");
    await resolveFlag("pointing-ceiling", "reopen");
    await setState("pointing-woodwork", "rejected");

    expect(kept).toContain(
      "Plaster walls (plaster-walls): now rests on Cool stone (cool-stone), the Palette",
    );
    for (const slug of ["plaster-walls", "pointing-ceiling"]) {
      expect(await basis(slug)).toEqual([
        ["warm-minimalism", true],
        ["cool-stone", true],
      ]);
    }
    expect((await detail("plaster-walls")).paletteColor).toEqual(everyWall);
    expect(await basis("pointing-woodwork")).toEqual([
      ["warm-minimalism", true],
      ["warm-clay", true],
    ]);
  });

  it("stores the Palette a Room color's changed content was checked against", async () => {
    await settled([SETTING_PLASTER]);
    await save(roomColor("Plaster walls", "walls", "Setting Plaster"));
    await setState("warm-clay", "rejected");
    await save(palette("Cool stone", [SETTING_PLASTER, HAGUE_BLUE]));
    await setState("cool-stone", "settled");

    const receipt = await save({
      ...roomColor("Plaster walls", "walls", "Hague Blue"),
      decision: "plaster-walls",
    });

    expect(receipt).toContain("now rests on Cool stone (cool-stone), the Palette");
    expect(await basis("plaster-walls")).toEqual([
      ["warm-minimalism", true],
      ["cool-stone", true],
    ]);
    expect((await detail("plaster-walls")).paletteColor).toEqual(HAGUE_BLUE);
  });
});

describe("a Fulfilled Room color", () => {
  it("keeps its Palette through a new Palette and a new Design Direction, and is never flagged", async () => {
    await settled();
    await save(roomColor("Pointing ceiling", "ceiling", "Pointing"));
    await setState("pointing-ceiling", "settled");
    await fulfil("pointing-ceiling");
    const before = await detail("pointing-ceiling");

    await setState("warm-clay", "rejected");
    await save(palette("Cool stone", [HAGUE_BLUE]));
    await setState("cool-stone", "settled");
    await setState("warm-minimalism", "rejected");
    await save(direction("Industrial"));
    await setState("industrial", "settled");
    await save({
      ...roomColor("Pointing ceiling", "ceiling", "Pointing"),
      decision: "pointing-ceiling",
      evidence: [{ kind: "session", id: session, stance: "supports" }],
    });

    const after = await detail("pointing-ceiling");
    expect(await basis("pointing-ceiling")).toEqual([
      ["warm-minimalism", true],
      ["warm-clay", true],
    ]);
    expect(after.flags).toEqual([]);
    expect(after.paletteColor).toEqual(POINTING);
    expect(after.fulfilment).toEqual(before.fulfilment);
  });
});

describe("record_fulfilment against the stored Palette", () => {
  it("is refused with illegal_transition once the Palette lost the color, changing nothing", async () => {
    await settled([SETTING_PLASTER, POINTING]);
    await save(roomColor("Pointing ceiling", "ceiling", "Pointing"));
    await setState("pointing-ceiling", "settled");
    await setState("warm-clay", "leaning");
    await save({ ...palette("Warm clay", [SETTING_PLASTER]), decision: "warm-clay" });
    await setState("warm-clay", "settled");
    // Fulfilment waits for the flag the Reopen raised to be settled: the user keeps it.
    await setState("pointing-ceiling", "settled");

    const error = await refusal(fulfil("pointing-ceiling"));

    expect(error.code).toBe("illegal_transition");
    expect(error.message).toContain("Warm clay (warm-clay)");
    expect(error.message).toContain("changed");
    expect(error.message).toContain("Reopen");
    expect((await surface("ceiling"))?.color?.name).toBe("white");
    expect((await detail("pointing-ceiling")).fulfilledAt).toBeUndefined();
  });

  it("succeeds after the Palette was Reopened and Settled again with the color unchanged", async () => {
    await settled();
    await save(roomColor("Plaster walls", "walls", "Setting Plaster"));
    await setState("plaster-walls", "settled");
    await setState("warm-clay", "leaning");
    await save({
      ...palette("Warm clay", [SETTING_PLASTER, POINTING, { ...TERRACOTTA, note: "cushions" }]),
      decision: "warm-clay",
    });
    await setState("warm-clay", "settled");
    await setState("plaster-walls", "settled");

    await fulfil("plaster-walls");

    expect((await surface("walls"))?.color).toMatchObject({
      name: "Setting Plaster",
      code: "No. 231",
      provenance: "measured",
    });
    expect((await detail("plaster-walls")).fulfilledAt).toEqual(expect.any(String));
  });
});

describe("a Purchase using the Palette's colors", () => {
  it("gets the Palette in its Basis when a Requirement naming it is added, not before", async () => {
    await settled();
    await save(cushions());
    expect(await basis("cushions")).toEqual([["warm-minimalism", true]]);

    const receipt = await save({ ...cushions([inTerracotta]), decision: "cushions" });

    expect(receipt).toContain(
      "Cushions (cushions): now rests on Warm clay (warm-clay), the Palette",
    );
    expect(await basis("cushions")).toEqual([
      ["warm-minimalism", true],
      ["warm-clay", true],
    ]);
    await setState("warm-clay", "leaning");
    expect(await flagged()).toEqual(["cushions"]);
  });

  it("holds a Palette given in its Basis once, as automatic, when a Requirement names it", async () => {
    await settled();
    await save({ ...cushions([inTerracotta]), basis: ["warm-clay"] });
    expect(await basis("cushions")).toEqual([
      ["warm-minimalism", true],
      ["warm-clay", true],
    ]);
  });
});

describe("a Decision a Requirement's reason names", () => {
  it("joins the Purchase's Basis as a given entry, with a receipt line, so its Reject flags the Purchase", async () => {
    await settled();
    await save(other("Keep the floors"));
    await setState("keep-the-floors", "settled");
    const oakTones = {
      text: "Oak tones",
      strength: "must" as const,
      reason: { kind: "decision" as const, id: "keep-the-floors" },
    };

    const receipt = await save(cushions([oakTones]));
    const replaced = await save({ ...cushions(), decision: "cushions", basis: [] });

    expect(receipt).toContain(
      "Cushions (cushions): created as a Candidate Purchase for Living room (living-room); " +
        "Basis: Warm minimalism (warm-minimalism), the Design Direction, automatically; now " +
        "rests on Keep the floors (keep-the-floors), the reason of Requirement 1",
    );
    expect(replaced).toContain(
      "now rests on Keep the floors (keep-the-floors), the reason of Requirement 1",
    );
    expect(await basis("cushions")).toEqual([
      ["warm-minimalism", true],
      ["keep-the-floors", false],
    ]);
    await setState("keep-the-floors", "rejected");
    expect(await flagged()).toEqual(["cushions"]);
  });
});

describe("a Decision created before any Design Direction", () => {
  it("gets the Direction in force on its next save or state change, never in between", async () => {
    await save(other("Keep the floors"));
    await save(other("Knock through"));
    await save(direction("Warm minimalism"));
    await setState("warm-minimalism", "settled");

    expect(await basis("keep-the-floors")).toEqual([]);
    expect(await rendered("keep-the-floors")).toContain("no Design Direction in its Basis");
    await setState("warm-minimalism", "leaning");
    expect(await flagged()).toEqual([]);
    await setState("warm-minimalism", "settled");

    const saved = await save({ ...other("Keep the floors"), statement: "The floors stay." });
    const moved = await setState("knock-through", "leaning");

    expect(saved).toContain(
      "Keep the floors (keep-the-floors): statement changed; now rests on Warm minimalism " +
        "(warm-minimalism), the Design Direction",
    );
    expect(moved).toContain(
      "Knock through (knock-through): now rests on Warm minimalism (warm-minimalism), the " +
        "Design Direction",
    );
    for (const slug of ["keep-the-floors", "knock-through"]) {
      expect(await basis(slug)).toEqual([["warm-minimalism", true]]);
    }
    expect(await rendered("keep-the-floors")).not.toContain("no Design Direction");
  });
});

describe("the flag cascade from the stored Basis", () => {
  it("flags a given-Basis dependent and an automatic one alike, and nothing else", async () => {
    await save(other("Early idea"));
    await settled();
    await save(other("Blue study", ["warm-clay"]));
    await save(roomColor("Plaster walls", "walls", "Setting Plaster"));
    await save(other("Knock through"));
    await save(cushions());
    await save(roomColor("Dropped floor", "floor", "warm terracotta"));
    await setState("dropped-floor", "rejected");
    await save(roomColor("Done woodwork", "woodwork", "Pointing"));
    await setState("done-woodwork", "settled");
    await fulfil("done-woodwork");

    const { receipt } = await core.run("set_decision_state", web, {
      home,
      decision: "warm-clay",
      to: "leaning",
    });

    expect(await flagged()).toEqual(["blue-study", "plaster-walls"]);
    for (const slug of ["blue-study", "plaster-walls"]) {
      expect((await detail(slug)).openFlags).toEqual([
        expect.objectContaining({
          cause: "reopened",
          source: expect.objectContaining({ slug: "warm-clay" }),
        }),
      ]);
    }
    expect(receipt).not.toContain("early-idea");
  });
});

describe("re-basing", () => {
  it("happens only for a flag whose source is the Decision's own automatic entry", async () => {
    await settled();
    await save(palette("Deep blues", [HAGUE_BLUE]));
    await save(other("Blue study", ["deep-blues"]));
    await setState("blue-study", "settled");
    await setState("deep-blues", "rejected");
    await setState("warm-minimalism", "rejected");
    await save(direction("Industrial"));
    await setState("industrial", "settled");
    const [fromGiven, fromDirection] = (await detail("blue-study")).openFlags;

    const keptGiven = await core.run("resolve_flag", web, {
      home,
      flag: fromGiven?.slug ?? "",
      resolution: "keep",
    });
    const afterGiven = await basis("blue-study");
    await core.run("resolve_flag", web, {
      home,
      flag: fromDirection?.slug ?? "",
      resolution: "keep",
    });

    expect(fromGiven?.source.slug).toBe("deep-blues");
    expect(keptGiven.receipt).not.toContain("now rests on");
    expect(afterGiven).toEqual([
      ["warm-minimalism", true],
      ["deep-blues", false],
    ]);
    expect(await basis("blue-study")).toEqual([
      ["industrial", true],
      ["deep-blues", false],
    ]);
  });

  it("with nothing of the kind in force leaves a gap, which get_decision shows and Fulfilment refuses until one joins", async () => {
    await settled();
    await save(roomColor("Plaster walls", "walls", "Setting Plaster"));
    await setState("plaster-walls", "settled");
    await setState("warm-clay", "rejected");

    const kept = await setState("plaster-walls", "settled");
    const error = await refusal(fulfil("plaster-walls"));

    expect(kept).toContain(
      "Plaster walls (plaster-walls): no longer rests on Warm clay (warm-clay), the Palette: no " +
        "Palette is in force",
    );
    expect(await basis("plaster-walls")).toEqual([["warm-minimalism", true]]);
    expect(await rendered("plaster-walls")).toContain("no Palette in its Basis");
    expect(error.code).toBe("illegal_transition");
    expect(error.message).toContain("no Palette in its Basis");

    await save(palette("Cool stone", [SETTING_PLASTER]));
    await setState("cool-stone", "settled");
    const joined = await save({
      ...roomColor("Plaster walls", "walls", "Setting Plaster"),
      decision: "plaster-walls",
      evidence: [{ kind: "session", id: session, stance: "supports" }],
    });
    await fulfil("plaster-walls");

    expect(joined).toContain("now rests on Cool stone (cool-stone), the Palette");
    expect((await surface("walls"))?.color?.name).toBe("Setting Plaster");
  });
});
