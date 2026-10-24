import { join } from "node:path";
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { z } from "zod";
import {
  cleanEmail,
  hashPassword,
  hasPassword,
  INVITE_MS,
  insertLink,
  newToken,
  passwordMatches,
  passwordProblem,
  RESET_MS,
} from "../accounts.js";
import { CoreError } from "../errors.js";
import { optional } from "../optional.js";
import { defineOperation, type OperationContext } from "../registry.js";
import type { AccountRow, HomeRow } from "../store.js";
import { randomToken } from "../token.js";
import { loadDecisions } from "./decisions.js";
import { guideOf } from "./purchase-views.js";
import { requirePurchase } from "./purchases.js";
import { homeInput, requireAccount, requireAdmin, requireHome } from "./scope.js";

// The Account page's operations, for the Account logged in, and the Admin page's, for the Admin.
// All are the web UI's alone. None of the Admin's reaches inside another Account's Homes: an
// Account is listed by its email, dates, and how many Homes it has, and nothing more.

export interface AccountSummary {
  email: string;
  admin: boolean;
  createdAt: string;
  /** False for an Account made with Google that has not set a password. */
  password: boolean;
  /** Whether a Google account is linked to it, to log in with. */
  google: boolean;
}

export interface LoginSummary {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent?: string;
  /** The Login this call came from. */
  current: boolean;
}

export interface InviteSummary {
  id: number;
  createdAt: string;
  expiresAt: string;
}

/** A link just made: the only time its token is shown, since only its hash is stored. */
export interface MadeLink {
  url: string;
  expiresAt: string;
}

export interface AccountListEntry {
  id: number;
  email: string;
  admin: boolean;
  createdAt: string;
  disabledAt?: string;
  homes: number;
}

export interface AccountExport {
  fileName: string;
  mimeType: "application/zip";
  /** The zip, made as it is read, so a large export is never held in memory whole. */
  stream: ReadableStream<Uint8Array>;
}

const passwordInput = z.string().describe("The Account's password as it is now.");
const accountIdInput = z
  .number()
  .int()
  .positive()
  .describe("The Account's id, from list_accounts.");

export const getAccount = defineOperation({
  name: "get_account",
  description:
    "The Account logged in: its email, whether it is the Admin, when it was made, whether it has " +
    "a password, and whether a Google account is linked to it.",
  input: z.object({}),
  readOnly: true,
  surface: "web",
  handler(context): { account: AccountSummary } {
    return { account: summaryOf(requireAccount(context)) };
  },
});

export const changePassword = defineOperation({
  name: "change_password",
  description:
    "Changes the password of the Account logged in, given the current one, and ends every other " +
    "Login of it, so a browser that had the old password is logged out. An Account made with " +
    "Google sets its first password this way, with no current one.",
  input: z.object({
    current: passwordInput.optional(),
    password: z.string().describe("The new password: 12 to 256 characters, nothing else asked."),
  }),
  readOnly: false,
  surface: "web",
  async handler(context, input): Promise<Record<string, never>> {
    const account = requireAccount(context);
    if (hasPassword(account)) await requirePassword(account, input.current ?? "");
    const problem = passwordProblem(input.password);
    if (problem) throw new CoreError("validation", problem);
    const passwordHash = await hashPassword(input.password, context.passwordCost);
    context.store.transaction(() => {
      context.store.update("accounts", account.id, { passwordHash });
      context.store.deleteLogins(account.id, loginOf(context));
    });
    return {};
  },
});

export const changeEmail = defineOperation({
  name: "change_email",
  description: "Changes the email of the Account logged in, given its password. No email is sent.",
  input: z.object({ email: z.string(), password: passwordInput }),
  readOnly: false,
  surface: "web",
  async handler(context, input): Promise<{ account: AccountSummary }> {
    const account = requireAccount(context);
    const email = cleanEmail(input.email);
    if (!hasPassword(account)) {
      throw new CoreError(
        "validation",
        "This account has no password yet, and changing its email needs one. Set a password first.",
      );
    }
    await requirePassword(account, input.password);
    const taken = context.store.accountByEmail(email);
    if (taken && taken.id !== account.id) {
      throw new CoreError("validation", "Another account already uses that email.");
    }
    context.store.update("accounts", account.id, { email });
    return { account: summaryOf({ ...account, email }) };
  },
});

export const listLogins = defineOperation({
  name: "list_logins",
  description: "The Logins of the Account logged in, newest first: one per browser logged in.",
  input: z.object({}),
  readOnly: true,
  surface: "web",
  handler(context): { logins: LoginSummary[] } {
    const account = requireAccount(context);
    const now = context.now();
    const current = loginOf(context);
    return {
      logins: context.store
        .logins(account.id)
        .filter((login) => login.expiresAt > now)
        .map((login) => ({
          id: login.id,
          createdAt: login.createdAt,
          lastSeenAt: login.lastSeenAt,
          expiresAt: login.expiresAt,
          ...optional({ userAgent: login.userAgent }),
          current: login.id === current,
        })),
    };
  },
});

export const endLogins = defineOperation({
  name: "end_logins",
  description:
    "Ends every Login of the Account logged in, this one included, and every Connection: " +
    "everywhere logs out, and Claude is disconnected.",
  input: z.object({}),
  readOnly: false,
  surface: "web",
  handler(context): Record<string, never> {
    const account = requireAccount(context);
    context.store.transaction(() => {
      context.store.deleteLogins(account.id);
      context.store.deleteConnections(account.id);
    });
    return {};
  },
});

export const exportAccount = defineOperation({
  name: "export_account",
  description:
    "Everything in the Homes of the Account logged in, as one .zip: every row of each Home as " +
    "JSON, and the files uploaded to it (Blueprints, Listing pictures, Photos, Documents).",
  input: z.object({}),
  readOnly: true,
  surface: "web",
  handler(context): AccountExport {
    const account = requireAccount(context);
    const day = context.now().slice(0, 10);
    return {
      fileName: `settle-export-${day}.zip`,
      mimeType: "application/zip",
      stream: zipAccount(context, account),
    };
  },
});

export const deleteAccount = defineOperation({
  name: "delete_account",
  description:
    "Deletes the Account logged in, for good: its Homes, every row of them, and their files. " +
    "The input repeats the Account's email, as a check. The Admin can't delete their own.",
  input: z.object({ email: z.string().describe("The Account's email, typed again.") }),
  readOnly: false,
  surface: "web",
  handler(context, input): Record<string, never> {
    const account = requireAccount(context);
    if (input.email.trim().toLowerCase() !== account.email.toLowerCase()) {
      throw new CoreError("validation", "Type this account's email exactly, to delete it.");
    }
    if (account.admin) {
      throw new CoreError(
        "validation",
        "The Admin's account can't be deleted: the server would be left with nobody to run it.",
      );
    }
    removeAccount(context, account);
    return {};
  },
});

export const createInvite = defineOperation({
  name: "create_invite",
  description:
    "Makes an invite: a link that lets one person make an Account, once, within 7 days. The " +
    "link is shown only now.",
  input: z.object({}),
  readOnly: false,
  surface: "web",
  handler(context): { invite: MadeLink } {
    const admin = requireAdmin(context);
    const token = newToken();
    const link = insertLink(context.store, {
      kind: "invite",
      token,
      at: new Date(context.now()),
      lasts: INVITE_MS,
      madeBy: admin.id,
    });
    return { invite: { url: `${context.origin}/invite/${token}`, expiresAt: link.expiresAt } };
  },
});

export const listInvites = defineOperation({
  name: "list_invites",
  description: "The invites not yet used, expired, or cancelled, newest first.",
  input: z.object({}),
  readOnly: true,
  surface: "web",
  handler(context): { invites: InviteSummary[] } {
    requireAdmin(context);
    const now = context.now();
    return {
      invites: context.store
        .accountLinks("invite")
        .filter((link) => link.usedAt === null && link.expiresAt > now)
        .map(({ id, createdAt, expiresAt }) => ({ id, createdAt, expiresAt })),
    };
  },
});

export const cancelInvite = defineOperation({
  name: "cancel_invite",
  description: "Cancels an invite not yet used: its link stops working.",
  input: z.object({ invite: z.number().int().positive().describe("The invite's id.") }),
  readOnly: false,
  surface: "web",
  handler(context, input): Record<string, never> {
    requireAdmin(context);
    const invite = context.store.accountLinks("invite").find((link) => link.id === input.invite);
    if (!invite || invite.usedAt !== null) {
      throw new CoreError("not_found", "There is no such invite waiting to be used.");
    }
    context.store.deleteAccountLink(invite.id);
    return {};
  },
});

export const createResetLink = defineOperation({
  name: "create_reset_link",
  description:
    "Makes a reset link for another Account: it sets a new password once, within 24 hours, and " +
    "ends every Login of that Account. Any earlier reset link of it stops working. Shown only now.",
  input: z.object({ account: accountIdInput }),
  readOnly: false,
  surface: "web",
  handler(context, input): { reset: MadeLink } {
    const admin = requireAdmin(context);
    const account = otherAccount(context, admin, input.account, "make a reset link for");
    const token = newToken();
    const link = context.store.transaction(() => {
      for (const old of context.store.accountLinks("reset")) {
        if (old.accountId === account.id) context.store.deleteAccountLink(old.id);
      }
      return insertLink(context.store, {
        kind: "reset",
        token,
        at: new Date(context.now()),
        lasts: RESET_MS,
        accountId: account.id,
        madeBy: admin.id,
      });
    });
    return { reset: { url: `${context.origin}/reset/${token}`, expiresAt: link.expiresAt } };
  },
});

export const listAccounts = defineOperation({
  name: "list_accounts",
  description:
    "Every Account on the server: its email, when it was made, whether it is disabled, and how " +
    "many Homes it has. Nothing from inside them.",
  input: z.object({}),
  readOnly: true,
  surface: "web",
  handler(context): { accounts: AccountListEntry[] } {
    requireAdmin(context);
    return {
      accounts: context.store.accounts().map((account) => ({
        id: account.id,
        email: account.email,
        admin: account.admin,
        createdAt: account.createdAt,
        ...optional({ disabledAt: account.disabledAt }),
        homes: context.store.homesOf(account.id).length,
      })),
    };
  },
});

export const disableAccount = defineOperation({
  name: "disable_account",
  description:
    "Disables another Account at once: every Login and Connection of it ends, its Homes' keys " +
    "and Quick Guide links stop working, and nothing is deleted. enable_account undoes it, " +
    "but its Connections stay ended: Claude has to be connected again.",
  input: z.object({ account: accountIdInput }),
  readOnly: false,
  surface: "web",
  handler(context, input): Record<string, never> {
    const admin = requireAdmin(context);
    const account = otherAccount(context, admin, input.account, "disable");
    context.store.transaction(() => {
      if (account.disabledAt === null) {
        context.store.update("accounts", account.id, { disabledAt: context.now() });
      }
      context.store.deleteLogins(account.id);
      context.store.deleteConnections(account.id);
    });
    return {};
  },
});

export const enableAccount = defineOperation({
  name: "enable_account",
  description: "Enables a disabled Account again: it can log in, and its keys and links work.",
  input: z.object({ account: accountIdInput }),
  readOnly: false,
  surface: "web",
  handler(context, input): Record<string, never> {
    const admin = requireAdmin(context);
    const account = otherAccount(context, admin, input.account, "enable");
    context.store.update("accounts", account.id, { disabledAt: null });
    return {};
  },
});

export const adminDeleteAccount = defineOperation({
  name: "admin_delete_account",
  description:
    "Deletes another Account for good: its Homes, every row of them, and their files. The " +
    "input repeats the Account's email, as a check.",
  input: z.object({
    account: accountIdInput,
    email: z.string().describe("The Account's email, typed again."),
  }),
  readOnly: false,
  surface: "web",
  handler(context, input): Record<string, never> {
    const admin = requireAdmin(context);
    const account = otherAccount(context, admin, input.account, "delete");
    if (input.email.trim().toLowerCase() !== account.email.toLowerCase()) {
      throw new CoreError("validation", "Type that account's email exactly, to delete it.");
    }
    removeAccount(context, account);
    return {};
  },
});

export const rotateHomeKey = defineOperation({
  name: "rotate_home_key",
  description:
    "Gives the Home a new key and cancels the old one: the Agent's .mcp.json stops working " +
    "until the Home Folder command is run again in its folder.",
  input: z.object({ home: homeInput }),
  readOnly: false,
  surface: "web",
  handler(context): Record<string, never> {
    const home = requireHome(context);
    context.store.update("homes", home.id, { token: randomToken(context.random) });
    return {};
  },
});

export const rotateGuideLink = defineOperation({
  name: "rotate_guide_link",
  description:
    "Gives a Purchase's Quick Guide a new phone link and cancels the old one: the old link and " +
    "its QR code stop working.",
  input: z.object({
    home: homeInput,
    decision: z.string().min(1).describe("The Purchase's slug."),
  }),
  readOnly: false,
  surface: "web",
  handler(context, input): { phoneUrl?: string } {
    const home = requireHome(context);
    const model = loadDecisions(context.store, home);
    const decision = requirePurchase(model, input.decision, "Quick Guides");
    const guide = guideOf(model, decision);
    if (!guide) {
      throw new CoreError("not_found", "This Purchase has no Quick Guide yet, so no link.");
    }
    const lanToken = randomToken(context.random);
    context.store.update("guides", guide.id, { lanToken });
    const phoneOrigin = context.publicOrigin ?? context.lanUrl;
    return optional({ phoneUrl: phoneOrigin && `${phoneOrigin}/guide/${lanToken}` });
  },
});

function summaryOf(account: AccountRow): AccountSummary {
  const { email, admin, createdAt } = account;
  return {
    email,
    admin,
    createdAt,
    password: hasPassword(account),
    google: account.googleSub !== null,
  };
}

/** The current password, or a refusal. */
async function requirePassword(account: AccountRow, password: string): Promise<void> {
  if (!(await passwordMatches(password, account.passwordHash))) {
    throw new CoreError("validation", "That is not this account's password.");
  }
}

/** The Login the web call came from, if the server said. */
function loginOf(context: OperationContext): number | undefined {
  return context.caller.kind === "web" ? context.caller.login : undefined;
}

/** Another Account than the Admin's own: the Admin never acts on themselves from here. */
function otherAccount(
  context: OperationContext,
  admin: AccountRow,
  id: number,
  verb: string,
): AccountRow {
  const account = context.store.account(id);
  if (!account) throw new CoreError("not_found", "There is no such account.");
  if (account.id === admin.id) {
    throw new CoreError(
      "validation",
      `You can't ${verb} your own account from here. Your Account page has what you can change.`,
    );
  }
  return account;
}

/** Deletes an Account, its Homes and their rows, then their files under uploads/ and rendered/. */
function removeAccount(context: OperationContext, account: AccountRow): void {
  const { store } = context;
  const homes = store.homesOf(account.id);
  store.transaction(() => {
    for (const home of homes) store.deleteHome(home.id);
    store.deleteAccount(account.id);
  });
  // Last, so a failure above leaves the files with the rows the rollback keeps.
  for (const home of homes) {
    for (const folder of homeFolders(home)) context.files.remove(join(context.dataDir(), folder));
  }
}

/** Where a Home's files are, under the data dir: its uploads, and its rendered Blueprint pages. */
function homeFolders(home: HomeRow): string[] {
  return [join("uploads", home.slug), join("rendered", home.slug)];
}

// Stored already compressed, so not compressed again.
const STORED = /\.(jpe?g|png|webp|heic|pdf|zip)$/i;

/**
 * The export, made one entry per read: account.json; for each Home, homes/<slug>.json with
 * every row of it by table (the Home's key left out), and its uploads at the paths those rows
 * name. rendered/ is left out: it is a cache, made again from the uploads.
 */
function zipAccount(context: OperationContext, account: AccountRow): ReadableStream<Uint8Array> {
  const { store, files } = context;
  const homes = store.homesOf(account.id);
  const entries: (() => [string, Uint8Array] | undefined)[] = [
    () => [
      "account.json",
      json({ email: account.email, createdAt: account.createdAt, exportedAt: context.now() }),
    ],
    () => ["README.txt", strToU8(README)],
  ];
  for (const home of homes) {
    entries.push(() => {
      const rows = store.homeRows(home.id);
      rows.homes = (rows.homes ?? []).map(({ token: _token, account_id: _account, ...row }) => row);
      return [`homes/${home.slug}.json`, json(rows)];
    });
    const uploads = join("uploads", home.slug);
    for (const file of files.list(join(context.dataDir(), uploads))) {
      const path = join(uploads, file);
      entries.push(() => {
        const bytes = files.readBytes(join(context.dataDir(), path));
        return bytes && [path, bytes];
      });
    }
  }
  let next = 0;
  let zip: Zip;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((error, chunk, final) => {
        if (error) return controller.error(error);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    // One entry per read, so the reader's pace sets how much is in memory.
    pull() {
      while (next < entries.length) {
        const entry = (entries[next++] as () => [string, Uint8Array] | undefined)();
        if (!entry) continue;
        const [name, bytes] = entry;
        const file = STORED.test(name) ? new ZipPassThrough(name) : new ZipDeflate(name);
        zip.add(file);
        file.push(bytes, true);
        return;
      }
      zip.end();
    },
  });
}

function json(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

const README = `This is everything Settle held for your account when you exported it.

account.json      your account's email and when it was made
homes/<home>.json every row of each Home, by table, as the database stores it
uploads/<home>/   the files of each Home: Blueprints, Listing pictures, Photos and Documents,
                  at the paths the rows name
`;
