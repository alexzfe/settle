// The rules of Accounts: one Account never reaches another's Homes, and is told such a Home doesn't
// exist; the setup link makes the Admin and claims every Home made before Accounts; invites and
// reset links work once, for a while; Logins last 30 days and end when the password changes;
// the Admin disables and deletes others but never themselves, and sees nothing inside their Homes;
// an Account exports everything it has and deletes it all, files included.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashPassword,
  LINK_MISS,
  passwordMatches,
  passwordProblem,
  tokenHash,
} from "./accounts.js";
import type { CallContext, Core } from "./core.js";
import { CoreError } from "./errors.js";
import {
  addAccount,
  createFixtureHome,
  FIXTURE_FILES,
  type FixtureHome,
  TEST_PASSWORD,
  TEST_PASSWORD_COST,
} from "./fixture/fixture-home.js";
import { noSuchHome, ownedHome } from "./operations/scope.js";
import { openStore, type Store } from "./store.js";

const ORIGIN = "https://settle.example.com";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, ...new Array(56)]);

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

let dataDir: string;
let fixture: FixtureHome;
let core: Core;
/** The fixture's Account, the Admin, which owns the fixture Home. */
let admin: CallContext;
/** A second Account, made by invite, with a Home of its own. */
let other: CallContext;
let otherHome: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "settle-accounts-"));
  fixture = await createFixtureHome({ dataDir, publicOrigin: ORIGIN });
  core = fixture.core;
  admin = fixture.web;
  other = await addAccount(core, "kim@example.com");
  otherHome = (
    await core.run("create_home", other, { name: "Cottage", country: "GB", city: "York" })
  ).home.slug;
});
afterEach(() => {
  core.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the ownership check", () => {
  it("refuses another Account's Home in every operation that takes a Home, as if it didn't exist", async () => {
    const takesHome = core.operations.filter(
      (operation) => "home" in operation.input.shape || "home" in (operation.webInput?.shape ?? {}),
    );
    // Every web operation names its Home, but these, which reach no Home's records. A new web
    // operation that takes no Home fails here until it is added, knowingly.
    expect(
      core.operations
        .filter((operation) => operation.surface !== "agent" && !takesHome.includes(operation))
        .map((operation) => operation.name)
        .sort(),
    ).toEqual([
      "admin_delete_account",
      "cancel_invite",
      "change_email",
      "change_password",
      "create_home",
      "create_invite",
      "create_reset_link",
      "delete_account",
      "disable_account",
      "enable_account",
      "end_logins",
      "export_account",
      "get_account",
      "list_accounts",
      "list_homes",
      "list_invites",
      "list_logins",
    ]);
    for (const operation of takesHome) {
      const error = await refusal(core.run(operation.name, other, { home: fixture.home }));
      expect([operation.name, error.code, error.message]).toEqual([
        operation.name,
        "not_found",
        noSuchHome(fixture.home).message,
      ]);
    }
    // The Agent's tools take their Home from the MCP endpoint's address, which the web never sets;
    // given one, they refuse the same way.
    for (const operation of core.operations.filter((each) => !takesHome.includes(each))) {
      const error = await refusal(core.run(operation.name, { ...other, home: fixture.home }, {}));
      expect([operation.name, error.message]).toEqual([
        operation.name,
        noSuchHome(fixture.home).message,
      ]);
    }
    // And that is word for word what a Home that doesn't exist gets.
    const missing = await refusal(core.run("get_home", other, { home: "nowhere" }));
    expect(missing.message).toBe(noSuchHome("nowhere").message);
  });

  it("refuses before reading the rest of the input, so validation can't tell Homes apart", async () => {
    const error = await refusal(core.run("save_room", other, { home: fixture.home, nonsense: 1 }));
    expect(error.code).toBe("not_found");
  });

  it("lets each Account reach its own Homes, and the Agent the Home its key opened", async () => {
    expect((await core.run("get_home", other, { home: otherHome })).home.name).toBe("Cottage");
    const store = openStore(":memory:");
    try {
      const home = store.insertHome({
        slug: "flat",
        name: "Flat",
        country: "GB",
        city: "London",
        latitude: 51.5,
        token: "key",
        accountId: null,
      });
      expect(ownedHome(store, { kind: "session" }, "flat")).toEqual(home);
      // A Home with no Account yet is nobody's on the web, and no Quick Guide link opens by slug.
      expect(() => ownedHome(store, { kind: "web", account: 1 }, "flat")).toThrow(
        noSuchHome("flat").message,
      );
      expect(() => ownedHome(store, { kind: "guide" }, "flat")).toThrow(noSuchHome("flat").message);
    } finally {
      store.close();
    }
  });

  it("lists only the Account's own Homes, and makes each new one its own", async () => {
    expect((await core.run("list_homes", other, {})).homes.map((home) => home.slug)).toEqual([
      otherHome,
    ]);
    expect((await core.run("list_homes", admin, {})).homes.map((home) => home.slug)).toEqual([
      fixture.home,
    ]);
  });

  it("lets a Quick Guide's link open its guide and nothing else", async () => {
    const guide = { caller: { kind: "guide" } } as const;
    const url = await phoneUrl();
    const { text } = await core.run("get_guide_page", guide, { token: tokenOf(url) });
    expect(text).toContain("<html");
    const bySlug = await refusal(
      core.run("get_guide_page", guide, { home: fixture.home, decision: "wool-rug" }),
    );
    expect(bySlug.message).toBe(noSuchHome(fixture.home).message);
    expect((await refusal(core.run("list_homes", guide, {}))).code).toBe("not_found");
  });
});

async function phoneUrl(): Promise<string> {
  const { decision } = await core.run("get_decision", admin, {
    home: fixture.home,
    decision: "wool-rug",
  });
  return decision.guides?.phoneUrl as string;
}

describe("passwords", () => {
  it("asks for 12 to 256 characters and nothing else", () => {
    expect(passwordProblem("short pass")).toContain("at least 12");
    expect(passwordProblem("twelve chars")).toBeUndefined();
    expect(passwordProblem("aaaaaaaaaaaa")).toBeUndefined();
    expect(passwordProblem("x".repeat(256))).toBeUndefined();
    expect(passwordProblem("x".repeat(257))).toContain("at most 256");
  });

  it("stores scrypt's parameters and salt with the hash, so a hash at another cost still checks", async () => {
    const stored = await hashPassword("correct horse battery", { N: 2 ** 11, r: 8, p: 1 });
    expect(stored).toMatch(/^scrypt\$2048\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await passwordMatches("correct horse battery", stored)).toBe(true);
    expect(await passwordMatches("correct horse batterY", stored)).toBe(false);
    expect(await hashPassword("correct horse battery", TEST_PASSWORD_COST)).not.toBe(stored);
  });

  it("checks an email whatever its case, and reads a wrong email as a wrong password", async () => {
    expect(await core.accounts.logIn("KIM@example.com", TEST_PASSWORD)).toMatchObject({
      outcome: "ok",
      account: { email: "kim@example.com", admin: false },
    });
    expect(await core.accounts.logIn("kim@example.com", "not the password")).toEqual({
      outcome: "wrong",
    });
    expect(await core.accounts.logIn("nobody@example.com", TEST_PASSWORD)).toEqual({
      outcome: "wrong",
    });
  });
});

describe("the setup link", () => {
  let store: Store;
  let fresh: Core;
  beforeEach(async () => {
    store = openStore(":memory:");
    store.insertHome({
      slug: "house",
      name: "House",
      country: "GB",
      city: "London",
      latitude: 51.5,
      token: "house-key",
      accountId: null,
    });
    const { createCore } = await import("./core.js");
    fresh = createCore({ store, publicOrigin: ORIGIN, passwordCost: TEST_PASSWORD_COST });
  });
  afterEach(() => fresh.close());

  it("makes the Admin, claims every Home made before Accounts, and is void once used", async () => {
    // No key opens a Home nobody has claimed.
    expect(fresh.homeToken("house")).toBeUndefined();
    const first = fresh.accounts.makeSetupLink() as string;
    const url = fresh.accounts.makeSetupLink() as string;
    expect(url).toMatch(new RegExp(`^${ORIGIN}/setup/[A-Za-z0-9_-]{43}$`));
    // Each new one voids the one before.
    expect(fresh.accounts.linkOpen("setup", tokenOf(first))).toBe(false);
    expect(fresh.accounts.linkOpen("setup", tokenOf(url))).toBe(true);

    const account = await fresh.accounts.redeem("setup", tokenOf(url), {
      email: " sam@example.com ",
      password: TEST_PASSWORD,
    });
    expect(account).toMatchObject({ email: "sam@example.com", admin: true });
    expect(store.home("house")?.accountId).toBe(account.id);
    expect(fresh.homeToken("house")).toBe("house-key");
    expect(fresh.accounts.makeSetupLink()).toBeUndefined();
    const again = await refusal(
      fresh.accounts.redeem("setup", tokenOf(url), {
        email: "x@example.com",
        password: TEST_PASSWORD,
      }),
    );
    expect([again.code, again.message]).toEqual(["not_found", LINK_MISS]);
  });

  it("stores only the hash of its token", () => {
    const url = fresh.accounts.makeSetupLink() as string;
    const [link] = store.accountLinks("setup");
    expect(link?.tokenHash).toBe(tokenHash(tokenOf(url)));
    expect(JSON.stringify(link)).not.toContain(tokenOf(url));
  });

  it("refuses a short password or a bad email and stays usable", async () => {
    const token = tokenOf(fresh.accounts.makeSetupLink() as string);
    const short = await refusal(
      fresh.accounts.redeem("setup", token, { email: "sam@example.com", password: "short" }),
    );
    expect(short.code).toBe("validation");
    const email = await refusal(
      fresh.accounts.redeem("setup", token, { email: "sam", password: TEST_PASSWORD }),
    );
    expect(email.message).toContain("email address");
    expect(fresh.accounts.linkOpen("setup", token)).toBe(true);
  });
});

describe("invites", () => {
  it("make one Account each, once, within 7 days; every miss reads the same", async () => {
    const { invite } = await core.run("create_invite", admin, {});
    expect(invite.url).toMatch(new RegExp(`^${ORIGIN}/invite/`));
    expect(Date.parse(invite.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(Date.parse(invite.expiresAt) - Date.now()).toBeLessThanOrEqual(7 * 24 * 3600_000);
    const token = tokenOf(invite.url);
    // Taken emails are refused whatever their case, and the invite stays usable.
    const taken = await refusal(
      core.accounts.redeem("invite", token, { email: "KIM@example.com", password: TEST_PASSWORD }),
    );
    expect(taken.message).toContain("already an account");
    const made = await core.accounts.redeem("invite", token, {
      email: "lee@example.com",
      password: TEST_PASSWORD,
    });
    expect(made).toMatchObject({ email: "lee@example.com", admin: false });
    const used = await refusal(
      core.accounts.redeem("invite", token, { email: "max@example.com", password: TEST_PASSWORD }),
    );
    const wrongKind = await refusal(
      core.accounts.redeem("reset", token, { password: TEST_PASSWORD }),
    );
    const made_up = await refusal(
      core.accounts.redeem("invite", "made-up", {
        email: "max@example.com",
        password: TEST_PASSWORD,
      }),
    );
    expect([used.message, wrongKind.message, made_up.message]).toEqual([
      LINK_MISS,
      LINK_MISS,
      LINK_MISS,
    ]);
  });

  it("are listed while waiting, and cancelled by the Admin alone", async () => {
    const { invite } = await core.run("create_invite", admin, {});
    const { invites } = await core.run("list_invites", admin, {});
    expect(invites).toEqual([
      { id: expect.any(Number), createdAt: expect.any(String), expiresAt: invite.expiresAt },
    ]);
    // Only the hash is kept, so a listed invite has no link to show.
    expect(JSON.stringify(invites)).not.toContain(tokenOf(invite.url));
    expect((await refusal(core.run("create_invite", other, {}))).message).toContain("Admin");
    expect((await refusal(core.run("list_invites", other, {}))).message).toContain("Admin");

    await core.run("cancel_invite", admin, { invite: invites[0]?.id ?? 0 });
    expect((await core.run("list_invites", admin, {})).invites).toEqual([]);
    expect(core.accounts.linkOpen("invite", tokenOf(invite.url))).toBe(false);
  });
});

describe("Logins", () => {
  it("last 30 days, end when the Account is disabled, and are stored by hash", async () => {
    const account = (other.caller as { account: number }).account;
    const token = core.accounts.startLogin(account, "Firefox on Linux");
    expect(core.accounts.current(token)).toMatchObject({ account: { id: account } });
    expect(core.accounts.current(`${token}x`)).toBeUndefined();
    const { logins } = await core.run("list_logins", other, {});
    expect(logins).toEqual([
      {
        id: expect.any(Number),
        createdAt: expect.any(String),
        lastSeenAt: expect.any(String),
        expiresAt: expect.any(String),
        userAgent: "Firefox on Linux",
        current: false,
      },
    ]);
    const lasts = Date.parse(logins[0]?.expiresAt ?? "") - Date.parse(logins[0]?.createdAt ?? "");
    expect(lasts).toBe(30 * 24 * 3600_000);

    await core.run("disable_account", admin, { account });
    expect(core.accounts.current(token)).toBeUndefined();
    expect((await core.accounts.logIn("kim@example.com", TEST_PASSWORD)).outcome).toBe("disabled");
  });

  it("all end but this one when the password changes, which needs the current one", async () => {
    const account = (other.caller as { account: number }).account;
    const here = core.accounts.startLogin(account, "here");
    const there = core.accounts.startLogin(account, "there");
    const hereId = core.accounts.current(here)?.login as number;
    const as = { caller: { kind: "web", account, login: hereId } } as const;
    const wrong = await refusal(
      core.run("change_password", as, {
        current: "not it at all",
        password: "a new long password",
      }),
    );
    expect(wrong.message).toContain("not this account's password");
    await core.run("change_password", as, {
      current: TEST_PASSWORD,
      password: "a new long password",
    });
    expect(core.accounts.current(here)).toBeDefined();
    expect(core.accounts.current(there)).toBeUndefined();
    expect((await core.accounts.logIn("kim@example.com", "a new long password")).outcome).toBe(
      "ok",
    );

    await core.run("end_logins", as, {});
    expect(core.accounts.current(here)).toBeUndefined();
  });

  it("ends one Login on logging out", () => {
    const account = (other.caller as { account: number }).account;
    const token = core.accounts.startLogin(account, undefined);
    core.accounts.endLogin(token);
    expect(core.accounts.current(token)).toBeUndefined();
  });
});

describe("the Account page", () => {
  it("changes the email, given the password, to one no other Account has", async () => {
    const taken = await refusal(
      core.run("change_email", other, { email: "fixture@example.com", password: TEST_PASSWORD }),
    );
    expect(taken.message).toContain("already uses");
    const { account } = await core.run("change_email", other, {
      email: "kim@home.example",
      password: TEST_PASSWORD,
    });
    expect(account.email).toBe("kim@home.example");
    expect((await core.run("get_account", other, {})).account).toEqual({
      email: "kim@home.example",
      admin: false,
      createdAt: expect.any(String),
    });
  });
});

describe("reset links", () => {
  it("set a password once within 24 hours and end every Login of the Account", async () => {
    const account = (other.caller as { account: number }).account;
    const login = core.accounts.startLogin(account, undefined);
    const { reset } = await core.run("create_reset_link", admin, { account });
    expect(Date.parse(reset.expiresAt) - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
    expect(Date.parse(reset.expiresAt) - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    const later = await core.run("create_reset_link", admin, { account });
    // A newer link voids the one before it.
    expect(core.accounts.linkOpen("reset", tokenOf(reset.url))).toBe(false);
    await core.accounts.redeem("reset", tokenOf(later.reset.url), {
      password: "a brand new password",
    });
    expect(core.accounts.current(login)).toBeUndefined();
    expect((await core.accounts.logIn("kim@example.com", "a brand new password")).outcome).toBe(
      "ok",
    );
    expect(core.accounts.linkOpen("reset", tokenOf(later.reset.url))).toBe(false);
  });
});

describe("the Admin", () => {
  it("lists every Account by email, dates, and Home count, and nothing from inside", async () => {
    const { accounts } = await core.run("list_accounts", admin, {});
    expect(accounts).toEqual([
      {
        id: expect.any(Number),
        email: "fixture@example.com",
        admin: true,
        createdAt: expect.any(String),
        homes: 1,
      },
      {
        id: expect.any(Number),
        email: "kim@example.com",
        admin: false,
        createdAt: expect.any(String),
        homes: 1,
      },
    ]);
    expect((await refusal(core.run("list_accounts", other, {}))).message).toContain("Admin");
  });

  it("never disables, deletes, or resets the Admin's own Account", async () => {
    const self = (admin.caller as { account: number }).account;
    for (const name of ["disable_account", "enable_account", "create_reset_link"]) {
      const error = await refusal(core.run(name, admin, { account: self }));
      expect(error.message).toContain("your own account");
    }
    const error = await refusal(
      core.run("admin_delete_account", admin, { account: self, email: "fixture@example.com" }),
    );
    expect(error.message).toContain("your own account");
    const own = await refusal(core.run("delete_account", admin, { email: "fixture@example.com" }));
    expect(own.message).toContain("can't be deleted");
  });

  it("disables an Account: its Homes' keys and Quick Guide links stop, until enabled", async () => {
    const kim = (other.caller as { account: number }).account;
    const url = await kimsGuide();
    const guide = { caller: { kind: "guide" } } as const;
    const key = core.homeToken(otherHome);
    expect(key).toBeDefined();

    await core.run("disable_account", admin, { account: kim });
    expect(core.homeToken(otherHome)).toBeUndefined();
    const closed = await refusal(core.run("get_guide_page", guide, { token: tokenOf(url) }));
    expect(closed.code).toBe("not_found");
    // Nobody else's is touched.
    expect(core.homeToken(fixture.home)).toBeDefined();
    expect((await refusal(core.run("get_account", other, {}))).message).toContain("logged in");

    await core.run("enable_account", admin, { account: kim });
    expect(core.homeToken(otherHome)).toBe(key);
    expect((await core.run("get_guide_page", guide, { token: tokenOf(url) })).text).toContain(
      "<html",
    );
  });
});

/** A Purchase with a Quick Guide in Kim's Home, made as the Agent makes one; its phone link. */
async function kimsGuide(): Promise<string> {
  const { session } = await core.run(
    "open_session",
    { caller: { kind: "session" }, home: otherHome },
    { skill: "purchase" },
  );
  const as: CallContext = { caller: { kind: "session", session }, home: otherHome };
  await core.run("save_decision", as, {
    session,
    kind: "purchase",
    title: "Floor lamp",
    statement: "A floor lamp by the armchair.",
  });
  await core.run("save_guides", as, { session, decision: "floor-lamp", lookingFor: "A lamp" });
  const { phoneUrl } = await core.run("rotate_guide_link", other, {
    home: otherHome,
    decision: "floor-lamp",
  });
  return phoneUrl as string;
}

/** Kim's Home with a Blueprint (an upload and its rendered page) and a Photo of an Item. */
async function kimsFiles(): Promise<void> {
  await core.run("upload_blueprint", other, {
    home: otherHome,
    file: readFileSync(join(FIXTURE_FILES, "blueprint-a3.pdf")),
    fileName: "plan.pdf",
  });
  const { session } = await core.run(
    "open_session",
    { caller: { kind: "session" }, home: otherHome },
    { skill: "home-intake" },
  );
  await core.run(
    "save_items",
    { caller: { kind: "session", session }, home: otherHome },
    { session, items: [{ name: "Lamp", category: "lighting" }] },
  );
  await core.run("add_photo", other, { home: otherHome, item: "lamp", file: JPEG, thumb: JPEG });
  expect(existsSync(join(dataDir, "uploads", otherHome, "photos"))).toBe(true);
  expect(existsSync(join(dataDir, "rendered", otherHome))).toBe(true);
}

describe("deleting an Account", () => {
  it("needs the email typed again, then removes its Homes, every row, and their files", async () => {
    const kim = (other.caller as { account: number }).account;
    await kimsFiles();
    const wrong = await refusal(core.run("delete_account", other, { email: "kim@else.example" }));
    expect(wrong.message).toContain("exactly");

    await core.run("delete_account", other, { email: " KIM@example.com " });
    expect(core.homeToken(otherHome)).toBeUndefined();
    expect((await core.accounts.logIn("kim@example.com", TEST_PASSWORD)).outcome).toBe("wrong");
    const { accounts } = await core.run("list_accounts", admin, {});
    expect(accounts.map((each) => each.id)).not.toContain(kim);
    expect(existsSync(join(dataDir, "uploads", otherHome))).toBe(false);
    expect(existsSync(join(dataDir, "rendered", otherHome))).toBe(false);
    // Its slug is free again, and the Admin's Home is untouched.
    expect((await refusal(core.run("get_home", admin, { home: otherHome }))).code).toBe(
      "not_found",
    );
    expect((await core.run("get_home", admin, { home: fixture.home })).rooms).toHaveLength(5);
  });

  it("by the Admin, removes another Account's Homes and files the same way", async () => {
    const kim = (other.caller as { account: number }).account;
    await kimsFiles();
    const wrong = await refusal(
      core.run("admin_delete_account", admin, { account: kim, email: "lee@example.com" }),
    );
    expect(wrong.message).toContain("exactly");
    await core.run("admin_delete_account", admin, { account: kim, email: "kim@example.com" });
    expect(core.homeToken(otherHome)).toBeUndefined();
    expect(existsSync(join(dataDir, "uploads", otherHome))).toBe(false);
    expect(existsSync(join(dataDir, "rendered", otherHome))).toBe(false);
    expect((await core.run("list_accounts", admin, {})).accounts).toHaveLength(1);
  });
});

describe("the export", () => {
  it("is one zip of the Account's Homes: every row as JSON, and their uploaded files", async () => {
    await core.run("add_photo", admin, {
      home: fixture.home,
      item: "sofa",
      file: JPEG,
      thumb: JPEG,
    });
    const result = await core.run("export_account", admin, {});
    expect(result.fileName).toMatch(/^settle-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    const files = unzipSync(bytes);
    const names = Object.keys(files).sort();
    expect(names).toContain("account.json");
    expect(names).toContain("README.txt");
    expect(names).toContain(`homes/${fixture.home}.json`);
    expect(names).not.toContain(`homes/${otherHome}.json`);
    expect(names.filter((name) => name.startsWith(`uploads/${fixture.home}/photos/`))).toHaveLength(
      2,
    );
    expect(names.some((name) => name.startsWith("rendered/"))).toBe(false);
    expect(JSON.parse(strFromU8(files["account.json"] as Uint8Array))).toMatchObject({
      email: "fixture@example.com",
    });
    const rows = JSON.parse(strFromU8(files[`homes/${fixture.home}.json`] as Uint8Array));
    expect(rows.homes[0]).toMatchObject({ slug: fixture.home, name: "Fixture Home" });
    // The Home's key stays on the server.
    expect(rows.homes[0]).not.toHaveProperty("token");
    expect(rows.rooms).toHaveLength(5);
    expect(rows.change_log.length).toBeGreaterThan(10);
    expect(rows.sessions.length).toBeGreaterThan(0);
    const photo = rows.photos[0] as { path: string };
    expect(files[photo.path]).toEqual(JPEG);
  });
});

describe("rotating", () => {
  it("a Home's key cancels the old one", async () => {
    const before = core.homeToken(fixture.home);
    await core.run("rotate_home_key", admin, { home: fixture.home });
    const after = core.homeToken(fixture.home);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  it("a Quick Guide's link cancels the old link", async () => {
    const before = await phoneUrl();
    const { phoneUrl: after } = await core.run("rotate_guide_link", admin, {
      home: fixture.home,
      decision: "wool-rug",
    });
    expect(after).toMatch(new RegExp(`^${ORIGIN}/guide/`));
    expect(after).not.toBe(before);
    expect(await phoneUrl()).toBe(after);
    const guide = { caller: { kind: "guide" } } as const;
    const old = await refusal(core.run("get_guide_page", guide, { token: tokenOf(before) }));
    expect(old.code).toBe("not_found");
    const none = await refusal(
      core.run("rotate_guide_link", admin, { home: fixture.home, decision: "oak-bookcase" }),
    );
    expect(none.message).toContain("no Quick Guide");
  });
});
