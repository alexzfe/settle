// Who a Google sign-in reaches: the Account linked to its `sub`, always first; else, with an email
// Google has verified, an Account with that email and no password, linked from then on; else
// nothing. A password Account links Google only from its Account page, logged in. Only an
// invite link makes an Account with Google, and that Account has no password until it sets one.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LINK_MISS, NO_PASSWORD } from "./accounts.js";
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
  it("never links a password Account by its email alone: whoever set the email may not own it", () => {
    // Emails here are never confirmed: an invitee could have taken this one before its owner came.
    const result = core.accounts.googleLogIn(kimAtGoogle);
    expect(result).toEqual({ outcome: "has_password" });
    expect(store.account(kimId)?.googleSub).toBeNull();
  });

  it("links an Account with no password by Google's verified email, and logs it in", () => {
    store.update("accounts", kimId, { passwordHash: NO_PASSWORD });
    const result = core.accounts.googleLogIn(kimAtGoogle);
    expect(result).toMatchObject({
      outcome: "ok",
      account: { id: kimId, googleSub: "google-kim" },
    });
    expect(store.account(kimId)?.googleSub).toBe("google-kim");
  });

  it("matches on the sub first, so a changed Google email still logs in", () => {
    core.accounts.linkGoogle(kimId, kimAtGoogle);
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
    core.accounts.linkGoogle(kimId, kimAtGoogle);
    await core.run("disable_account", admin, { account: kimId });
    expect(core.accounts.googleLogIn(kimAtGoogle)).toEqual({ outcome: "disabled" });
    expect(core.accounts.googleLogIn({ ...kimAtGoogle, sub: "google-other" })).toEqual({
      outcome: "disabled",
    });
  });

  it("does not move an Account's link to another Google account with the same email", () => {
    core.accounts.linkGoogle(kimId, kimAtGoogle);
    const result = core.accounts.googleLogIn({ ...kimAtGoogle, sub: "google-impostor" });
    expect(result).toEqual({ outcome: "linked_elsewhere" });
    expect(store.account(kimId)?.googleSub).toBe("google-kim");
  });

  it("keeps each Google account to one Settle Account", () => {
    core.accounts.linkGoogle(kimId, kimAtGoogle);
    const samId = (admin.caller as { account: number }).account;
    expect(() => store.update("accounts", samId, { googleSub: "google-kim" })).toThrow(/UNIQUE/);
  });
});

describe("linkGoogle", () => {
  it("is offered on the Account page only when the server has Google sign-in on", async () => {
    const withGoogle = createCore({ passwordCost: TEST_PASSWORD_COST, googleSignIn: true });
    try {
      const as = await addAccount(withGoogle, "max@example.com");
      expect((await withGoogle.run("get_account", as, {})).account.googleSignIn).toBe(true);
    } finally {
      withGoogle.close();
    }
    expect((await core.run("get_account", admin, {})).account.googleSignIn).toBe(false);
  });

  it("links the Account logged in to the Google account it signed in with, whatever its email", async () => {
    const result = core.accounts.linkGoogle(kimId, {
      sub: "google-kim",
      email: "kim.personal@gmail.com",
      emailVerified: false,
    });
    expect(result).toEqual({ outcome: "ok" });
    expect(core.accounts.googleLogIn({ sub: "google-kim", emailVerified: false })).toMatchObject({
      outcome: "ok",
      account: { id: kimId },
    });
    // From then on it can use either.
    expect((await core.accounts.logIn("kim@example.com", TEST_PASSWORD)).outcome).toBe("ok");
    // Again, with the same one, changes nothing.
    expect(core.accounts.linkGoogle(kimId, kimAtGoogle)).toEqual({ outcome: "ok" });
  });

  it("refuses a Google account another Account is linked to, and moves no link", () => {
    const samId = (admin.caller as { account: number }).account;
    core.accounts.linkGoogle(samId, kimAtGoogle);
    expect(core.accounts.linkGoogle(kimId, kimAtGoogle)).toEqual({ outcome: "linked_elsewhere" });
    expect(store.account(kimId)?.googleSub).toBeNull();
    expect(store.account(samId)?.googleSub).toBe("google-kim");
  });

  it("never replaces the Google account an Account is linked to: any Login could start a link", () => {
    core.accounts.linkGoogle(kimId, kimAtGoogle);
    const other = { sub: "google-someone-else", email: "x@gmail.com", emailVerified: true };
    expect(core.accounts.linkGoogle(kimId, other)).toEqual({ outcome: "already_linked" });
    expect(store.account(kimId)?.googleSub).toBe("google-kim");
  });

  it("is undone by a password reset, which assumes someone else knew the password", async () => {
    core.accounts.linkGoogle(kimId, { sub: "google-intruder", emailVerified: false });
    const { reset } = await core.run("create_reset_link", admin, { account: kimId });
    const token = reset.url.slice(reset.url.lastIndexOf("/") + 1);
    await core.accounts.redeem("reset", token, { password: `${TEST_PASSWORD}-new` });
    expect(store.account(kimId)?.googleSub).toBeNull();
    expect(core.accounts.googleLogIn({ sub: "google-intruder", emailVerified: false })).toEqual({
      outcome: "unknown",
    });
    // The owner can link their own Google account again.
    expect(core.accounts.linkGoogle(kimId, kimAtGoogle)).toEqual({ outcome: "ok" });
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
    core.accounts.linkGoogle(kimId, kimAtGoogle);
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
