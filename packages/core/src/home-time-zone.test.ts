// A Home's time zone: an IANA name the web takes from the browser at create_home (or when its
// owner opens a Home with none), changed on the About page or through save_home, and the zone
// "today" is reckoned in wherever core dates something itself (a Photo with no takenOn, the
// export's file name) and every stored moment is shown as a day. The server's clock is UTC, so without it an
// evening in Santiago or Lima is dated tomorrow. A Home made before time zones has none, and its
// days stay UTC's.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore } from "./core.js";
import { CoreError } from "./errors.js";
import { addAccount, TEST_PASSWORD_COST } from "./fixture/fixture-home.js";
import { dayIn, sharedTimeZone, timeZoneNamed } from "./time-zone.js";

const JPEG = new Uint8Array(64);
JPEG.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

/** 19:24 on 11 November in Lima and New York (UTC−5), already the 12th in UTC. */
const EVENING = new Date("2026-11-12T00:24:00.000Z");

describe("dayIn", () => {
  it("gives the day of an instant in a time zone", () => {
    expect(dayIn(EVENING.toISOString(), "America/Lima")).toBe("2026-11-11");
    expect(dayIn(EVENING.toISOString(), "Asia/Tokyo")).toBe("2026-11-12");
  });

  it("gives UTC's day when there is no time zone", () => {
    expect(dayIn(EVENING.toISOString(), null)).toBe("2026-11-12");
  });

  it("follows a zone's clock change, not a fixed offset", () => {
    // Santiago springs forward at 04:00Z on 6 September 2026: either side is still the 5th.
    expect(dayIn("2026-09-06T02:59:00.000Z", "America/Santiago")).toBe("2026-09-05");
    expect(dayIn("2026-09-06T03:30:00.000Z", "America/Santiago")).toBe("2026-09-05");
    // And falls back on 5 April 2026: 03:30Z is 23:30 on the 4th, at UTC−4.
    expect(dayIn("2026-04-05T03:30:00.000Z", "America/Santiago")).toBe("2026-04-04");
  });

  it("gives a zone ahead of UTC its next day just after its midnight", () => {
    expect(dayIn("2026-11-11T15:30:00.000Z", "Asia/Tokyo")).toBe("2026-11-12");
  });
});

describe("timeZoneNamed", () => {
  it("keeps a zone by the name given, its case put right", () => {
    expect(timeZoneNamed("america/lima")).toBe("America/Lima");
    expect(timeZoneNamed("Europe/Kyiv")).toBe("Europe/Kyiv");
    expect(timeZoneNamed("UTC")).toBe("UTC");
    expect(timeZoneNamed("Etc/UTC")).toBe("Etc/UTC");
  });

  it("refuses an offset, a fixed-offset zone, and a legacy abbreviation", () => {
    for (const name of ["+05:00", "GMT+5", "Etc/GMT+5", "EST", "EST5EDT", "Etc/Unknown", ""]) {
      expect(timeZoneNamed(name)).toBeUndefined();
    }
  });
});

describe("sharedTimeZone", () => {
  it("leaves out a Home with none when the others agree", () => {
    expect(sharedTimeZone([{ timeZone: null }, { timeZone: "America/Lima" }])).toBe("America/Lima");
    expect(
      sharedTimeZone([
        { timeZone: "America/Lima" },
        { timeZone: "Asia/Tokyo" },
        { timeZone: null },
      ]),
    ).toBeNull();
  });
});

describe("a Home's time zone", () => {
  let core: Core;
  let web: CallContext;
  let now: Date;

  const create = (timeZone?: string) =>
    core.run("create_home", web, {
      name: "My flat",
      country: "PE",
      city: "Lima",
      ...(timeZone === undefined ? {} : { timeZone }),
    });

  beforeEach(async () => {
    now = EVENING;
    core = createCore({ passwordCost: TEST_PASSWORD_COST, clock: () => now });
    web = await addAccount(core);
  });
  afterEach(() => core.close());

  it("is kept from create_home and shown on the Home", async () => {
    const { home } = await create("America/Lima");
    expect(home.timeZone).toBe("America/Lima");
    expect((await core.run("get_home", web, { home: home.slug })).home.timeZone).toBe(
      "America/Lima",
    );
  });

  it("is kept by its canonical name", async () => {
    expect((await create("america/lima")).home.timeZone).toBe("America/Lima");
  });

  it("is left out when the browser gave none", async () => {
    const { home } = await create();
    expect(home).not.toHaveProperty("timeZone");
  });

  it("still makes the Home, with no zone, when the browser's is one the server doesn't know", async () => {
    // The user never typed it and can't change it: a browser with no zone reports Etc/Unknown.
    for (const timeZone of ["Etc/Unknown", "Mars/Olympus"]) {
      const { home } = await create(timeZone);
      expect(home).not.toHaveProperty("timeZone");
    }
  });

  it("is shown to the Agent on the Home Overview, or said to be missing", async () => {
    const opening = async (slug: string) =>
      (
        await core.run(
          "open_session",
          { caller: { kind: "session" }, home: slug },
          { skill: "home-intake" },
        )
      ).opening;
    expect(await opening((await create("America/Lima")).home.slug)).toContain(
      "Time zone: America/Lima",
    );
    expect(await opening((await create()).home.slug)).toContain(
      "Time zone: not set, so its days are UTC's",
    );
  });

  describe("set from the web", () => {
    const setZone = (home: string, input: { timeZone: string; onlyIfNone?: boolean }) =>
      core.run("set_home_time_zone", web, { home, ...input });

    it("is changed by its owner, and the change is logged", async () => {
      const { home } = await create("America/Lima");
      const { home: changed } = await setZone(home.slug, { timeZone: "America/Santiago" });
      expect(changed.timeZone).toBe("America/Santiago");
      const { changes } = await core.run("get_change_log", web, { home: home.slug });
      expect(JSON.stringify(changes[0])).toContain("America/Santiago");
    });

    it("refuses a zone the owner chose that is not one, saying what to give", async () => {
      const { home } = await create("America/Lima");
      const error = await refusal(setZone(home.slug, { timeZone: "Mars/Olympus" }));
      expect(error.code).toBe("validation");
      expect(error.message).toContain('"Mars/Olympus" is not an IANA time zone');
      expect(error.message).toContain("America/Santiago");
    });

    it("gives a Home made before time zones the browser's, once, and leaves a set one", async () => {
      const { home } = await create();
      await setZone(home.slug, { timeZone: "Etc/Unknown", onlyIfNone: true });
      expect((await core.run("get_home", web, { home: home.slug })).home).not.toHaveProperty(
        "timeZone",
      );
      await setZone(home.slug, { timeZone: "America/Lima", onlyIfNone: true });
      await setZone(home.slug, { timeZone: "Asia/Tokyo", onlyIfNone: true });
      expect((await core.run("get_home", web, { home: home.slug })).home.timeZone).toBe(
        "America/Lima",
      );
    });
  });

  it("is changed through save_home, with a receipt line", async () => {
    const { home } = await create("America/Lima");
    const { session } = await core.run(
      "open_session",
      { caller: { kind: "session" }, home: home.slug },
      { skill: "home-intake" },
    );
    const agent: CallContext = { caller: { kind: "session", session }, home: home.slug };
    const { receipt } = await core.run("save_home", agent, {
      session,
      timeZone: "America/Santiago",
    });
    expect(receipt).toContain("time zone");
    expect(receipt).toContain("America/Santiago");
    expect((await core.run("get_home", web, { home: home.slug })).home.timeZone).toBe(
      "America/Santiago",
    );
    // An offset is not a zone: it would be wrong for half the year wherever clocks change.
    for (const timeZone of ["GMT+5", "+05:00"]) {
      const wrong = await refusal(core.run("save_home", agent, { session, timeZone }));
      expect(wrong.message).toContain(`"${timeZone}" is not an IANA time zone`);
    }
  });

  it("dates every stored moment the Agent and the user read in the Home's day", async () => {
    const { home } = await create("America/Lima");
    const { session } = await core.run(
      "open_session",
      { caller: { kind: "session" }, home: home.slug },
      { skill: "home-intake" },
    );
    const agent: CallContext = { caller: { kind: "session", session }, home: home.slug };
    const text = (name: string, output: unknown) => {
      const operation = core.operations.find((each) => each.name === name);
      if (!operation?.text) throw new Error(`${name} renders no text`);
      return operation.text(output);
    };
    await core.run("save_note", agent, { session, text: "The cat scratches fabric" });
    await core.run("save_room", agent, { session, name: "Den", walls: [{ position: 1 }] });
    await core.run("save_items", agent, {
      session,
      items: [{ name: "Old chair", category: "seating", room: "den" }],
    });
    await core.run("save_items", agent, {
      session,
      items: [{ item: "old-chair", archive: true, archiveReason: "broken" }],
    });
    await core.run("save_room", agent, { session, room: "den", name: "Den", archive: true });
    const read = [
      text("search_notes", await core.run("search_notes", agent, { session })),
      text("find_items", await core.run("find_items", agent, { session, archived: true })),
      (await core.run("get_room_sheet", agent, { session, room: "den" })).sheet,
      (await core.run("export_shopping_list", web, { home: home.slug, format: "html" })).text,
    ];
    for (const each of read) {
      expect(each).toMatch(/2026-11-11|11 Nov 2026/);
      expect(each).not.toMatch(/2026-11-12|12 Nov 2026/);
    }
  });

  describe("dates what core dates itself in the Home's day", () => {
    const addPhoto = async (home: string) => {
      const { session } = await core.run(
        "open_session",
        { caller: { kind: "session" }, home },
        { skill: "home-intake" },
      );
      await core.run(
        "save_room",
        { caller: { kind: "session", session }, home },
        { session, name: "Den", walls: [{ position: 1 }] },
      );
      return (await core.run("add_photo", web, { home, room: "den", file: JPEG, thumb: JPEG }))
        .photos[0]?.takenOn;
    };

    it("a Photo sent with no takenOn", async () => {
      expect(await addPhoto((await create("America/Lima")).home.slug)).toBe("2026-11-11");
    });

    it("a Photo of a Home with no time zone, in UTC's day as before", async () => {
      expect(await addPhoto((await create()).home.slug)).toBe("2026-11-12");
    });

    it("the export's file name, when the Account's Homes share a zone", async () => {
      await create("America/Lima");
      expect((await core.run("export_account", web, {})).fileName).toBe(
        "settle-export-2026-11-11.zip",
      );
      await create("Asia/Tokyo");
      expect((await core.run("export_account", web, {})).fileName).toBe(
        "settle-export-2026-11-12.zip",
      );
    });
  });
});
