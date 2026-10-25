// Who a Google sign-in reaches: the Account linked to its `sub`, always first; else, with an email
// Google has verified, the Account with that email, linked from then on; else nothing. Only an
// invite link makes an Account with Google, and that Account has no password until it sets one.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LINK_MISS } from "./accounts.js";
import { type CallContext, type Core, createCore } from "./core.js";
import { CoreError } from "./errors.js";
import { addAccount, TEST_PASSWORD, TEST_PASSWORD_COST } from "./fixture/fixture-home.js";
import { openStore, type Store } from "./store.js";

let store: Store;
let core: Core;
let admin: CallContext;
let kimId: number;

beforeEach(async () => {
  store = openStore(":memory:");
  core = createCore({
    store,
    publicOrigin: "https://settle.example.com",
    passwordCost: TEST_PASSWORD_COST,
  });
  admin = await addAccount(core, "sam@example.com");
  kimId = ((await addAccount(core, "kim@example.com")).caller as { account: number }).account;
});
afterEach(() => core.close());

const kimAtGoogle = { sub: "google-kim", email: "kim@example.com", emailVerified: true };

async function inviteToken(): Promise<string> {
  const { invite } = await core.run("create_invite", admin, {});
  return invite.url.slice(invite.url.lastIndexOf("/") + 1);
}

function refusal(run: () => unknown): CoreError {
  try {
    run();
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected a refusal");
}

describe("googleLogIn", () => {
  it("links a password Account whose email is Google's verified one, and logs it in", async () => {
    const result = core.accounts.googleLogIn(kimAtGoogle);
    expect(result).toMatchObject({
      outcome: "ok",
      account: { id: kimId, googleSub: "google-kim" },
    });
    expect(store.account(kimId)?.googleSub).toBe("google-kim");
    // From then on it can use either.
    expect((await core.accounts.logIn("kim@example.com", TEST_PASSWORD)).outcome).toBe("ok");
  });

  it("matches on the sub first, so a changed Google email still logs in", () => {
    core.accounts.googleLogIn(kimAtGoogle);
    const result = core.accounts.googleLogIn({
      sub: "google-kim",
      email: "kim.new@gmail.com",
      emailVerified: true,
    });
    expect(result).toMatchObject({ outcome: "ok", account: { id: kimId } });
    // Its Settle email stays as it was.
    expect(store.account(kimId)?.email).toBe("kim@example.com");
  });

  it("never trusts an email Google hasn't verified", () => {
    const result = core.accounts.googleLogIn({ ...kimAtGoogle, emailVerified: false });
    expect(result).toEqual({ outcome: "unknown" });
    expect(store.account(kimId)?.googleSub).toBeNull();
    expect(core.accounts.googleLogIn({ sub: "google-kim", emailVerified: true })).toEqual({
      outcome: "unknown",
    });
  });

  it("refuses an email with no Account, and makes none", () => {
    const before = core.accounts.count();
    const result = core.accounts.googleLogIn({
      sub: "google-stranger",
      email: "stranger@example.com",
      emailVerified: true,
    });
    expect(result).toEqual({ outcome: "unknown" });
    expect(core.accounts.count()).toBe(before);
    expect(store.accountByGoogle("google-stranger")).toBeUndefined();
  });

  it("refuses a disabled Account, by email or by sub", async () => {
    core.accounts.googleLogIn(kimAtGoogle);
    await core.run("disable_account", admin, { account: kimId });
    expect(core.accounts.googleLogIn(kimAtGoogle)).toEqual({ outcome: "disabled" });
    expect(core.accounts.googleLogIn({ ...kimAtGoogle, sub: "google-other" })).toEqual({
      outcome: "disabled",
    });
  });

  it("does not move an Account's link to another Google account with the same email", () => {
    core.accounts.googleLogIn(kimAtGoogle);
    const result = core.accounts.googleLogIn({ ...kimAtGoogle, sub: "google-impostor" });
    expect(result).toEqual({ outcome: "linked_elsewhere" });
    expect(store.account(kimId)?.googleSub).toBe("google-kim");
  });

  it("keeps each Google account to one Settle Account", () => {
    core.accounts.googleLogIn(kimAtGoogle);
    const samId = (admin.caller as { account: number }).account;
    expect(() => store.update("accounts", samId, { googleSub: "google-kim" })).toThrow(/UNIQUE/);
  });
});

describe("redeemWithGoogle", () => {
  const leo = { sub: "google-leo", email: "leo@gmail.com", emailVerified: true };

  it("makes an Account from an invite with Google's verified email, linked, with no password", async () => {
    const token = await inviteToken();
    const account = core.accounts.redeemWithGoogle(token, leo);
    expect(account).toMatchObject({
      email: "leo@gmail.com",
      admin: false,
      googleSub: "google-leo",
    });
    expect(core.accounts.linkOpen("invite", token)).toBe(false);
    // No password: none logs in, the empty one included.
    expect((await core.accounts.logIn("leo@gmail.com", "")).outcome).toBe("wrong");
    expect(core.accounts.googleLogIn(leo)).toMatchObject({ outcome: "ok" });

    const as: CallContext = { caller: { kind: "web", account: account.id } };
    expect((await core.run("get_account", as, {})).account).toMatchObject({
      password: false,
      google: true,
    });
    // Setting the first password needs no current one; after that it does.
    await core.run("change_password", as, { password: "a first password for leo" });
    expect((await core.accounts.logIn("leo@gmail.com", "a first password for leo")).outcome).toBe(
      "ok",
    );
    await expect(
      core.run("change_password", as, { password: "another password here" }),
    ).rejects.toThrow(/not this account's password/);
  });

  it("refuses to change the email of an Account with no password", async () => {
    const account = core.accounts.redeemWithGoogle(await inviteToken(), leo);
    const as: CallContext = { caller: { kind: "web", account: account.id } };
    await expect(
      core.run("change_email", as, { email: "leo@example.com", password: "" }),
    ).rejects.toThrow(/Set a password first/);
  });

  it("refuses an unverified email, and leaves the invite unused", async () => {
    const token = await inviteToken();
    const error = refusal(() =>
      core.accounts.redeemWithGoogle(token, { ...leo, emailVerified: false }),
    );
    expect(error.code).toBe("validation");
    expect(core.accounts.linkOpen("invite", token)).toBe(true);
  });

  it("refuses a Google account or an email that already has an Account", async () => {
    core.accounts.googleLogIn(kimAtGoogle);
    const token = await inviteToken();
    const linked = refusal(() =>
      core.accounts.redeemWithGoogle(token, { ...kimAtGoogle, email: "kim2@gmail.com" }),
    );
    expect(linked.message).toContain("Log in with Google instead");
    const taken = refusal(() =>
      core.accounts.redeemWithGoogle(token, { ...kimAtGoogle, sub: "google-kim-2" }),
    );
    expect(taken.message).toContain("already an account with that email");
    expect(core.accounts.linkOpen("invite", token)).toBe(true);
  });

  it("refuses a used, cancelled or made-up invite, and a setup or reset link", async () => {
    const token = await inviteToken();
    core.accounts.redeemWithGoogle(token, leo);
    for (const bad of [token, "made-up"]) {
      const error = refusal(() =>
        core.accounts.redeemWithGoogle(bad, { ...leo, sub: "google-x", email: "x@gmail.com" }),
      );
      expect(error).toMatchObject({ code: "not_found", message: LINK_MISS });
    }
    const { reset } = await core.run("create_reset_link", admin, { account: kimId });
    const resetToken = reset.url.slice(reset.url.lastIndexOf("/") + 1);
    expect(
      refusal(() =>
        core.accounts.redeemWithGoogle(resetToken, {
          ...leo,
          sub: "google-y",
          email: "y@gmail.com",
        }),
      ).code,
    ).toBe("not_found");
  });
});
