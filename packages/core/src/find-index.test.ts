// find_index, the web's search index (docs/handoff/generalized-search.md): every Room, Decision,
// Item, Listing, and Feature of the Home as one flat list of FindRows, which the browser matches.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CallContext, createCore } from "./core.js";
import { createFixtureHome, type FixtureHome } from "./fixture/fixture-home.js";
import type { FindRow } from "./operations/find-index.js";

const web: CallContext = { caller: { kind: "web" } };

let fixture: FixtureHome;
// A clock that ticks a second on every read, so each write lands at its own time.
let tick = 0;
beforeAll(async () => {
  fixture = await createFixtureHome({
    random: (max) => tick % max,
    clock: () => new Date(Date.UTC(2026, 8, 14, 10, 0, tick++)),
  });
});
afterAll(() => fixture.core.close());

const index = () => fixture.core.run("find_index", web, { home: fixture.home });

async function row(kind: FindRow["kind"], slug: string): Promise<FindRow> {
  const found = (await index()).find((each) => each.kind === kind && each.slug === slug);
  if (!found) throw new Error(`No ${kind} ${slug} in the index`);
  return found;
}

describe("find_index", () => {
  it("is the whole fixture Home's index", async () => {
    await expect(`${JSON.stringify(await index(), null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/find_index.json",
    );
  });

  it("has every findable kind, each with its tier and label, and nothing else", async () => {
    const rows = await index();
    const kinds = new Map(rows.map((each) => [each.kind, [each.tier, each.label]]));
    expect(Object.fromEntries(kinds)).toEqual({
      room: [1, "Room"],
      decision: [1, "Decision"],
      item: [1, "Item"],
      listing: [2, "Listing"],
      feature: [2, "Feature"],
    });
    const count = (kind: FindRow["kind"]) => rows.filter((each) => each.kind === kind).length;
    expect([count("room"), count("decision"), count("item"), count("listing")]).toEqual([
      5, 10, 9, 3,
    ]);
    expect(count("feature")).toBe(8);
  });

  it("names a Room's Level when the Home has more than one, and nothing when it has one", async () => {
    expect(await row("room", "main-bedroom")).toMatchObject({
      name: "Main bedroom",
      where: "First",
      path: "/homes/fixture-home/rooms/main-bedroom",
    });

    const core = createCore();
    const { home } = await core.run("create_home", web, {
      name: "My flat",
      country: "GB",
      city: "London",
    });
    const { session } = await core.run(
      "open_session",
      { caller: { kind: "session" }, home: home.slug },
      { skill: "home-intake" },
    );
    await core.run(
      "save_room",
      { caller: { kind: "session", session }, home: home.slug },
      { session, name: "Kitchen" },
    );
    const rows = await core.run("find_index", web, { home: home.slug });
    expect(rows.map((each) => [each.name, each.where])).toEqual([["Kitchen", ""]]);
    core.close();
  });

  it("reads an Unplaced Item as Unplaced, and opens every Item on the Items page", async () => {
    expect(await row("item", "standing-desk")).toMatchObject({
      name: "Standing desk",
      where: "Unplaced",
      path: "/homes/fixture-home/items",
    });
    expect((await row("item", "sofa")).where).toBe("Living room");
  });

  it("reads a Decision without a Room as Home-wide, and one with a Room by its name", async () => {
    expect(await row("decision", "warm-minimalism")).toMatchObject({
      name: "Warm minimalism",
      where: "Home-wide",
      path: "/homes/fixture-home/decisions/warm-minimalism",
      state: "Locked",
    });
    expect((await row("decision", "calm-evenings")).where).toBe("Living room");
  });

  it("places a Listing by its Decision's Room and title, and opens it at the Listings", async () => {
    expect(await row("listing", "hay-plain-rug")).toEqual(
      expect.objectContaining({
        name: "Hay Plain rug",
        where: "Living room › Wool rug",
        path: "/homes/fixture-home/decisions/wool-rug#listings",
        retired: false,
      }),
    );
    // Held keeps it findable and not retired: it is kept for reference.
    expect(await row("listing", "nordic-story-wool-rug")).toMatchObject({
      state: "Held",
      retired: false,
    });
  });

  it("builds a Feature's name from its kind and its description", async () => {
    expect(await row("feature", "living-room-fireplace")).toMatchObject({
      name: "Fireplace — cast iron, not working",
      where: "Living room",
      path: "/homes/fixture-home/rooms/living-room",
    });
    expect((await row("feature", "living-room-radiator")).name).toBe("Radiator");
  });

  it("keeps Rejected and Archived records, retired and with their state", async () => {
    expect(await row("decision", "paint-the-hallway-dark-green")).toMatchObject({
      state: "Rejected",
      retired: true,
    });
    expect(await row("item", "old-armchair")).toMatchObject({ state: "Archived", retired: true });
    expect(await row("decision", "oak-bookcase")).toMatchObject({
      state: "Fulfilled",
      retired: false,
    });
    const candidate = await row("decision", "books-by-color");
    expect(candidate.retired).toBe(false);
    expect(candidate).not.toHaveProperty("state");
  });

  it("gives a Decision with Guides a Quick Guide side link, and one without none", async () => {
    expect((await row("decision", "wool-rug")).also).toEqual({
      label: "Quick Guide",
      path: "/homes/fixture-home/decisions/wool-rug#quick-guide",
    });
    expect(await row("decision", "calm-evenings")).not.toHaveProperty("also");
    // A Purchase with no Guides saved.
    expect(await row("decision", "oak-bookcase")).not.toHaveProperty("also");
  });

  it("moves changedAt when the record is written, and only that record's", async () => {
    const before = await index();
    const at = (rows: FindRow[], kind: FindRow["kind"], slug: string) =>
      rows.find((each) => each.kind === kind && each.slug === slug)?.changedAt;

    const { session } = await fixture.core.run(
      "open_session",
      { caller: { kind: "session" }, home: fixture.home },
      { skill: "home-intake" },
    );
    await fixture.core.run(
      "save_items",
      { caller: { kind: "session", session }, home: fixture.home },
      { session, items: [{ item: "sofa", positionNote: "under the window" }] },
    );
    await fixture.core.run("hold_listing", web, {
      home: fixture.home,
      listing: "hay-plain-rug",
      held: { reason: "out-of-stock" },
    });
    const after = await index();

    const sofa = at(after, "item", "sofa") ?? "";
    expect(sofa > (at(before, "item", "sofa") ?? "")).toBe(true);
    // A Listing is logged on its Decision; the change moves both.
    const listing = at(after, "listing", "hay-plain-rug") ?? "";
    expect(listing > sofa).toBe(true);
    expect(at(after, "decision", "wool-rug")).toBe(listing);
    expect(at(after, "item", "double-bed")).toBe(at(before, "item", "double-bed"));
    expect(at(after, "listing", "jute-loop-rug")).toBe(at(before, "listing", "jute-loop-rug"));
  });

  it("writes nothing, and is not a tool of the Agent", async () => {
    const operation = fixture.core.operations.find((each) => each.name === "find_index");
    expect(operation).toMatchObject({ readOnly: true, surface: "web" });
    expect(operation?.text).toBeUndefined();
    const log = async () =>
      (await fixture.core.run("get_change_log", web, { home: fixture.home, limit: 1000 })).changes;
    const changes = await log();
    await index();
    expect(await log()).toEqual(changes);
  });
});
