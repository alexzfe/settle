import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore } from "./core.js";
import { CoreError } from "./errors.js";
import type { ChangeEvent } from "./events.js";
import { createFixtureHome, type FixtureHome } from "./fixture/fixture-home.js";
import { openStore, type Store } from "./store.js";

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

let store: Store;
let core: Core;
beforeEach(() => {
  store = openStore(":memory:");
  core = createCore({ store, clock: () => new Date("2026-09-14T10:00:00.000Z") });
});
afterEach(() => core.close());

async function newHome(name = "My flat"): Promise<string> {
  const { home } = await core.run("create_home", web, { name, country: "GB", city: "London" });
  return home.slug;
}

async function newSession(home: string): Promise<string> {
  const { session } = await core.run("open_session", agent(home), { skill: "home-intake" });
  return session;
}

describe("create_home", () => {
  it("takes the latitude from the city table, rounded to 0.1°, and adds the Ground Level", async () => {
    const { home } = await core.run("create_home", web, {
      name: "My flat",
      country: "GB",
      city: "London",
    });
    expect(home).toEqual({
      slug: "my-flat",
      name: "My flat",
      country: "GB",
      city: "London",
      latitude: 51.5,
    });
    const { levels, rooms } = await core.run("get_home", web, { home: home.slug });
    expect(levels).toEqual([{ slug: "ground", name: "Ground", storey: 0 }]);
    expect(rooms).toEqual([]);
  });

  it("finds a city by the country's English name and without accents", async () => {
    const { home } = await core.run("create_home", web, {
      name: "Piso",
      country: "spain",
      city: "Malaga",
    });
    expect(home.latitude).toBe(36.7);
    const southern = await core.run("create_home", web, {
      name: "Flat",
      country: "Australia",
      city: "Sydney",
    });
    expect(southern.home.latitude).toBe(-33.9);
  });

  it("uses a given latitude, rounded, when the city is not in the table", async () => {
    const { home } = await core.run("create_home", web, {
      name: "Cabin",
      country: "GB",
      city: "Nowhere-on-Sea",
      latitude: 54.3456,
    });
    expect(home.latitude).toBe(54.3);
  });

  it("refuses a city it can't find with city_not_found, so the form can ask", async () => {
    const unknownCity = await refusal(
      core.run("create_home", web, { name: "Cabin", country: "GB", city: "Nowhere-on-Sea" }),
    );
    const unknownCountry = await refusal(
      core.run("create_home", web, { name: "Cabin", country: "Atlantis", city: "London" }),
    );
    expect(unknownCity.code).toBe("city_not_found");
    expect(unknownCity.message).toContain("latitude");
    expect(unknownCountry.code).toBe("city_not_found");
    expect((await core.run("list_homes", web, {})).homes).toEqual([]);
  });

  it("refuses input that breaks the schema with a validation error naming the field", async () => {
    const error = await refusal(
      core.run("create_home", web, { name: " ", country: "GB", city: "London" }),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("name");
  });
});

describe("list_homes and get_home", () => {
  it("list every Home by name, and refuse a Home that does not exist", async () => {
    await newHome("Seaside cottage");
    await newHome("City flat");
    const { homes } = await core.run("list_homes", web, {});
    expect(homes.map((home) => home.slug)).toEqual(["city-flat", "seaside-cottage"]);
    const error = await refusal(core.run("get_home", web, { home: "nowhere" }));
    expect(error.code).toBe("not_found");
  });
});

describe("open_session", () => {
  it("opens a new Session with a fresh slug and records its Skill", async () => {
    const home = await newHome();
    const first = await core.run("open_session", agent(home), { skill: "home-intake" });
    const second = await core.run("open_session", agent(home), { skill: "home-intake" });

    expect(first.session).toMatch(/^home-intake-[a-z2-9]{4}$/);
    expect(second.session).not.toBe(first.session);
    expect(first.home).toBe("My flat");
    expect(first.opening).toContain("Home: My flat");
    const { sessions } = await core.run("list_sessions", web, { home });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      slug: expect.any(String),
      skills: ["home-intake"],
      openedAt: "2026-09-14T10:00:00.000Z",
    });
  });

  it("joins an open Session: records the new Skill and sends only what is new", async () => {
    const home = await newHome();
    const opened = await core.run("open_session", agent(home), { skill: "home-intake" });
    const session = opened.session;

    const joined = await core.run("open_session", agent(home, session), {
      skill: "color",
      session,
    });
    const again = await core.run("open_session", agent(home, session), {
      skill: "color",
      session,
    });
    const resent = await core.run("open_session", agent(home, session), {
      skill: "color",
      session,
      resend: true,
    });

    // Home Intake had the Overview; Color adds only the Home-wide Decisions block.
    expect(joined.opening).toMatch(/^Home-wide Decisions in force:/);
    expect(joined.opening).not.toContain("Rooms:");
    expect(again).toEqual({ session, home: "My flat", opening: "" });
    expect(resent.opening).toBe(`${opened.opening}\n\n${joined.opening}`);
    const { sessions } = await core.run("list_sessions", web, { home });
    expect(sessions.map((each) => each.skills)).toEqual([["home-intake", "color"]]);
  });

  it("refuses an endpoint for a Home the app does not have", async () => {
    const error = await refusal(
      core.run("open_session", agent("nowhere"), { skill: "home-intake" }),
    );
    expect(error.code).toBe("not_found");
    expect(error.message).toContain("Home Folder");
  });
});

describe("save_room", () => {
  let fixture: FixtureHome;
  beforeEach(async () => {
    fixture = await createFixtureHome();
  });
  afterEach(() => fixture.core.close());

  /** Saves a Room; the receipt is its first line, about the Room itself, before the Gaps. */
  async function save(name: string, level?: string) {
    const { session } = await fixture.core.run("open_session", agent(fixture.home), {
      skill: "home-intake",
    });
    const { receipt } = await fixture.core.run("save_room", agent(fixture.home, session), {
      session,
      name,
      level,
    });
    return { receipt: receipt.split("\n")[0] };
  }

  it("puts a Room on the ground Level when no Level is given", async () => {
    expect((await save("Utility room")).receipt).toBe(
      "Utility room (utility-room): created on Ground",
    );
  });

  it("takes a Level by slug or by name, in any case", async () => {
    expect((await save("Study", "first")).receipt).toBe("Study (study): created on First");
    expect((await save("Bathroom", "First")).receipt).toBe("Bathroom (bathroom): created on First");
    expect((await save("Landing", "FIRST")).receipt).toBe("Landing (landing): created on First");
  });

  it("refuses a Level the Home does not have, listing the ones it has", async () => {
    const error = await refusal(save("Loft room", "Loft"));
    expect(error.code).toBe("not_found");
    expect(error.message).toContain("Ground (ground), First (first)");
  });

  it("updates the Room of the same name instead of adding a second one", async () => {
    expect((await save("kitchen", "first")).receipt).toBe(
      "Kitchen (kitchen): moved from Ground to First",
    );
    expect((await save("Kitchen", "first")).receipt).toBe(
      "Kitchen (kitchen): already recorded on First, nothing changed",
    );
    const { rooms } = await fixture.core.run("get_home", web, { home: fixture.home });
    expect(rooms.filter((room) => room.slug.startsWith("kitchen"))).toHaveLength(1);
  });
});

describe("get_room_sheet", () => {
  it("finds a Room by slug or name, refuses an unknown one, and works after close", async () => {
    const fixture = await createFixtureHome();
    try {
      const context = agent(fixture.home, fixture.session);
      const bySlug = await fixture.core.run("get_room_sheet", context, {
        session: fixture.session,
        room: "living-room",
      });
      const byName = await fixture.core.run("get_room_sheet", context, {
        session: fixture.session,
        room: "Living Room",
      });
      expect(byName).toEqual(bySlug);
      const error = await refusal(
        fixture.core.run("get_room_sheet", context, { session: fixture.session, room: "attic" }),
      );
      expect(error.code).toBe("not_found");
      expect(error.message).toContain("Living room (living-room)");
    } finally {
      fixture.core.close();
    }
  });
});

describe("close_session and list_sessions", () => {
  it("keeps the summary and the time the Session closed", async () => {
    const home = await newHome();
    const session = await newSession(home);
    const summary = { changed: "Added the kitchen.", open: "Nothing.", next: "Home Intake." };
    expect(await core.run("close_session", agent(home, session), { session, summary })).toEqual({
      ok: true,
    });
    const { sessions } = await core.run("list_sessions", web, { home });
    expect(sessions).toEqual([
      {
        slug: session,
        skills: ["home-intake"],
        openedAt: "2026-09-14T10:00:00.000Z",
        closedAt: "2026-09-14T10:00:00.000Z",
        summary,
      },
    ]);
  });
});

describe("the change log and the event bus", () => {
  it("log every write with its origin: the Session, or the web", async () => {
    const home = await newHome();
    const session = await newSession(home);
    await core.run("save_room", agent(home, session), { session, name: "Kitchen" });
    const homeId = store.home(home)?.id ?? -1;

    const changes = store
      .changes(homeId)
      .map(({ origin, recordKind, recordSlug, field, new: to }) => ({
        origin,
        recordKind,
        recordSlug,
        field,
        new: to,
      }));
    expect(changes).toEqual([
      {
        origin: "web",
        recordKind: "home",
        recordSlug: "my-flat",
        field: null,
        new: { slug: "my-flat", name: "My flat", country: "GB", city: "London", latitude: 51.5 },
      },
      {
        origin: "web",
        recordKind: "level",
        recordSlug: "ground",
        field: null,
        new: { slug: "ground", name: "Ground", storey: 0 },
      },
      {
        origin: session,
        recordKind: "session",
        recordSlug: session,
        field: null,
        new: { skills: ["home-intake"] },
      },
      {
        origin: session,
        recordKind: "room",
        recordSlug: "kitchen",
        field: null,
        new: { name: "Kitchen", level: "ground" },
      },
    ]);
  });

  it("publish one event per changed record after the write, and none for a refused one", async () => {
    const events: ChangeEvent[] = [];
    core.subscribe((event) => events.push(event));
    const home = await newHome();
    const session = await newSession(home);
    await core.run("save_room", agent(home, session), { session, name: "Kitchen" });
    await refusal(core.run("save_room", agent(home, "nope"), { session: "nope", name: "Hall" }));

    expect(events).toEqual([
      { home, recordKind: "home", recordSlug: "my-flat" },
      { home, recordKind: "level", recordSlug: "ground" },
      { home, recordKind: "session", recordSlug: session },
      { home, recordKind: "room", recordSlug: "kitchen" },
    ]);
  });

  it("stop calling a listener once it unsubscribes", async () => {
    const events: ChangeEvent[] = [];
    const stop = core.subscribe((event) => events.push(event));
    stop();
    await newHome();
    expect(events).toEqual([]);
  });
});

describe("home_folder_setup", () => {
  it("gives the command, the plugin install line, and the two files, for the local origin", async () => {
    const home = await newHome();

    const setup = await core.run("home_folder_setup", web, { home });

    expect(setup.origin).toBe("http://127.0.0.1:4380");
    const token = core.homeToken(home) as string;
    expect(token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(setup.command).toBe(
      `curl -fsSL -H "Authorization: Bearer ${token}" ` +
        '"http://127.0.0.1:4380/api/home_folder_script?home=my-flat" | sh',
    );
    expect(setup.pluginInstall).toBe(
      "claude plugin marketplace add alexzfe/settle && claude plugin install settle@settle --scope project",
    );
    expect(setup.files.map((file) => file.path)).toEqual([".mcp.json", ".claude/settings.json"]);
    expect(JSON.parse(setup.files[0]?.content ?? "")).toEqual({
      mcpServers: {
        settle: {
          type: "http",
          url: "http://127.0.0.1:4380/mcp/homes/my-flat",
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    });
    expect(JSON.parse(setup.files[1]?.content ?? "")).toEqual({
      enabledPlugins: { "settle@settle": true },
      extraKnownMarketplaces: {
        settle: { source: { source: "github", repo: "alexzfe/settle" } },
      },
      enabledMcpjsonServers: ["settle"],
    });
    expect(await core.run("get_home", web, { home })).not.toHaveProperty("home.homeFolderPath");
  });

  it("names the public origin when there is one, and the configured port when not", async () => {
    for (const [options, origin] of [
      [{ publicOrigin: "https://settle.example.com", port: 4380 }, "https://settle.example.com"],
      [{ port: 4390 }, "http://127.0.0.1:4390"],
    ] as const) {
      const other = createCore(options);
      try {
        const { home } = await other.run("create_home", web, {
          name: "My flat",
          country: "GB",
          city: "London",
        });
        const setup = await other.run("home_folder_setup", web, { home: home.slug });
        expect(setup.origin).toBe(origin);
        expect(setup.command).toContain(`"${origin}/api/home_folder_script?home=my-flat"`);
        expect(setup.files[0]?.content).toContain(`"${origin}/mcp/homes/my-flat"`);
      } finally {
        other.close();
      }
    }
  });

  it("gives each Home its own key, which no Home or change-log output shows", async () => {
    const home = await newHome();
    const other = (
      await core.run("create_home", web, { name: "Cottage", country: "GB", city: "London" })
    ).home.slug;
    const token = core.homeToken(home) as string;

    expect(core.homeToken(other)).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(core.homeToken(other)).not.toBe(token);
    expect(core.homeToken("nowhere")).toBeUndefined();
    for (const output of [
      await core.run("list_homes", web, {}),
      await core.run("get_home", web, { home }),
      await core.run("get_change_log", web, { home }),
    ]) {
      expect(JSON.stringify(output)).not.toContain(token);
    }
  });

  it("refuses a Home that does not exist", async () => {
    const error = await refusal(core.run("home_folder_setup", web, { home: "nowhere" }));
    expect(error.code).toBe("not_found");
  });
});
