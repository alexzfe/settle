// The server-enforced rules of the Home model (slice 2), written before their implementation.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CallContext,
  type Core,
  createCore,
  type OperationInput,
  type OperationName,
} from "./core.js";
import { CoreError } from "./errors.js";
import type { Measurement } from "./operations/schemas.js";

const web: CallContext = { caller: { kind: "web" } };
const agent = (home: string, session?: string): CallContext => ({
  caller: { kind: "session", session },
  home,
});

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

const measured = (mm: number): Measurement => ({ mm, provenance: "measured" });
const blueprint = (mm: number): Measurement => ({
  mm,
  provenance: "blueprint",
  source: { blueprint: "agent-plan", page: 1, printed: `${mm / 1000}` },
});
const estimated = (mm: number): Measurement => ({ mm, provenance: "estimated" });

let core: Core;
beforeEach(() => {
  core = createCore({ clock: () => new Date("2026-09-14T10:00:00.000Z") });
});
afterEach(() => core.close());

type Input<N extends OperationName> = Omit<OperationInput<N>, "session">;

/** A new Home with an open Session, and its writes and web reads bound to both. */
async function setUp(name = "My flat") {
  const { home } = await core.run("create_home", web, { name, country: "GB", city: "London" });
  const { session } = await core.run("open_session", agent(home.slug), { skill: "home-intake" });
  const context = agent(home.slug, session);
  return {
    home: home.slug,
    session,
    saveHome: (input: Input<"save_home">) => core.run("save_home", context, { session, ...input }),
    saveRoom: (input: Input<"save_room">) => core.run("save_room", context, { session, ...input }),
    saveItems: (input: Input<"save_items">) =>
      core.run("save_items", context, { session, ...input }),
    setConstraints: (input: Input<"set_constraints">) =>
      core.run("set_constraints", context, { session, ...input }),
    findItems: (input: Input<"find_items">) =>
      core.run("find_items", context, { session, ...input }),
    room: async (room: string) => (await core.run("get_room", web, { home: home.slug, room })).room,
    getHome: () => core.run("get_home", web, { home: home.slug }),
  };
}

describe("the Provenance rule", () => {
  it("refuses a weaker value, stating both values and their Provenance, and keeps the stronger", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Living room", ceilingHeight: measured(2600) });

    const error = await refusal(
      my.saveRoom({ room: "living-room", name: "Living room", ceilingHeight: estimated(2400) }),
    );

    expect(error.code).toBe("weaker_provenance");
    expect(error.message).toContain("~2.40 m (Estimated)");
    expect(error.message).toContain("2.60 m (Measured)");
    expect(error.message).toContain("overrideProvenance");
    expect((await my.room("living-room")).ceilingHeight).toEqual(measured(2600));
  });

  it("orders Provenance measured > blueprint > estimated", async () => {
    const my = await setUp();
    const cases: [Measurement, Measurement, boolean][] = [
      [estimated(3000), blueprint(3100), true],
      [blueprint(3000), measured(3100), true],
      [estimated(3000), measured(3100), true],
      [measured(3000), measured(3100), true],
      [estimated(3000), estimated(3100), true],
      [measured(3000), blueprint(3100), false],
      [blueprint(3000), estimated(3100), false],
      [measured(3000), estimated(3100), false],
    ];
    for (const [index, [first, second, accepted]] of cases.entries()) {
      const name = `Room ${index + 1}`;
      await my.saveRoom({ name, walls: [{ position: 1, length: first }] });
      const save = my.saveRoom({
        room: `room-${index + 1}`,
        name,
        walls: [{ position: 1, length: second }],
      });
      if (accepted) await save;
      else expect((await refusal(save)).code).toBe("weaker_provenance");
      const wall = (await my.room(`room-${index + 1}`)).walls[0];
      expect(wall?.length, `${first.provenance} then ${second.provenance}`).toEqual(
        accepted ? second : first,
      );
    }
  });

  it("saves the rest of a write and lists the refused part in its receipt", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Kitchen", ceilingHeight: measured(2500) });

    const { receipt } = await my.saveRoom({
      room: "kitchen",
      name: "Kitchen",
      ceilingHeight: estimated(2400),
      timesOfUse: ["morning"],
    });

    expect(receipt).toMatch(/^Refused: .*~2\.40 m \(Estimated\).*2\.50 m \(Measured\)/m);
    const kitchen = await my.room("kitchen");
    expect(kitchen.timesOfUse).toEqual(["morning"]);
    expect(kitchen.ceilingHeight).toEqual(measured(2500));
  });

  it("keeps the stronger Provenance when a weaker source repeats the same value", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Kitchen", ceilingHeight: measured(2500) });
    await my.saveRoom({ room: "kitchen", name: "Kitchen", ceilingHeight: estimated(2500) });
    expect((await my.room("kitchen")).ceilingHeight).toEqual(measured(2500));
  });

  it("accepts a weaker value with overrideProvenance, and logs the user's words", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Kitchen", ceilingHeight: measured(2600) });
    const reason = 'The user: "I misread the tape, use about 2.45"';

    const { receipt } = await my.saveRoom({
      room: "kitchen",
      name: "Kitchen",
      ceilingHeight: estimated(2450),
      overrideProvenance: reason,
    });

    expect(receipt).toContain("~2.45 m (Estimated)");
    expect((await my.room("kitchen")).ceilingHeight).toEqual(estimated(2450));
    const { changes } = await core.run("get_change_log", web, { home: my.home });
    expect(changes.find((change) => change.field === "ceilingHeight" && change.reason)).toEqual(
      expect.objectContaining({ record: "kitchen", reason }),
    );
  });

  it("refuses an empty override reason", async () => {
    const my = await setUp();
    const error = await refusal(
      my.saveRoom({ name: "Kitchen", ceilingHeight: estimated(2450), overrideProvenance: " " }),
    );
    expect(error.code).toBe("validation");
  });

  it("applies to colors, to the Home's facts, and to Items", async () => {
    const my = await setUp();
    await my.saveRoom({
      name: "Hallway",
      surfaces: {
        walls: {
          color: {
            name: "Setting Plaster",
            brand: "Farrow & Ball",
            code: "No. 231",
            provenance: "measured",
          },
        },
      },
    });
    await my.saveHome({ accessWidth: measured(760) });
    await my.saveItems({ items: [{ name: "Sofa", category: "seating", width: measured(2100) }] });

    const color = await refusal(
      my.saveRoom({
        room: "hallway",
        name: "Hallway",
        surfaces: { walls: { color: { name: "pinkish beige", provenance: "estimated" } } },
      }),
    );
    const access = await refusal(my.saveHome({ accessWidth: estimated(800) }));
    const item = await refusal(my.saveItems({ items: [{ item: "sofa", width: estimated(2000) }] }));

    expect([color.code, access.code, item.code]).toEqual([
      "weaker_provenance",
      "weaker_provenance",
      "weaker_provenance",
    ]);
    expect(color.message).toContain("Setting Plaster");
    expect(access.message).toContain("0.76 m (Measured)");
    expect(item.message).toContain("2.10 m (Measured)");
  });
});

describe("Archiving, not deleting", () => {
  it("removing a Constraint Archives it: it leaves the Overview but stays listed", async () => {
    const my = await setUp();
    await my.setConstraints({ add: ["Rented: no painting"] });
    await my.setConstraints({ remove: ["rented-no-painting"], reason: "The user: we bought it" });

    const active = await core.run("list_constraints", web, { home: my.home });
    const all = await core.run("list_constraints", web, { home: my.home, archived: true });
    const opening = await core.run("open_session", agent(my.home), { skill: "home-intake" });

    expect(active.constraints).toEqual([]);
    expect(all.constraints).toEqual([
      {
        slug: "rented-no-painting",
        text: "Rented: no painting",
        archivedAt: "2026-09-14T10:00:00.000Z",
        archivedReason: "The user: we bought it",
      },
    ]);
    expect(opening.opening).not.toContain("no painting");
  });

  it("archiving a Room keeps it and its slug, and a Door to it keeps working", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Hallway", walls: [{ position: 1 }] });
    await my.saveRoom({
      name: "Study",
      walls: [{ position: 1 }],
      doors: [{ wall: 1, otherRoom: "hallway" }],
    });

    await my.saveRoom({
      room: "study",
      name: "Study",
      archive: true,
      archiveReason: "Knocked through",
    });
    await my.saveRoom({ name: "Study" });

    const { rooms } = await my.getHome();
    expect(rooms.map((room) => room.slug)).toEqual(["hallway", "study-2"]);
    expect(await my.room("study")).toMatchObject({
      slug: "study",
      archivedAt: "2026-09-14T10:00:00.000Z",
      archivedReason: "Knocked through",
    });
    expect((await my.room("hallway")).doors[0]?.otherRoom?.slug).toBe("study");
  });

  it("archiving an Item keeps it out of the Inventory; find_items finds it with archived", async () => {
    const my = await setUp();
    await my.saveItems({ items: [{ name: "Sofa", category: "seating" }] });
    await my.saveItems({ items: [{ item: "sofa", archive: true, archiveReason: "sold" }] });

    const { items } = await core.run("list_items", web, { home: my.home });
    const current = await my.findItems({});
    const archived = await my.findItems({ archived: true });

    expect(items).toEqual([]);
    expect(current.items).toEqual([]);
    expect(archived.items).toEqual([
      expect.objectContaining({ slug: "sofa", archivedReason: "sold" }),
    ]);
  });

  it("refuses to remove a Level a Room is on, and removes an empty one", async () => {
    const my = await setUp();
    await my.saveHome({
      levels: [
        { name: "First", storey: 1 },
        { name: "Loft", storey: 2 },
      ],
    });
    await my.saveRoom({ name: "Bedroom", level: "first" });

    const error = await refusal(my.saveHome({ levels: [{ level: "first", remove: true }] }));
    await my.saveHome({ levels: [{ level: "loft", remove: true }] });

    expect(error.code).toBe("referenced_cannot_delete");
    expect(error.message).toContain("Bedroom (bedroom)");
    expect((await my.getHome()).levels.map((level) => level.slug)).toEqual(["ground", "first"]);
  });

  it("refuses to archive a Room that still holds Items, naming them", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Den" });
    await my.saveItems({ items: [{ name: "Lamp", category: "lighting", room: "den" }] });

    const error = await refusal(my.saveRoom({ room: "den", name: "Den", archive: true }));

    expect(error.code).toBe("referenced_cannot_delete");
    expect(error.message).toContain("Lamp (lamp)");
    expect((await my.room("den")).archivedAt).toBeUndefined();
  });
});

describe("Door identity", () => {
  async function twoRoomsWithADoor() {
    const my = await setUp();
    await my.saveRoom({ name: "Hallway", walls: [{ position: 1 }, { position: 2 }] });
    await my.saveRoom({
      name: "Kitchen",
      walls: [{ position: 1 }],
      doors: [{ wall: 1, otherRoom: "hallway" }],
    });
    return my;
  }

  it("is one Door for two Rooms: saving it from the other Room updates it, and says so", async () => {
    const my = await twoRoomsWithADoor();

    const { receipt } = await my.saveRoom({
      room: "hallway",
      name: "Hallway",
      doors: [{ wall: 2, otherRoom: "kitchen", clearWidth: measured(760) }],
    });

    const kitchen = await my.room("kitchen");
    const hallway = await my.room("hallway");
    expect(receipt).toContain("updated the existing Door");
    expect(kitchen.doors).toHaveLength(1);
    expect(hallway.doors).toHaveLength(1);
    expect(hallway.doors[0]?.slug).toBe(kitchen.doors[0]?.slug);
    expect(hallway.doors[0]).toMatchObject({
      wall: "hallway/wall-2",
      otherRoom: { slug: "kitchen", name: "Kitchen" },
      otherWall: "kitchen/wall-1",
      clearWidth: measured(760),
    });
    expect(kitchen.doors[0]).toMatchObject({ wall: "kitchen/wall-1", otherWall: "hallway/wall-2" });
  });

  it("adds a second Door between the same Rooms only with newDoor, then needs its slug", async () => {
    const my = await twoRoomsWithADoor();
    await my.saveRoom({
      room: "kitchen",
      name: "Kitchen",
      doors: [{ wall: 1, otherRoom: "hallway", newDoor: true }],
    });
    const doors = (await my.room("kitchen")).doors.map((door) => door.slug);
    expect(doors).toHaveLength(2);

    const error = await refusal(
      my.saveRoom({
        room: "kitchen",
        name: "Kitchen",
        doors: [{ otherRoom: "hallway", glazed: true }],
      }),
    );
    await my.saveRoom({
      room: "kitchen",
      name: "Kitchen",
      doors: [{ door: doors[1], glazed: true }],
    });

    expect(error.code).toBe("validation");
    for (const slug of doors) expect(error.message).toContain(slug);
    expect((await my.room("hallway")).doors.map((door) => door.glazed)).toEqual([undefined, true]);
  });
});

describe("Home scoping of every write", () => {
  it("refuses every write from a Session of another Home, and writes nothing", async () => {
    const mine = await setUp("My flat");
    const other = await setUp("Holiday cottage");
    const writes: [string, Record<string, unknown>][] = [
      ["save_home", { tenure: "rented" }],
      ["save_room", { name: "Kitchen" }],
      ["save_items", { items: [{ name: "Sofa", category: "seating" }] }],
      ["set_constraints", { add: ["Two cats"] }],
      ["save_note", { text: "The cat scratches fabric furniture" }],
    ];
    for (const [name, input] of writes) {
      const error = await refusal(
        core.run(name, agent(mine.home, other.session), { session: other.session, ...input }),
      );
      expect(error.code, name).toBe("unknown_session");
    }
    for (const home of [mine.home, other.home]) {
      expect((await core.run("get_home", web, { home })).home.tenure).toBeUndefined();
      expect((await core.run("get_home", web, { home })).rooms).toEqual([]);
      expect((await core.run("list_items", web, { home })).items).toEqual([]);
      expect((await core.run("list_constraints", web, { home })).constraints).toEqual([]);
      expect((await core.run("list_notes", web, { home })).notes).toEqual([]);
    }
  });

  it("refuses a reference to another Home's records as not found", async () => {
    const mine = await setUp("My flat");
    const other = await setUp("Holiday cottage");
    await other.saveRoom({ name: "Garden", outdoor: true });
    await other.saveItems({ items: [{ name: "Deckchair", category: "outdoor", room: "garden" }] });
    await other.setConstraints({ add: ["Two cats"] });

    const refusals = await Promise.all([
      refusal(mine.saveRoom({ name: "Kitchen", walls: [{ position: 1, beyond: "garden" }] })),
      refusal(
        mine.saveRoom({
          name: "Kitchen",
          walls: [{ position: 1 }],
          doors: [{ wall: 1, otherRoom: "garden" }],
        }),
      ),
      refusal(mine.saveItems({ items: [{ name: "Chair", category: "seating", room: "garden" }] })),
      refusal(mine.saveItems({ items: [{ item: "deckchair", quantity: 2 }] })),
      refusal(mine.setConstraints({ remove: ["two-cats"] })),
      refusal(mine.findItems({ room: "garden" })),
    ]);

    expect(refusals.map((error) => error.code)).toEqual(Array(6).fill("not_found"));
    expect((await mine.getHome()).rooms).toEqual([]);
    expect(
      (await core.run("list_constraints", web, { home: other.home })).constraints,
    ).toHaveLength(1);
  });
});

describe("slugs of the Home model", () => {
  it("never change on a rename: Rooms, their Walls, Levels, and Items", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Study", walls: [{ position: 1 }] });
    await my.saveItems({ items: [{ name: "Sofa", category: "seating" }] });

    await my.saveRoom({ room: "study", name: "Office" });
    await my.saveHome({ levels: [{ level: "ground", name: "Street level" }] });
    await my.saveItems({ items: [{ item: "sofa", name: "Grey sofa" }] });

    const { rooms, levels } = await my.getHome();
    const { items } = await core.run("list_items", web, { home: my.home });
    expect(rooms).toEqual([{ slug: "study", name: "Office", level: "ground" }]);
    expect(levels).toEqual([{ slug: "ground", name: "Street level", storey: 0 }]);
    expect(items.map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "sofa", name: "Grey sofa" },
    ]);
    expect((await my.room("study")).walls.map((wall) => wall.slug)).toEqual(["study/wall-1"]);
  });
});

describe("Gaps", () => {
  const ALL_SURFACES = {
    walls: { materials: [{ material: "plaster" }] },
    ceiling: { materials: [{ material: "plaster" }] },
    floor: { materials: [{ material: "oak boards" }] },
    woodwork: { finish: "gloss" },
  };

  it("are everything on the enough-for-advice list for a new Room", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Bedroom" });
    expect((await my.room("bedroom")).gaps).toEqual([
      "wall lengths",
      "ceiling height",
      "Windows or windowless",
      "times of use",
      "walls Surface",
      "ceiling Surface",
      "floor Surface",
      "woodwork Surface",
    ]);
  });

  it("are none once everything advice needs is recorded", async () => {
    const my = await setUp();
    await my.saveRoom({
      name: "Bedroom",
      ceilingHeight: measured(2500),
      timesOfUse: ["night"],
      surfaces: ALL_SURFACES,
      walls: [1, 2, 3, 4].map((position) => ({
        position,
        length: measured(3000),
        ...(position === 1 ? { facing: "s" as const, beyond: "outside" } : {}),
      })),
      windows: [{ wall: 1 }],
    });
    expect((await my.room("bedroom")).gaps).toEqual([]);
  });

  it("name the Walls without a length, and the facing of Walls with Windows", async () => {
    const my = await setUp();
    await my.saveRoom({
      name: "Bedroom",
      walls: [{ position: 1, length: measured(3000) }, { position: 2 }],
      windows: [{ wall: 1 }],
    });
    const { gaps } = await my.room("bedroom");
    expect(gaps).toContain("wall lengths (bedroom/wall-2)");
    expect(gaps).toContain("facing of bedroom/wall-1");
    expect(gaps).not.toContain("Windows or windowless");
  });

  it("drop the Windows once the Room is marked windowless", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Box room", windowless: true });
    expect((await my.room("box-room")).gaps).not.toContain("Windows or windowless");
  });

  it("check an outdoor Room only for its floor Surface and times of use", async () => {
    const my = await setUp();
    await my.saveRoom({ name: "Balcony", outdoor: true });
    expect((await my.room("balcony")).gaps).toEqual(["times of use", "floor Surface"]);
    await my.saveRoom({
      room: "balcony",
      name: "Balcony",
      surfaces: { floor: { materials: [{ material: "tiles" }] } },
    });
    expect((await my.room("balcony")).gaps).toEqual(["times of use"]);
  });

  it("end the receipt, for the touched Room", async () => {
    const my = await setUp();
    const { receipt } = await my.saveRoom({ name: "Balcony", outdoor: true });
    expect(receipt.split("\n").at(-1)).toBe(
      "Gaps left in Balcony (balcony): times of use, floor Surface",
    );
    const done = await my.saveRoom({
      room: "balcony",
      name: "Balcony",
      timesOfUse: ["evening"],
      surfaces: { floor: { materials: [{ material: "tiles" }] } },
    });
    expect(done.receipt.split("\n").at(-1)).toBe("Balcony (balcony): no Gaps left");
  });
});
