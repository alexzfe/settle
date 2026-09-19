// The server-enforced rules of slice 1, written before their implementation.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore } from "./core.js";
import { CoreError } from "./errors.js";
import { createFixtureHome } from "./fixture/fixture-home.js";

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

let core: Core;
beforeEach(() => {
  core = createCore({ database: ":memory:" });
});
afterEach(() => core.close());

async function createHome(name: string): Promise<string> {
  const { home } = await core.run("create_home", web, { name, country: "GB", city: "London" });
  return home.slug;
}

async function openSession(home: string): Promise<string> {
  const { session } = await core.run("open_session", agent(home), { skill: "home-intake" });
  return session;
}

async function roomsOf(home: string): Promise<string[]> {
  const { rooms } = await core.run("get_home", web, { home });
  return rooms.map((room) => room.slug);
}

describe("Session scoping", () => {
  it("refuses a write from a Session belonging to another Home", async () => {
    const mine = await createHome("My flat");
    const other = await createHome("Holiday cottage");
    const session = await openSession(other);

    const error = await refusal(
      core.run("save_room", agent(mine, session), { session, name: "Kitchen" }),
    );

    expect(error.code).toBe("unknown_session");
    expect(error.message).toContain("open_session");
    expect(await roomsOf(mine)).toEqual([]);
    expect(await roomsOf(other)).toEqual([]);
  });

  it("refuses an Agent write that carries no Session", async () => {
    const home = await createHome("My flat");
    const error = await refusal(
      core.run("save_room", agent(home), { session: "", name: "Kitchen" }),
    );
    expect(["session_required", "validation"]).toContain(error.code);
    expect(await roomsOf(home)).toEqual([]);
  });
});

describe("closed Sessions", () => {
  it("refuses a write after close_session with session_closed, pointing at open_session", async () => {
    const home = await createHome("My flat");
    const session = await openSession(home);
    await core.run("save_room", agent(home, session), { session, name: "Kitchen" });
    await core.run("close_session", agent(home, session), {
      session,
      summary: { changed: "Added the kitchen.", open: "Nothing.", next: "Home Intake again." },
    });

    const error = await refusal(
      core.run("save_room", agent(home, session), { session, name: "Hallway" }),
    );

    expect(error.code).toBe("session_closed");
    expect(error.message).toContain("open_session");
    expect(await roomsOf(home)).toEqual(["kitchen"]);
  });

  it("refuses to close or join a closed Session", async () => {
    const home = await createHome("My flat");
    const session = await openSession(home);
    const summary = { changed: "Nothing.", open: "Nothing.", next: "Home Intake." };
    await core.run("close_session", agent(home, session), { session, summary });

    const closeAgain = await refusal(
      core.run("close_session", agent(home, session), { session, summary }),
    );
    const join = await refusal(
      core.run("open_session", agent(home, session), { skill: "home-intake", session }),
    );

    expect(closeAgain.code).toBe("session_closed");
    expect(join.code).toBe("session_closed");
  });
});

describe("set_up_home_folder", () => {
  const dirs: string[] = [];
  const tempFolder = () => {
    const dir = mkdtempSync(join(tmpdir(), "settle-home-folder-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a folder whose .mcp.json names another Home, and leaves it as it was", async () => {
    const mine = await createHome("My flat");
    const other = await createHome("Holiday cottage");
    const folder = tempFolder();
    await core.run("set_up_home_folder", web, { home: other, path: folder });
    const before = readFileSync(join(folder, ".mcp.json"), "utf8");

    const error = await refusal(core.run("set_up_home_folder", web, { home: mine, path: folder }));

    expect(error.code).toBe("folder_belongs_to_other_home");
    expect(readFileSync(join(folder, ".mcp.json"), "utf8")).toBe(before);
    const { home } = await core.run("get_home", web, { home: mine });
    expect(home.homeFolderPath).toBeUndefined();
  });

  it("never touches .claude/settings.local.json", async () => {
    const home = await createHome("My flat");
    const withLocal = tempFolder();
    mkdirSync(join(withLocal, ".claude"));
    const local = `{ "enabledMcpjsonServers": ["settle"] }\n`;
    writeFileSync(join(withLocal, ".claude", "settings.local.json"), local);
    const withoutLocal = tempFolder();

    await core.run("set_up_home_folder", web, { home, path: withLocal });
    await core.run("set_up_home_folder", web, { home, path: withLocal });
    await core.run("set_up_home_folder", web, { home, path: withoutLocal });

    expect(readFileSync(join(withLocal, ".claude", "settings.local.json"), "utf8")).toBe(local);
    expect(existsSync(join(withoutLocal, ".claude", "settings.local.json"))).toBe(false);
  });
});

describe("slugs", () => {
  it("are unique within a Home, with -2 and -3 on clashes", async () => {
    const home = await createHome("My flat");
    const session = await openSession(home);
    for (const name of ["Mia's room", "Mias room", "Mia’s Room!"]) {
      await core.run("save_room", agent(home, session), { session, name });
    }
    expect(await roomsOf(home)).toEqual(["mias-room", "mias-room-2", "mias-room-3"]);
    expect([await createHome("Flat"), await createHome("Flat!")]).toEqual(["flat", "flat-2"]);
  });

  it("are unique per Home, so another Home may reuse one", async () => {
    const mine = await createHome("My flat");
    const other = await createHome("Holiday cottage");
    for (const home of [mine, other]) {
      const session = await openSession(home);
      await core.run("save_room", agent(home, session), { session, name: "Kitchen" });
      expect(await roomsOf(home)).toEqual(["kitchen"]);
    }
  });

  it("never change once assigned, even when the Room moves to another Level", async () => {
    const fixture = await createFixtureHome();
    try {
      const { session } = await fixture.core.run("open_session", agent(fixture.home), {
        skill: "home-intake",
      });
      const context = agent(fixture.home, session);
      await fixture.core.run("save_room", context, { session, name: "Study", level: "first" });
      await fixture.core.run("save_room", context, { session, name: "Study", level: "ground" });

      const { rooms } = await fixture.core.run("get_home", web, { home: fixture.home });
      expect(rooms.filter((room) => room.name === "Study")).toEqual([
        { slug: "study", name: "Study", level: "ground" },
      ]);
    } finally {
      fixture.core.close();
    }
  });
});
