import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore } from "./core.js";
import { CoreError } from "./errors.js";
import { addAccount, TEST_PASSWORD_COST } from "./fixture/fixture-home.js";
import { listHomes } from "./operations/homes.js";

// The Agent through a Connection: one Account, every Home of it, each Session locked to one.

let core: Core;
let admin: CallContext;
let kim: CallContext;
let sam: CallContext;
const accountOf = (web: CallContext) => (web.caller as { account: number }).account;
/** The Agent through the Account's Connection, on behalf of `session` when given. */
const connected = (web: CallContext, session?: string): CallContext => ({
  caller: { kind: "session", account: accountOf(web), ...(session ? { session } : {}) },
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

async function createHome(web: CallContext, name: string): Promise<string> {
  const { home } = await core.run("create_home", web, { name, country: "GB", city: "London" });
  return home.slug;
}

async function open(caller: CallContext, input: { home?: string } = {}): Promise<string> {
  return (await core.run("open_session", caller, { skill: "home-intake", ...input })).session;
}

beforeEach(async () => {
  core = createCore({ passwordCost: TEST_PASSWORD_COST });
  admin = await addAccount(core);
  kim = await addAccount(core);
  sam = await addAccount(core);
});
afterEach(() => core.close());

describe("before a Session", () => {
  it("list_homes gives the Account's Homes by name and slug, and nothing else", async () => {
    await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");
    await createHome(sam, "Sam's place");

    const listed = await core.run("list_homes", connected(kim), {});

    expect(listHomes.text?.(listed)).toBe(
      "- Beach house (slug beach-house)\n- Lisbon flat (slug lisbon-flat)",
    );
  });

  it("opens the Account's only Home when open_session names none", async () => {
    await createHome(kim, "Lisbon flat");

    const result = await core.run("open_session", connected(kim), { skill: "home-intake" });

    expect(result.home).toBe("Lisbon flat");
  });

  it("with several Homes and none named, refuses with their names and says to ask", async () => {
    await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");

    const error = await refusal(open(connected(kim)));

    expect(error.message).toContain("Lisbon flat (slug lisbon-flat)");
    expect(error.message).toContain("Beach house (slug beach-house)");
    expect(error.message).toContain("ask them which one");
  });

  it("with no Home, says to create one in the app", async () => {
    const error = await refusal(open(connected(kim)));
    expect(error.message).toContain("create one in the app");
  });

  it("opens the Home named by slug", async () => {
    await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");

    const result = await core.run("open_session", connected(kim), {
      skill: "home-intake",
      home: "beach-house",
    });

    expect(result.home).toBe("Beach house");
  });
});

describe("the wall between Accounts", () => {
  it("refuses another Account's Home by slug exactly as a Home that doesn't exist", async () => {
    await createHome(kim, "Lisbon flat");
    const theirs = await createHome(sam, "Sams place");

    const other = await refusal(open(connected(kim), { home: theirs }));
    const missing = await refusal(open(connected(kim), { home: "no-such-home" }));

    expect(other.code).toBe(missing.code);
    expect(other.message).toBe(missing.message.replace("no-such-home", theirs));
  });

  it("refuses another Account's Session exactly as a Session that doesn't exist", async () => {
    await createHome(kim, "Lisbon flat");
    await createHome(sam, "Sams place");
    const theirs = await open(connected(sam));
    const tools = [
      ["get_room_sheet", { room: "kitchen" }],
      ["find_items", {}],
      ["search_notes", { query: "cat" }],
      ["read_skill", { name: "purchase" }],
      ["save_room", { name: "Kitchen" }],
      ["save_note", { text: "A note." }],
      ["close_session", { summary: { changed: "x", open: "x", next: "x" } }],
    ] as const;

    for (const [tool, input] of tools) {
      const other = await refusal(core.run(tool, connected(kim), { session: theirs, ...input }));
      const missing = await refusal(
        core.run(tool, connected(kim), { session: "home-intake-zzzz", ...input }),
      );
      expect(other.code, tool).toBe("unknown_session");
      expect(other.message, tool).toBe(missing.message.replace("home-intake-zzzz", theirs));
    }
  });

  it("joins only the Account's own Session", async () => {
    await createHome(sam, "Sams place");
    const theirs = await open(connected(sam));

    const error = await refusal(
      core.run("open_session", connected(kim), { skill: "purchase", session: theirs }),
    );

    expect(error.code).toBe("unknown_session");
  });

  it("refuses a Session's id with another Home named beside it", async () => {
    await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");
    const session = await open(connected(kim), { home: "lisbon-flat" });

    const error = await refusal(
      core.run("open_session", connected(kim), {
        skill: "purchase",
        session,
        home: "beach-house",
      }),
    );

    expect(error.code).toBe("unknown_session");
  });

  it("refuses everything to a disabled Account, its own Homes and Sessions included", async () => {
    const home = await createHome(kim, "Lisbon flat");
    const session = await open(connected(kim));
    await core.run("disable_account", admin, { account: accountOf(kim) });

    expect((await core.run("list_homes", connected(kim), {})).homes).toEqual([]);
    expect((await refusal(open(connected(kim), { home }))).code).toBe("not_found");
    expect((await refusal(open(connected(kim)))).message).toContain("create one in the app");
    const read = await refusal(core.run("find_items", connected(kim, session), { session }));
    expect(read.code).toBe("unknown_session");
  });
});

describe("a Session locks the conversation to its Home", () => {
  it("works on the Session's Home, whichever Home another Session has", async () => {
    await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");
    const lisbon = await open(connected(kim), { home: "lisbon-flat" });
    const beach = await open(connected(kim), { home: "beach-house" });

    await core.run("save_room", connected(kim), { session: lisbon, name: "Kitchen" });
    await core.run("save_room", connected(kim), { session: beach, name: "Deck", outdoor: true });

    const lisbonHome = await core.run("get_home", kim, { home: "lisbon-flat" });
    const beachHome = await core.run("get_home", kim, { home: "beach-house" });
    expect(lisbonHome.rooms.map((room) => room.name)).toEqual(["Kitchen"]);
    expect(beachHome.rooms.map((room) => room.name)).toEqual(["Deck"]);
  });

  it("refuses every call but list_homes and open_session without a Session", async () => {
    await createHome(kim, "Lisbon flat");

    const error = await refusal(core.run("find_items", connected(kim), {}));

    expect(error.code).toBe("validation");
  });
});

describe("the Home Folder endpoint", () => {
  const keyed = (home: string, session?: string): CallContext => ({
    caller: { kind: "session", ...(session ? { session } : {}) },
    home,
  });

  it("refuses a Session of another Home, even of the same Account", async () => {
    const lisbon = await createHome(kim, "Lisbon flat");
    const beach = await createHome(kim, "Beach house");
    const session = await open(keyed(beach));

    const error = await refusal(core.run("find_items", keyed(lisbon, session), { session }));

    expect(error.code).toBe("unknown_session");
  });

  it("refuses a `home` that is not the URL's", async () => {
    const lisbon = await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");

    const error = await refusal(open(keyed(lisbon), { home: "beach-house" }));

    expect(error.code).toBe("not_found");
  });

  it("lists only the URL's Home", async () => {
    const lisbon = await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");

    const listed = await core.run("list_homes", keyed(lisbon), {});
    expect(listed.homes.map((home) => home.slug)).toEqual(["lisbon-flat"]);
  });

  it("sends no protocol or Skills with the opening, since the native Skills carry them", async () => {
    const lisbon = await createHome(kim, "Lisbon flat");

    const result = await core.run("open_session", keyed(lisbon), { skill: "purchase" });

    expect(result.skills).toBeUndefined();
  });
});

describe("Skills for an Agent without native Skills", () => {
  it("opens with the Session protocol and the menu, and resends them only on `resend`", async () => {
    await createHome(kim, "Lisbon flat");
    const opened = await core.run("open_session", connected(kim), { skill: "purchase" });
    const { session } = opened;

    const joined = await core.run("open_session", connected(kim, session), {
      skill: "color",
      session,
    });
    const resent = await core.run("open_session", connected(kim, session), {
      skill: "color",
      session,
      resend: true,
    });

    expect(opened.skills?.protocol).toContain("### Asking first");
    expect(opened.skills?.menu.map((skill) => skill.name)).toEqual([
      "home-intake",
      "design-direction",
      "color",
      "purchase",
    ]);
    expect(opened.skills?.menu.every((skill) => skill.trigger.length > 50)).toBe(true);
    expect(joined.skills).toBeUndefined();
    expect(resent.skills?.skill).toBe("color");
  });

  it("read_skill gives the built Skill's own text, without the protocol", async () => {
    await createHome(kim, "Lisbon flat");
    const session = await open(connected(kim));

    const skill = await core.run("read_skill", connected(kim), { session, name: "purchase" });

    expect(skill.body).toMatch(/^# Purchase\n/);
    expect(skill.body).not.toContain("## Session protocol");
  });
});
