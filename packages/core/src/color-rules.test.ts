// The server-enforced Color rules of slice 5, written before their implementation: a Room color
// names a color of the Palette in force; the Palette in force enters the Basis of the Decisions
// using its colors, and only theirs; its Reopen and Reject flag those Decisions and no others;
// Fulfilling a Locked Room color paints its Surface with the right Provenance and finish; and one
// Palette is Locked at a time (docs/specs/skill-set.md#decision-kinds and #rule-enforcement).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import type { ChangeEvent } from "./events.js";
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
    surfaces: { walls: { color: { name: "cream", provenance: "estimated" }, finish: "matt" } },
  });
  await core.run("save_room", agent(session), { session, name: "Spare room" });
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

async function setState(decision: string, to: DecisionState) {
  return core.run("set_decision_state", agent(session), {
    session,
    decision,
    to,
    reason: 'The user: "yes, do it"',
  });
}

async function fulfil(
  decision: string,
  extra: { finish?: string; overrideProvenance?: string } = {},
) {
  return core.run("record_fulfilment", agent(session), { session, decision, ...extra });
}

async function detail(decision: string): Promise<DecisionDetail> {
  return (await core.run("get_decision", web, { home, decision })).decision;
}

async function livingRoom() {
  return core.run("get_room", web, { home, room: "living-room" });
}

const SETTING_PLASTER: PaletteColor = {
  name: "Setting Plaster",
  brand: "Farrow & Ball",
  code: "No. 231",
  lrv: 63,
  hex: "#d8b9a6",
  provenance: "measured",
  role: "base",
  note: "walls throughout",
};
const POINTING: PaletteColor = {
  name: "Pointing",
  brand: "Farrow & Ball",
  code: "No. 2003",
  hex: "#ece3d0",
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

const direction: SaveInput = {
  kind: "design-direction",
  title: "Warm minimalism",
  statement: "Calm, warm rooms of natural materials.",
  content: { mood: "calm", temperature: "warm", contrast: "low" },
};

const palette = (title: string, colors: PaletteColor[]): SaveInput => ({
  kind: "palette",
  title,
  statement: `${title}: the Home's colors.`,
  content: { colors },
});

const roomColor = (
  title: string,
  content: {
    surface: "walls" | "ceiling" | "floor" | "woodwork";
    color: string;
    wall?: number;
    finish?: string;
  },
  room = "living-room",
): SaveInput => ({
  kind: "room-color",
  room,
  title,
  statement: `${title}, as the user chose.`,
  content: { finish: "eggshell", ...content },
});

/** A Locked Design Direction and a Locked Palette "Warm clay". */
async function settled(colors = [SETTING_PLASTER, POINTING, TERRACOTTA]): Promise<void> {
  await save(direction);
  await setState("warm-minimalism", "locked");
  await save(palette("Warm clay", colors));
  await setState("warm-clay", "locked");
}

describe("a Room color's color", () => {
  it("is refused when it names no color of the Palette in force, listing the Palette's colors", async () => {
    await settled();

    const error = await refusal(
      save(roomColor("Blue walls", { surface: "walls", color: "Hague Blue" })),
    );

    expect(error.code).toBe("validation");
    expect(error.message).toContain("Hague Blue");
    expect(error.message).toContain("Warm clay (warm-clay)");
    for (const name of ["Setting Plaster", "Pointing", "warm terracotta"]) {
      expect(error.message).toContain(name);
    }
    const { decisions } = await core.run("list_decisions", web, { home, kind: "room-color" });
    expect(decisions).toEqual([]);
  });

  it("is refused when no Palette is in force, saying to settle one first", async () => {
    await save(direction);
    await save(palette("Warm clay", [SETTING_PLASTER]));

    const error = await refusal(
      save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" })),
    );

    expect(error.code).toBe("validation");
    expect(error.message).toContain("Palette");
    expect(error.message).toContain("Candidate");
  });

  it("is checked against the Locked Palette, else the latest Leaning one", async () => {
    await settled();
    await save(palette("Deep blues", [HAGUE_BLUE]));
    await setState("deep-blues", "leaning");

    const whileLocked = await refusal(
      save(roomColor("Blue walls", { surface: "walls", color: "Hague Blue" })),
    );
    await setState("warm-clay", "rejected");
    await save(roomColor("Blue walls", { surface: "walls", color: "Hague Blue" }));

    expect(whileLocked.code).toBe("validation");
    expect((await detail("blue-walls")).content).toMatchObject({ color: "Hague Blue" });
  });

  it("matches the name in any case and stores the Palette's spelling", async () => {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "  setting   plaster " }));
    expect((await detail("plaster-walls")).content).toEqual({
      surface: "walls",
      color: "Setting Plaster",
      finish: "eggshell",
    });
  });

  it("is checked again when its content changes, but not when only Evidence is added", async () => {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
    await setState("warm-clay", "leaning");
    await core.run("set_decision_state", agent(session), {
      session,
      decision: "warm-clay",
      to: "rejected",
      reason: 'The user: "scrap that palette"',
    });
    await save(palette("Deep blues", [HAGUE_BLUE]));
    await setState("deep-blues", "locked");

    const changed = await refusal(
      save({
        ...roomColor("Plaster walls", {
          surface: "walls",
          color: "Setting Plaster",
          finish: "matt",
        }),
        decision: "plaster-walls",
      }),
    );
    await save({
      ...roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }),
      decision: "plaster-walls",
      evidence: [{ kind: "session", id: session, stance: "undermines" }],
    });

    expect(changed.code).toBe("validation");
    expect(changed.message).toContain("Hague Blue");
    expect((await detail("plaster-walls")).evidence).toHaveLength(1);
  });

  it("names one Wall only with surface walls, and only a Wall the Room has", async () => {
    await settled();
    const ceiling = await refusal(
      save(roomColor("Wall 2", { surface: "ceiling", wall: 2, color: "Pointing" })),
    );
    const missing = await refusal(
      save(roomColor("Wall 9", { surface: "walls", wall: 9, color: "Pointing" })),
    );
    await save(roomColor("Wall 2", { surface: "walls", wall: 2, color: "Pointing" }));

    expect(ceiling.code).toBe("validation");
    expect(missing.code).toBe("not_found");
    expect(missing.message).toContain("living-room/wall-4");
    expect((await detail("wall-2")).content).toMatchObject({ wall: 2 });
  });
});

describe("the Palette in force in the Basis", () => {
  it("is in a Room color's Basis automatically, after the Design Direction, and never listed twice", async () => {
    await settled();
    await save({
      ...roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }),
      basis: ["warm-clay", "warm-minimalism"],
    });

    const { basis, paletteColor } = await detail("plaster-walls");

    expect(basis).toEqual([
      expect.objectContaining({
        slug: "warm-minimalism",
        kind: "design-direction",
        automatic: true,
      }),
      expect.objectContaining({ slug: "warm-clay", kind: "palette", automatic: true }),
    ]);
    expect(paletteColor).toEqual(SETTING_PLASTER);
  });

  // Stored, not computed, since slice 5b: another Palette in force takes its place only once the
  // Room color is kept or Reopened (basis-rules.test.ts).

  it("is not in the Basis of a Decision that uses none of its colors", async () => {
    await settled();
    await save({ kind: "other", title: "Knock through", statement: "Open up the kitchen." });
    await save({
      kind: "room-direction",
      room: "living-room",
      title: "Calm evenings",
      statement: "A low, warm room.",
      content: { direction: "Lamplight and wool." },
    });
    await save({
      kind: "purchase",
      room: "living-room",
      title: "Rug",
      statement: "A wool rug.",
      requirements: [
        { text: "Wool", strength: "prefer", reason: { kind: "decision", id: "warm-minimalism" } },
      ],
    });

    for (const slug of ["knock-through", "calm-evenings", "rug"]) {
      expect((await detail(slug)).basis.map((entry) => entry.slug)).toEqual(["warm-minimalism"]);
    }
    expect((await detail("warm-clay")).basis.map((entry) => entry.slug)).toEqual([
      "warm-minimalism",
    ]);
  });

  it("is in the Basis of a Purchase with a Requirement whose reason is the Palette", async () => {
    await settled();
    await save({
      kind: "purchase",
      room: "living-room",
      title: "Cushions",
      statement: "Two cushions in the accent.",
      requirements: [
        {
          text: "Warm terracotta",
          strength: "must",
          reason: { kind: "decision", id: "warm-clay" },
        },
      ],
    });

    expect((await detail("cushions")).basis).toEqual([
      expect.objectContaining({ slug: "warm-minimalism", automatic: true }),
      expect.objectContaining({ slug: "warm-clay", automatic: true }),
    ]);
  });

  it("is named in the save_decision receipt", async () => {
    await settled();
    const receipt = await save(
      roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }),
    );
    expect(receipt).toContain("Warm clay (warm-clay), the Palette, automatically");
  });
});

describe("Reopen and Reject of the Palette", () => {
  /** Decisions that use the Palette's colors, and some that do not. */
  async function decisions(): Promise<void> {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
    await setState("plaster-walls", "locked");
    await save(roomColor("Pointing ceiling", { surface: "ceiling", color: "Pointing" }));
    await save(roomColor("Done woodwork", { surface: "woodwork", color: "Pointing" }));
    await setState("done-woodwork", "locked");
    await fulfil("done-woodwork");
    await save(roomColor("Dropped floor", { surface: "floor", color: "warm terracotta" }));
    await setState("dropped-floor", "rejected");
    await save({
      kind: "purchase",
      room: "living-room",
      title: "Cushions",
      statement: "Two cushions in the accent.",
      requirements: [
        {
          text: "Warm terracotta",
          strength: "must",
          reason: { kind: "decision", id: "warm-clay" },
        },
      ],
    });
    await save({ kind: "other", title: "Knock through", statement: "Open up the kitchen." });
    await save({
      kind: "room-direction",
      room: "living-room",
      title: "Calm evenings",
      statement: "A low, warm room.",
      content: { direction: "Lamplight and wool." },
    });
    await setState("calm-evenings", "locked");
  }

  const flagged = async () => {
    const { decisions } = await core.run("list_decisions", web, { home });
    return decisions.filter((each) => each.openFlags.length > 0).map((each) => each.slug);
  };

  it.each([
    ["Reopen", "leaning", "reopened"],
    ["Reject", "rejected", "rejected"],
  ] as const)("%s flags the Decisions using its colors and no others", async (_, to, cause) => {
    await decisions();

    const { receipt } = await setState("warm-clay", to);

    expect(await flagged()).toEqual(["plaster-walls", "pointing-ceiling", "cushions"]);
    expect((await detail("plaster-walls")).openFlags).toEqual([
      expect.objectContaining({
        cause,
        source: expect.objectContaining({ kind: "decision", slug: "warm-clay" }),
      }),
    ]);
    expect((await detail("plaster-walls")).state).toBe("locked");
    expect(receipt).toContain("Plaster walls (plaster-walls)");
    expect(receipt).not.toContain("knock-through");
    expect(receipt).not.toContain("done-woodwork");
  });

  it("a Palette not in force flags only the Decisions that list it in their Basis", async () => {
    await decisions();
    await save(palette("Deep blues", [HAGUE_BLUE]));
    await save({ kind: "other", title: "Blue study", statement: "Maybe.", basis: ["deep-blues"] });

    await setState("deep-blues", "rejected");

    expect(await flagged()).toEqual(["blue-study"]);
  });
});

describe("record_fulfilment on a Room color", () => {
  it("paints the Surface with the Palette color, Measured when it has a brand and code, and marks the Decision Fulfilled", async () => {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
    await setState("plaster-walls", "locked");

    const { receipt } = await fulfil("plaster-walls");

    const { room, decisions } = await livingRoom();
    const walls = room.surfaces.find((surface) => surface.part === "walls");
    const color = {
      name: "Setting Plaster",
      brand: "Farrow & Ball",
      code: "No. 231",
      lrv: 63,
      hex: "#d8b9a6",
      provenance: "measured",
    };
    expect(walls).toMatchObject({ slug: "living-room/walls", color, finish: "eggshell" });
    expect(decisions.map((each) => each.slug)).not.toContain("plaster-walls");
    const decision = await detail("plaster-walls");
    expect(decision.state).toBe("locked");
    expect(decision.fulfilledAt).toEqual(expect.any(String));
    expect(decision.fulfilment).toEqual({
      surface: "living-room/walls",
      color,
      finish: "eggshell",
    });
    expect(receipt).toContain("Fulfilled");
    expect(receipt).toContain("Setting Plaster (Farrow & Ball No. 231), LRV 63 (Measured)");
    expect(receipt).toContain("was ~cream (Estimated)");
  });

  it("gives a color without a brand and code Estimated Provenance, and records the finish actually applied", async () => {
    await settled();
    await save(roomColor("Terracotta floor", { surface: "floor", color: "warm terracotta" }));
    await setState("terracotta-floor", "locked");

    const { receipt } = await fulfil("terracotta-floor", { finish: "oiled" });

    const floor = (await livingRoom()).room.surfaces.find((surface) => surface.part === "floor");
    expect(floor).toMatchObject({
      color: { name: "warm terracotta", provenance: "estimated" },
      finish: "oiled",
    });
    expect((await detail("terracotta-floor")).fulfilment).toMatchObject({ finish: "oiled" });
    expect(receipt).toContain("eggshell");
    expect(receipt).toContain("oiled");
  });

  it("paints only one Wall's Surface when the Room color names a Wall", async () => {
    await settled();
    await save(roomColor("Feature wall", { surface: "walls", wall: 2, color: "warm terracotta" }));
    await setState("feature-wall", "locked");

    await fulfil("feature-wall");

    const { room } = await livingRoom();
    expect(room.walls[1]?.surface).toMatchObject({
      slug: "living-room/wall-2/surface",
      color: { name: "warm terracotta", provenance: "estimated" },
      finish: "eggshell",
    });
    expect(room.surfaces.find((surface) => surface.part === "walls")?.color?.name).toBe("cream");
    expect((await detail("feature-wall")).fulfilment).toMatchObject({
      surface: "living-room/wall-2/surface",
    });
  });

  it.each(["candidate", "leaning"] as const)(
    "is refused for a %s Room color, changing nothing",
    async (state) => {
      await settled();
      await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
      if (state !== "candidate") await setState("plaster-walls", state);

      const error = await refusal(fulfil("plaster-walls"));

      expect(error.code).toBe("not_locked");
      const walls = (await livingRoom()).room.surfaces.find((surface) => surface.part === "walls");
      expect(walls?.color?.name).toBe("cream");
      expect((await detail("plaster-walls")).fulfilledAt).toBeUndefined();
    },
  );

  it("refuses to replace a stronger color with a weaker one, recording nothing, unless the user overrides", async () => {
    await settled();
    await core.run("save_room", agent(session), {
      session,
      room: "living-room",
      name: "Living room",
      surfaces: { walls: { color: { ...POINTING, role: undefined } as never } },
    });
    await save(roomColor("Terracotta walls", { surface: "walls", color: "warm terracotta" }));
    await setState("terracotta-walls", "locked");

    const error = await refusal(fulfil("terracotta-walls"));

    expect(error.code).toBe("weaker_provenance");
    expect(error.message).toContain("~warm terracotta (Estimated)");
    expect(error.message).toContain("Pointing (Farrow & Ball No. 2003) (Measured)");
    expect(error.message).toContain("overrideProvenance");
    expect((await detail("terracotta-walls")).fulfilledAt).toBeUndefined();
    const before = (await livingRoom()).room.surfaces.find((surface) => surface.part === "walls");
    expect(before?.color?.name).toBe("Pointing");

    const { receipt } = await fulfil("terracotta-walls", {
      overrideProvenance: 'The user: "we painted over it, it is the terracotta now"',
    });

    const after = (await livingRoom()).room.surfaces.find((surface) => surface.part === "walls");
    expect(after?.color).toEqual({ name: "warm terracotta", provenance: "estimated" });
    expect(receipt).toContain("as the user said");
    expect((await detail("terracotta-walls")).fulfilledAt).toEqual(expect.any(String));
  });

  it("is refused a second time", async () => {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
    await setState("plaster-walls", "locked");
    await fulfil("plaster-walls");

    const error = await refusal(fulfil("plaster-walls"));

    expect(error.code).toBe("validation");
    expect(error.message).toContain("already Fulfilled");
  });

  it("takes finish only for a Room color and roomFunctions only for a Room use", async () => {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
    await setState("plaster-walls", "locked");
    await save({
      kind: "room-use",
      room: "spare-room",
      title: "Office",
      statement: "An office.",
      content: { functions: ["office"] },
    });
    await setState("office", "locked");

    const functions = await refusal(
      core.run("record_fulfilment", agent(session), {
        session,
        decision: "plaster-walls",
        roomFunctions: ["living"],
      }),
    );
    const finish = await refusal(fulfil("office", { finish: "matt" }));

    expect([functions.code, finish.code]).toEqual(["validation", "validation"]);
    expect((await detail("plaster-walls")).fulfilledAt).toBeUndefined();
    expect((await detail("office")).fulfilledAt).toBeUndefined();
  });

  it("publishes the Decision and the Surface on the event bus", async () => {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
    await setState("plaster-walls", "locked");
    const events: ChangeEvent[] = [];
    const stop = core.subscribe((event) => events.push(event));

    await fulfil("plaster-walls");
    stop();

    expect(events).toEqual(
      expect.arrayContaining([
        { home, recordKind: "decision", recordSlug: "plaster-walls" },
        { home, recordKind: "surface", recordSlug: "living-room/walls" },
      ]),
    );
  });
});

describe("Palettes", () => {
  it("are one Locked at a time, while a second one can be a Candidate", async () => {
    await settled();
    await save(palette("Deep blues", [HAGUE_BLUE]));

    const error = await refusal(setState("deep-blues", "locked"));

    expect(error.code).toBe("illegal_transition");
    expect(error.message).toContain("warm-clay");
    expect((await detail("deep-blues")).state).toBe("candidate");
    expect((await detail("warm-clay")).state).toBe("locked");
  });

  it("carry their colors in list_decisions, for swatches", async () => {
    await settled();
    await save(roomColor("Plaster walls", { surface: "walls", color: "Setting Plaster" }));
    const { decisions } = await core.run("list_decisions", web, { home });
    expect(decisions.find((each) => each.slug === "warm-clay")?.colors).toEqual([
      SETTING_PLASTER,
      POINTING,
      TERRACOTTA,
    ]);
    expect(decisions.find((each) => each.slug === "plaster-walls")).not.toHaveProperty("colors");
    expect(await detail("warm-clay")).not.toHaveProperty("colors");
  });
});
