// The Item page's rules (docs/handoff/item-page.md): the register migration, Listed as a fourth
// Provenance that only an Item takes, register dates, the pencil (edit_item) as the same write as
// the Agent's, a Fulfilment that fills the register from the Listing bought, the bought Listing
// kept from drop_listing, get_item's page, and the register in find_items but not the Room Sheet.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import { createFixtureHome, type FixtureHome } from "./fixture/fixture-home.js";
import { migrate } from "./migrate.js";
import type { Item, Measurement } from "./operations/schemas.js";
import { openStore } from "./store.js";

const web: CallContext = { caller: { kind: "web" } };
const measured = (mm: number) => ({ mm, provenance: "measured" as const });
const listed = (mm: number): Measurement => ({ mm, provenance: "listed" });
const estimated = (mm: number) => ({ mm, provenance: "estimated" as const });

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

describe("migration 0012, the Item register", () => {
  const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "settle-core-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps every Item and its values, renames price to price_paid, and leaves the change log alone", () => {
    const path = join(dir, "test.sqlite");
    const early = new DatabaseSync(path);
    early.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(MIGRATIONS)
      .filter((each) => each < "0012")
      .sort()) {
      early.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
      early
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, '')")
        .run(Number(file.slice(0, 4)));
    }
    early.exec(
      `INSERT INTO homes (id, slug, name, country, city, latitude)
         VALUES (1, 'my-flat', 'My flat', 'GB', 'London', 51.5);
       INSERT INTO items (id, home_id, slug, name, category, width_mm, width_prov, colors, price,
           archived_at, archived_reason)
         VALUES (1, 1, 'billy', 'Billy', 'storage', 800, 'estimated',
           '[{"name":"white","provenance":"measured"}]', '£60', '2026-09-14', 'replaced');
       INSERT INTO items (id, home_id, slug, name, category, quantity, brand, model)
         VALUES (2, 1, 'oak-bookcase', 'Oak bookcase', 'storage', 2, 'Hay', 'Oak');
       UPDATE items SET replaced_by_item_id = 2 WHERE id = 1;
       INSERT INTO change_log (home_id, at, origin, record_kind, record_id, record_slug, field, old, new)
         VALUES (1, '2026-09-14', 'web', 'item', 1, 'billy', 'price', NULL, '"£60"');`,
    );
    const before = early.prepare("SELECT * FROM items ORDER BY id").all();
    const log = early.prepare("SELECT * FROM change_log").all();
    early.close();

    const db = migrate(path);
    const after = db.prepare("SELECT * FROM items ORDER BY id").all();
    expect(after).toHaveLength(2);
    for (const [index, row] of before.entries()) {
      const { price, ...rest } = row;
      expect(after[index]).toMatchObject({ ...rest, price_paid: price });
      expect(after[index]).not.toHaveProperty("price");
      expect(after[index]).toMatchObject({
        bought_on: null,
        bought_from: null,
        warranty_until: null,
        serial_number: null,
        manual_link: null,
        listed_fields: null,
      });
    }
    expect(after[0]?.replaced_by_item_id).toBe(2);
    expect(db.prepare("SELECT * FROM change_log").all()).toEqual(log);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // Listed is an Item's alone: its sizes take it, the building's never do.
    db.exec("UPDATE items SET width_prov = 'listed' WHERE id = 2");
    db.exec(
      "INSERT INTO levels (id, home_id, slug, name, storey) VALUES (1, 1, 'ground', 'Ground', 0)",
    );
    db.exec(
      "INSERT INTO rooms (id, home_id, level_id, slug, name) VALUES (1, 1, 1, 'kitchen', 'Kitchen')",
    );
    expect(() =>
      db.exec(
        `INSERT INTO walls (home_id, room_id, slug, position, length_mm, length_prov, beyond_kind)
         VALUES (1, 1, 'kitchen/wall-1', 1, 3000, 'listed', 'unknown')`,
      ),
    ).toThrow(/CHECK/);
    db.close();
  });
});

/** A Home with a Bedroom, a Measured mattress, and a Purchase whose Requirements cite it. */
describe("a Home with a mattress and a bed-frame Purchase", () => {
  let core: Core;
  let home: string;
  let session: string;
  const agent = (): CallContext => ({ caller: { kind: "session", session }, home });
  const saveItems = (items: OperationInput<"save_items">["items"], override?: string) =>
    core.run("save_items", agent(), {
      session,
      items,
      ...(override ? { overrideProvenance: override } : {}),
    });
  const mattress = async (): Promise<Item> => {
    const { items } = await core.run("list_items", web, { home, archived: true });
    const found = items.find((each) => each.slug === "mattress");
    if (!found) throw new Error("no mattress");
    return found;
  };
  const edit = (fields: OperationInput<"edit_item">["fields"]) =>
    core.run("edit_item", web, { home, item: "mattress", fields });
  const flags = async () =>
    (await core.run("get_decision", web, { home, decision: "bed-frame" })).decision.flags;

  beforeEach(async () => {
    core = createCore();
    home = (await core.run("create_home", web, { name: "My flat", country: "PE", city: "Lima" }))
      .home.slug;
    session = (
      await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "purchase" })
    ).session;
    await core.run("save_room", agent(), {
      session,
      name: "Bedroom",
      walls: [{ position: 1, length: measured(3200) }, { position: 2 }],
    });
    await saveItems([
      {
        name: "Mattress",
        category: "beds",
        room: "bedroom",
        width: measured(1530),
        depth: measured(2030),
      },
    ]);
    await core.run("save_decision", agent(), {
      session,
      kind: "purchase",
      room: "bedroom",
      title: "Bed frame",
      statement: "A bed frame for the queen mattress.",
      requirements: [
        // As the real bed frame's are: the mattress, naming no field.
        {
          text: "Fits a 153 × 203 cm mattress",
          strength: "must",
          reason: { kind: "item", id: "mattress" },
        },
        {
          text: "Slats at most 7 cm apart",
          strength: "must",
          reason: { kind: "item", id: "mattress" },
        },
      ],
    });
  });
  afterEach(() => core.close());

  describe("Listed Provenance", () => {
    it("is refused on a Wall's length, saying it belongs to an Item, and taken on an Item's width", async () => {
      const wall = await refusal(
        core.run("save_room", agent(), {
          session,
          name: "Bedroom",
          walls: [{ position: 2, length: listed(2800) as never }],
        }),
      );
      expect(wall.code).toBe("validation");
      expect(wall.message).toContain("listed is only for an Item's sizes and colors");

      const receipt = (await saveItems([{ item: "mattress", height: listed(260) }])).receipt;
      expect(receipt).toContain("height *0.26 m (Listed)");
      expect((await mattress()).height).toEqual(listed(260));
    });

    it("is not replaced by an Estimated value without overrideProvenance, and never replaces a Measured one", async () => {
      await saveItems([{ item: "mattress", height: listed(260) }]);
      const weaker = await refusal(saveItems([{ item: "mattress", height: estimated(250) }]));
      expect(weaker.code).toBe("weaker_provenance");
      expect((await mattress()).height).toEqual(listed(260));

      const overMeasured = await refusal(saveItems([{ item: "mattress", width: listed(1500) }]));
      expect(overMeasured.code).toBe("weaker_provenance");
      expect((await mattress()).width).toEqual(measured(1530));

      await saveItems([{ item: "mattress", height: estimated(250) }], 'The user: "it is 25 cm"');
      expect((await mattress()).height).toEqual(estimated(250));
    });
  });

  describe("the register through save_items", () => {
    it("records the six fields, and takes a date as a year, a month, or a day", async () => {
      await saveItems([
        {
          item: "mattress",
          boughtOn: "2024",
          boughtFrom: "Drimer",
          pricePaid: "S/ 2,899",
          warrantyUntil: "2034-03",
          serialNumber: "PA-0042",
          manualLink: "https://drimer.pe/garantia",
        },
      ]);
      expect(await mattress()).toMatchObject({
        boughtOn: "2024",
        boughtFrom: "Drimer",
        pricePaid: "S/ 2,899",
        warrantyUntil: "2034-03",
        serialNumber: "PA-0042",
        manualLink: "https://drimer.pe/garantia",
      });
      await saveItems([{ item: "mattress", boughtOn: "2024-03-14" }]);
      expect((await mattress()).boughtOn).toBe("2024-03-14");
    });

    it("refuses a malformed date, saying what a date looks like, and records nothing", async () => {
      for (const date of ["March 2024", "24-03", "2024-13", "2024-02-30", "2024-3"]) {
        const error = await refusal(saveItems([{ item: "mattress", boughtOn: date }]));
        expect(error.code).toBe("validation");
        expect(error.message).toContain('"2024", "2024-03", or "2024-03-14"');
      }
      const web = await refusal(edit({ warrantyUntil: "next March" }));
      expect(web.message).toContain('"2024", "2024-03", or "2024-03-14"');
      expect(await mattress()).not.toHaveProperty("boughtOn");
      expect(await mattress()).not.toHaveProperty("warrantyUntil");
    });
  });

  describe("edit_item, the pencil", () => {
    it("replaces a Measured width with an Estimated one, logs it from the web, and flags the Purchase citing the mattress", async () => {
      const { receipt } = await edit({ width: estimated(1500) });
      expect((await mattress()).width).toEqual(estimated(1500));
      expect(receipt).toContain("replacing 1.53 m (Measured) as the user said");

      const { changes } = await core.run("get_change_log", web, { home });
      expect(changes.find((change) => change.recordKind === "item")).toMatchObject({
        origin: "web",
        recordKind: "item",
        record: "mattress",
        field: "width",
        old: measured(1530),
        new: estimated(1500),
        reason: "edited by the user on the web",
      });
      // The real bed frame's Requirements name no field: any change to the mattress's
      // record, its size included, flags the Purchase, once while the flag stays open.
      expect(receipt).toContain("Flagged for review: Bed frame (bed-frame)");
      const [flag, ...others] = await flags();
      expect(others).toEqual([]);
      expect(flag).toMatchObject({
        cause: "value_changed",
        source: { kind: "item", slug: "mattress" },
      });
      expect(flag).not.toHaveProperty("clearedAt");
    });

    it("raises the same flag an Agent edit would, and none for a register fact alone", async () => {
      await edit({ warrantyUntil: "2034", serialNumber: "PA-0042", pricePaid: "S/ 2,899" });
      expect(await flags()).toEqual([]);

      const { receipt } = await saveItems([{ item: "mattress", depth: measured(2000) }]);
      expect(receipt).toContain("Flagged for review: Bed frame (bed-frame)");
      expect((await flags()).map((flag) => flag.source.slug)).toEqual(["mattress"]);
    });

    it("clears a field given as null, and leaves one left out alone", async () => {
      await saveItems([{ item: "mattress", brand: "Drimer", model: "Pocket Aero" }]);
      await edit({ brand: null, depth: null });
      const after = await mattress();
      expect(after).not.toHaveProperty("brand");
      expect(after).not.toHaveProperty("depth");
      expect(after.model).toBe("Pocket Aero");
      expect(after.width).toEqual(measured(1530));
    });

    it("refuses the name, the Room, and archiving, which are Session work, and a Listed size", async () => {
      for (const fields of [{ name: "Queen mattress" }, { room: "bedroom" }, { archive: true }]) {
        const error = await refusal(edit(fields as never));
        expect(error.code).toBe("validation");
        expect(error.message).toContain("can't be edited on the page");
        expect(error.message).toContain("done in a Session");
      }
      const size = await refusal(edit({ width: listed(1500) as never }));
      expect(size.message).toContain("measured or estimated");
      expect((await mattress()).name).toBe("Mattress");
    });

    it("publishes the Item's change, as every write does", async () => {
      const heard: string[] = [];
      const stop = core.subscribe((event) => heard.push(`${event.recordKind} ${event.recordSlug}`));
      await edit({ serialNumber: "PA-0042" });
      stop();
      expect(heard).toEqual(["item mattress"]);
    });
  });

  describe("record_fulfilment with the Listing bought", () => {
    const record = (input: Partial<OperationInput<"record_listing">>) =>
      core.run("record_listing", agent(), {
        session,
        decision: "bed-frame",
        name: "Cama Roma",
        checks: [
          { requirement: 1, result: "pass" },
          { requirement: 2, result: "pass" },
        ],
        ...input,
      } as OperationInput<"record_listing">);
    const fulfil = (input: Partial<OperationInput<"record_fulfilment">>) =>
      core.run("record_fulfilment", agent(), {
        session,
        decision: "bed-frame",
        bought: "Cama Roma, queen",
        ...input,
      });
    const frame = async () => (await core.run("get_item", web, { home, item: "cama-roma" })).item;

    beforeEach(async () => {
      await record({ url: "https://www.falabella.com.pe/cama-roma", price: "S/ 1,299" });
      await core.run("set_decision_state", agent(), {
        session,
        decision: "bed-frame",
        to: "locked",
        reason: 'The user: "bought it"',
      });
    });

    it("fills bought on, bought from, price paid, and link, tagging all but the day Listed", async () => {
      await fulfil({
        listing: "cama-roma",
        item: { name: "Cama Roma", category: "beds", width: listed(1600) },
      });
      const item = await frame();
      expect(item).toMatchObject({
        boughtOn: new Date().toISOString().slice(0, 10),
        boughtFrom: "falabella.com.pe",
        pricePaid: "S/ 1,299",
        link: "https://www.falabella.com.pe/cama-roma",
        width: listed(1600),
      });
      expect(item.listed).toEqual(["boughtFrom", "pricePaid", "link"]);
      const { decision } = await core.run("get_decision", web, { home, decision: "bed-frame" });
      expect(decision.fulfilment).toMatchObject({ item: "cama-roma", listing: "cama-roma" });

      // A value changed afterwards is no longer the Listing's.
      await saveItems([{ item: "cama-roma", boughtFrom: "Falabella Miraflores" }]);
      expect((await frame()).listed).toEqual(["pricePaid", "link"]);
      await core.run("edit_item", web, {
        home,
        item: "cama-roma",
        fields: { pricePaid: "S/ 1,199", link: "https://www.falabella.com.pe/cama-roma" },
      });
      expect((await frame()).listed).toEqual(["link"]);
    });

    it("lets what the Agent gives win, untagged", async () => {
      await fulfil({
        listing: "cama-roma",
        item: { name: "Cama Roma", category: "beds", pricePaid: "S/ 1,150", boughtOn: "2026-09" },
      });
      const item = await frame();
      expect(item).toMatchObject({ pricePaid: "S/ 1,150", boughtOn: "2026-09" });
      expect(item.listed).toEqual(["boughtFrom", "link"]);
    });

    it("refuses a Listing that is not this Purchase's, and records nothing", async () => {
      await core.run("save_decision", agent(), {
        session,
        kind: "purchase",
        room: "bedroom",
        title: "Bedside lamp",
        statement: "A lamp.",
        requirements: [
          { text: "Warm light", strength: "prefer", reason: { kind: "room", id: "bedroom" } },
        ],
      });
      await core.run("record_listing", agent(), {
        session,
        decision: "bedside-lamp",
        name: "Paper lamp",
        checks: [{ requirement: 1, result: "pass" }],
      });
      const theirs = await refusal(
        fulfil({ listing: "paper-lamp", item: { name: "Cama Roma", category: "beds" } }),
      );
      expect(theirs.message).toContain("belongs to Bedside lamp (bedside-lamp)");
      expect(theirs.message).toContain("Listings are cama-roma");
      const unknown = await refusal(fulfil({ listing: "no-such-bed" }));
      expect(unknown.code).toBe("not_found");
      const { decision } = await core.run("get_decision", web, { home, decision: "bed-frame" });
      expect(decision).not.toHaveProperty("fulfilledAt");
    });

    it("keeps the Listing bought from drop_listing, naming the Purchase", async () => {
      await record({ name: "Cama Lisboa" });
      await fulfil({ listing: "cama-roma", item: { name: "Cama Roma", category: "beds" } });
      const error = await refusal(core.run("drop_listing", web, { home, listing: "cama-roma" }));
      expect(error.code).toBe("referenced_cannot_delete");
      expect(error.message).toContain("Bed frame (bed-frame)");
      // Any other Listing of it can still go.
      await core.run("drop_listing", web, { home, listing: "cama-lisboa" });
    });
  });
});

describe("get_item and the Agent's text, on the fixture Home", () => {
  let fixture: FixtureHome;
  let tick = 0;
  beforeAll(async () => {
    fixture = await createFixtureHome({
      clock: () => new Date(Date.UTC(2026, 8, 14, 10, 0, tick++)),
      fetchImage: async () => {
        throw new Error("no network in tests");
      },
    });
  });
  afterAll(() => fixture.core.close());
  const page = (item: string) => fixture.core.run("get_item", web, { home: fixture.home, item });

  it("shows the Billy with the Purchase relying on it and the one that replaced it", async () => {
    const billy = await page("bookcase");
    expect(billy.item).toMatchObject({ slug: "bookcase", archivedReason: expect.any(String) });
    expect(billy.replacedBy).toEqual({ slug: "oak-bookcase", name: "Oak bookcase" });
    expect(billy).not.toHaveProperty("replaces");
    expect(billy.decisions).toEqual([
      {
        relation: "relies-on",
        slug: "oak-bookcase",
        title: "Oak bookcase",
        state: "locked",
        fulfilled: true,
        archived: false,
        requirements: [
          {
            position: 1,
            text: "At most 80 cm wide, to stand where the Billy stands",
            strength: "must",
            field: "width",
          },
        ],
      },
      {
        relation: "replaced-by",
        slug: "oak-bookcase",
        title: "Oak bookcase",
        state: "locked",
        fulfilled: true,
        archived: false,
      },
    ]);
  });

  it("shows the Oak bookcase bought by its Purchase, what it replaced, and its register", async () => {
    const oak = await page("oak-bookcase");
    expect(oak.replaces).toEqual([{ slug: "bookcase", name: "Bookcase" }]);
    expect(oak.decisions.map((each) => [each.relation, each.slug])).toEqual([
      ["bought-by", "oak-bookcase"],
    ]);
    expect(oak.item).toMatchObject({
      boughtFrom: "example.com",
      pricePaid: "£620",
      link: "https://www.example.com/solid-oak-bookcase",
      listed: ["boughtFrom", "link"],
    });
    // No picture until the platform holds the Listing's bytes.
    expect(oak).not.toHaveProperty("picture");
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { listing } = await fixture.core.run("set_listing_photo", web, {
      home: fixture.home,
      listing: "solid-oak-bookcase",
      file: png,
    });
    expect((await page("oak-bookcase")).picture).toEqual({
      listing: "solid-oak-bookcase",
      photoVersion: listing.photoVersion,
    });
  });

  it("gives the history one entry per moment and origin, newest first, with each Session's Skills", async () => {
    await fixture.core.run("edit_item", web, {
      home: fixture.home,
      item: "bookcase",
      fields: { serialNumber: "BILLY-1", manualLink: "https://www.ikea.com/billy" },
    });
    const { history } = await page("bookcase");
    expect(
      history.map((entry) => [
        entry.origin === "web" ? "web" : entry.skills,
        entry.changes.map((change) => change.field ?? "created"),
      ]),
    ).toEqual([
      ["web", ["serialNumber", "manualLink"]],
      [["purchase"], ["archivedAt"]],
      [["home-intake"], ["created"]],
    ]);
    expect(history[0]).not.toHaveProperty("skills");
    expect(history[0]?.changes[0]).toEqual({
      field: "serialNumber",
      new: "BILLY-1",
    });
    expect(history[1]?.changes[0]).toMatchObject({
      reason: "replaced by Oak bookcase (oak-bookcase)",
    });
    const ats = history.map((entry) => entry.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  it("finds an Item with no story: no relations, no picture, one history entry", async () => {
    const lamp = await page("pendant-lamp");
    expect(lamp.decisions).toEqual([]);
    expect(lamp.history).toHaveLength(1);
    for (const key of ["replaces", "replacedBy", "picture"]) expect(lamp).not.toHaveProperty(key);
    const error = await refusal(page("no-such-item"));
    expect(error.code).toBe("not_found");
  });

  it("is a web operation and not an Agent tool, like edit_item", () => {
    const surfaces = fixture.core.operations
      .filter((each) => each.name === "get_item" || each.name === "edit_item")
      .map((each) => [each.name, each.surface, each.readOnly]);
    expect(surfaces).toEqual([
      ["get_item", "web", true],
      ["edit_item", "web", false],
    ]);
  });

  it("prints the register in find_items when it is recorded, and never on the Room Sheet", async () => {
    const { session } = await fixture.core.run(
      "open_session",
      { caller: { kind: "session" }, home: fixture.home },
      { skill: "home-intake" },
    );
    const agent: CallContext = { caller: { kind: "session", session }, home: fixture.home };
    const text = async (name: "find_items" | "get_room_sheet", input: object) => {
      const operation = fixture.core.operations.find((each) => each.name === name);
      const output = await fixture.core.run(name, agent, { session, ...input } as never);
      return operation?.text?.(output) ?? "";
    };
    const items = await text("find_items", {});
    expect(items).toContain(
      "Standing desk (standing-desk): tables; Unplaced; bought 2023; paid £350; warranty until 2028-06",
    );
    expect(items).toContain("bought 2026-09-14; from *example.com; paid £620");
    // No register recorded, no register printed.
    expect(items).toMatch(/Sofa \(sofa\): [^\n]*worn\n/);

    const sheet = await text("get_room_sheet", { room: "living-room" });
    expect(sheet).toContain("Oak bookcase (oak-bookcase): storage; against living-room/wall-4");
    for (const word of ["bought", "paid", "£620", "warranty", "serial", "example.com"]) {
      expect(sheet).not.toContain(word);
    }
  });
});

describe("the clutter rule's data (Q9): Archived records for the web's switches", () => {
  it("get_room gives the Room's Archived Items after the live ones, marked archivedAt, and the Room Sheet still leaves them out", async () => {
    const fixture = await createFixtureHome();
    try {
      const { room } = await fixture.core.run("get_room", web, {
        home: fixture.home,
        room: "living-room",
      });
      const items = room.items.map((item) => [item.slug, Boolean(item.archivedAt)]);
      expect(items.filter(([, archived]) => archived)).toEqual([
        ["bookcase", true],
        ["old-armchair", true],
      ]);
      expect(items.findIndex(([, archived]) => archived)).toBe(items.length - 2);
      const { session } = await fixture.core.run(
        "open_session",
        { caller: { kind: "session" }, home: fixture.home },
        { skill: "home-intake" },
      );
      const { sheet } = await fixture.core.run(
        "get_room_sheet",
        { caller: { kind: "session", session }, home: fixture.home },
        { session, room: "living-room" },
      );
      expect(sheet).not.toContain("old-armchair");
      expect(sheet).not.toContain("(bookcase)");
    } finally {
      fixture.core.close();
    }
  });

  it("list_decisions gives Archived Decisions only on request, marked archivedAt", async () => {
    const store = openStore(":memory:");
    const core = createCore({ store });
    try {
      const home = (
        await core.run("create_home", web, { name: "My flat", country: "GB", city: "London" })
      ).home.slug;
      const { session } = await core.run(
        "open_session",
        { caller: { kind: "session" }, home },
        { skill: "purchase" },
      );
      const agent: CallContext = { caller: { kind: "session", session }, home };
      await core.run("save_room", agent, { session, name: "Kitchen" });
      for (const title of ["Kitchen stool", "Kitchen shelf"]) {
        await core.run("save_decision", agent, {
          session,
          kind: "purchase",
          room: "kitchen",
          title,
          statement: `A ${title.toLowerCase()}.`,
        });
      }
      // No operation Archives a Decision yet; the column is there for when one does.
      const [homeRow] = store.homes();
      const shelf = store
        .list("decisions", homeRow?.id ?? 0)
        .find((each) => each.slug === "kitchen-shelf");
      store.update("decisions", shelf?.id ?? 0, { archivedAt: "2026-09-21T10:00:00.000Z" });

      const live = await core.run("list_decisions", web, { home });
      expect(live.decisions.map((each) => each.slug)).toEqual(["kitchen-stool"]);
      expect(live.decisions[0]).not.toHaveProperty("archivedAt");
      const all = await core.run("list_decisions", web, { home, archived: true });
      expect(all.decisions.map((each) => [each.slug, each.archivedAt])).toEqual([
        ["kitchen-stool", undefined],
        ["kitchen-shelf", "2026-09-21T10:00:00.000Z"],
      ]);
      const found = await core.run("find_decisions", agent, { session });
      expect(found.decisions.map((each) => each.slug)).toEqual(["kitchen-stool"]);
    } finally {
      core.close();
    }
  });
});
