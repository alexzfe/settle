// The server-enforced Listing board rules, beside the other Purchase rules of slice 6: the
// Rating and its mandatory reason line, the picture the platform fetches and stores, Held, and
// the board's own writes — drop, hold, and the paste box. Those are the first writes on Listings
// the web can make; until them only the Agent wrote Listings, and the shift is deliberate.
//
// The image fetch is a port on OperationContext, so every test here injects its own: no test
// reaches the network. What the real one does is in images.test.ts.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import { nodeFileStore } from "./files.js";
import { addAccount, TEST_PASSWORD_COST } from "./fixture/fixture-home.js";
import type { FetchedImage } from "./images.js";
import type { DecisionDetail, Listing } from "./operations/schemas.js";

let web: CallContext;

const JPEG = image([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46], "image/jpeg");
const PNG = image([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png");
const JPEG_2 = image([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78], "image/jpeg");
const WEBP = image([0x52, 0x49, 0x46, 0x46, 0x20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], "image/webp");

function image(signature: number[], type: FetchedImage["type"]): FetchedImage {
  const bytes = new Uint8Array(64);
  bytes.set(signature);
  // Enough of a difference for two fixtures to hash apart.
  bytes[60] = signature[0] as number;
  return { bytes, type };
}

/** What the injected fetcher answers, by URL: an image, or a failure to swallow. */
let answers: Map<string, FetchedImage | Error>;
let fetched: string[];

/** The clock, movable so a test can come back to a hold on a later day. */
let now: string;
/** Called with each path, relative to the data dir, as the file store removes it. */
let onRemove: ((path: string) => void) | undefined;
let dataDir: string;
let core: Core;
let home: string;
let session: string;
const agent = (id?: string): CallContext => ({ caller: { kind: "session", session: id }, home });

beforeEach(async () => {
  answers = new Map();
  fetched = [];
  now = "2026-09-17T10:00:00.000Z";
  onRemove = undefined;
  dataDir = mkdtempSync(join(tmpdir(), "settle-listings-"));
  core = createCore({
    passwordCost: TEST_PASSWORD_COST,
    dataDir,
    // A file, so a second connection can see what is committed and fail a write on purpose.
    database: join(dataDir, "settle.db"),
    files: {
      ...nodeFileStore,
      remove(path) {
        onRemove?.(relative(dataDir, path));
        nodeFileStore.remove(path);
      },
    },
    clock: () => new Date(now),
    async fetchImage(url) {
      fetched.push(url);
      const answer = answers.get(url);
      if (answer === undefined) throw new CoreError("validation", `Nothing serves ${url}.`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  web = await addAccount(core);
  home = (await core.run("create_home", web, { name: "My flat", country: "GB", city: "London" }))
    .home.slug;
  session = (
    await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "purchase" })
  ).session;
  await core.run("save_room", agent(session), { session, name: "Living room" });
  await core.run("set_constraints", agent(session), { session, add: ["Two cats"] });
  await core.run("save_decision", agent(session), {
    session,
    kind: "purchase",
    room: "living-room",
    title: "Wool rug",
    statement: "A large wool rug.",
    requirements: [
      { text: "At least 2.0 m wide", strength: "must", reason: cats },
      { text: "Wool", strength: "must", reason: cats },
      { text: "Low pile", strength: "prefer", reason: cats },
    ],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  core.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const cats = { kind: "constraint" as const, id: "two-cats" };

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

type ListingInput = Omit<OperationInput<"record_listing">, "session" | "decision">;

const checks: NonNullable<ListingInput["checks"]> = [
  { requirement: 1, result: "pass", note: "2.4 m" },
  { requirement: 2, result: "pass", note: "wool" },
  { requirement: 3, result: "pass" },
];

async function listing(input: ListingInput): Promise<string> {
  return (
    await core.run("record_listing", agent(session), {
      session,
      decision: "wool-rug",
      ...input,
    })
  ).receipt;
}

const hay = (extra: ListingInput = {}): ListingInput => ({
  name: "Hay Plain rug",
  price: "£450",
  checks,
  ...extra,
});

async function detail(decision = "wool-rug"): Promise<DecisionDetail> {
  return (await core.run("get_decision", web, { home, decision })).decision;
}

async function listings(decision = "wool-rug"): Promise<Listing[]> {
  return (await detail(decision)).listings;
}

/** get_decision as the Agent reads it: the only place a hold or a Rating reaches it. */
async function decisionText(decision = "wool-rug"): Promise<string> {
  const operation = core.operations.find((each) => each.name === "get_decision");
  const output = await core.run("get_decision", agent(session), { session, decision });
  return operation?.text?.(output) ?? "";
}

async function changes(): Promise<{ field: string | null; old: unknown; new: unknown }[]> {
  const { changes: all } = await core.run("get_change_log", web, { home });
  return all as unknown as { field: string | null; old: unknown; new: unknown }[];
}

const listingsDir = () => join(dataDir, "uploads", home, "listings");
/** The Listing pictures on disk, by file name. */
const pictures = () => (existsSync(listingsDir()) ? readdirSync(listingsDir()).sort() : []);

/** The Listings' picture paths as committed, read over a second connection. */
function committedPhotoPaths(): string[] {
  const db = new DatabaseSync(join(dataDir, "settle.db"), { readOnly: true });
  try {
    return db
      .prepare("SELECT photo_path FROM listings WHERE photo_path IS NOT NULL ORDER BY id")
      .all()
      .map((row) => row.photo_path as string);
  } finally {
    db.close();
  }
}

/** Fails every change-log write, as a full disk would, until the answer is called. */
function failWrites(): () => void {
  const db = new DatabaseSync(join(dataDir, "settle.db"));
  db.exec(
    "CREATE TRIGGER fail_writes BEFORE INSERT ON change_log " +
      "BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  );
  return () => {
    db.exec("DROP TRIGGER fail_writes");
    db.close();
  };
}

/** Each removal, with the picture paths committed at that moment. */
function watchRemovals(): { path: string; committed: string[] }[] {
  const removals: { path: string; committed: string[] }[] = [];
  onRemove = (path) => removals.push({ path, committed: committedPhotoPaths() });
  return removals;
}

describe("the Rating", () => {
  it("is recorded with its reason line and shown to the Agent, whole stars out of five", async () => {
    const receipt = await listing(
      hay({ rating: 4, ratingNote: "Right size and real wool, but £120 over the others" }),
    );
    expect(receipt).toContain(
      "added: Hay Plain rug (hay-plain-rug), £450, rated 4/5 (Right size and real wool, but " +
        "£120 over the others): 3 pass, 0 fail, 0 unknown",
    );
    expect(await listings()).toMatchObject([
      { rating: 4, ratingNote: "Right size and real wool, but £120 over the others" },
    ]);
  });

  it("is refused without its reason line, recording nothing, because a star alone is a vibe", async () => {
    const error = await refusal(listing(hay({ rating: 4 })));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("ratingNote");
    expect(await listings()).toEqual([]);

    await listing(hay({ rating: 4, ratingNote: "Lovely, pricey" }));
    // Neither can the note be taken away from a Listing that has stars.
    await listing({ listing: "hay-plain-rug", price: "£400" });
    expect((await listings())[0]).toMatchObject({ rating: 4, ratingNote: "Lovely, pricey" });
  });

  it("can be changed on its own, with no checks resent", async () => {
    await listing(hay({ rating: 3, ratingNote: "Fine, nothing special" }));
    const receipt = await listing({
      listing: "hay-plain-rug",
      rating: 5,
      ratingNote: "Saw it in daylight: the colour is right after all",
    });
    expect(receipt).toContain("changed: Hay Plain rug (hay-plain-rug)");
    const [recorded] = await listings();
    expect(recorded).toMatchObject({ rating: 5, counts: { pass: 3, fail: 0, unknown: 0 } });
  });

  it("is never capped, gated, or reordered by a failed must: stars say how good, checks say whether allowed", async () => {
    await listing(hay({ rating: 4, ratingNote: "Right size, real wool, pricey" }));
    await listing({
      name: "Jute loop rug",
      price: "£120",
      rating: 5,
      ratingNote: "Exactly the terracotta wanted, and a third of the price",
      checks: [
        { requirement: 1, result: "fail", note: "1.2 m" },
        { requirement: 2, result: "fail", note: "jute" },
        { requirement: 3, result: "pass" },
      ],
    });

    const recorded = await listings();
    // Recorded order, untouched: core never sorts Listings, the board does.
    expect(recorded.map((each) => [each.slug, each.rating, each.failedMusts])).toEqual([
      ["hay-plain-rug", 4, []],
      ["jute-loop-rug", 5, [1, 2]],
    ]);
    expect(await decisionText()).toContain(
      "- Jute loop rug (jute-loop-rug), £120, rated 5/5 (Exactly the terracotta wanted, and a " +
        "third of the price): 1 pass, 2 fail, 0 unknown; fails must 1 (At least 2.0 m wide), " +
        "2 (Wool)",
    );
  });
});

describe("the picture", () => {
  it("is fetched, stored under the data dir, and served back with the type sniffed from its bytes", async () => {
    answers.set("https://media.example.pe/falabellaPE/1_01/public", WEBP);
    await listing(hay({ photoUrl: "https://media.example.pe/falabellaPE/1_01/public" }));

    const [recorded] = await listings();
    expect(recorded?.photoUrl).toBe("https://media.example.pe/falabellaPE/1_01/public");
    expect(recorded?.photoVersion).toMatch(/^[0-9a-f]{16}$/);
    // The URL has no extension at all; the bytes say WebP, so the stored copy is a .webp, named
    // for its version so new bytes never overwrite it.
    const name = `hay-plain-rug-${recorded?.photoVersion}.webp`;
    expect(pictures()).toEqual([name]);
    expect(new Uint8Array(readFileSync(join(listingsDir(), name)))).toEqual(WEBP.bytes);

    const served = await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" });
    expect(served.mimeType).toBe("image/webp");
    expect(served.data).toEqual(WEBP.bytes);
  });

  it("changes its version when the bytes change, and only then", async () => {
    answers.set("https://shop.example/a.jpg", JPEG);
    answers.set("https://shop.example/b.png", PNG);
    await listing(hay({ photoUrl: "https://shop.example/a.jpg" }));
    const first = (await listings())[0]?.photoVersion;

    // The same URL again: nothing is refetched, and the version stands.
    await listing({ listing: "hay-plain-rug", photoUrl: "https://shop.example/a.jpg" });
    expect(fetched).toEqual(["https://shop.example/a.jpg"]);
    expect((await listings())[0]?.photoVersion).toBe(first);

    await listing({ listing: "hay-plain-rug", photoUrl: "https://shop.example/b.png" });
    const second = (await listings())[0]?.photoVersion;
    expect(second).not.toBe(first);
    // The JPEG it replaced does not linger beside the new PNG.
    expect(pictures()).toEqual([`hay-plain-rug-${second}.png`]);
  });

  it("never fails the call, whatever goes wrong: the Listing is recorded with the link and the receipt says so", async () => {
    const failures = {
      refused: new CoreError("validation", "The image at it answered 403, not 200."),
      "not an image": new CoreError("validation", "What it answered is not a JPEG, PNG, or WebP."),
      "over the cap": new CoreError("validation", "The image at it is over 2048 KB."),
      "timed out": new CoreError(
        "validation",
        "The image at it could not be fetched: it timed out.",
      ),
      thrown: new Error("boom"),
    };
    let n = 0;
    for (const [what, error] of Object.entries(failures)) {
      const url = `https://shop.example/${n}.jpg`;
      answers.set(url, error);
      const receipt = await listing({ ...hay(), name: `Rug ${n}`, photoUrl: url });

      expect(receipt, what).toContain("its picture could not be stored, so the link is kept");
      const recorded = (await listings()).at(-1);
      expect(recorded?.photoUrl, what).toBe(url);
      expect(recorded?.photoVersion, what).toBeUndefined();
      n++;
    }
    expect(existsSync(join(dataDir, "uploads", home, "listings"))).toBe(false);
  });

  it("tells the Agent what it can do when the picture can't be fetched: ask the user to paste it", async () => {
    // The fetcher's refusal speaks to the user at the paste box; the Agent can paste nothing.
    answers.set(
      "https://shop.example/walled.jpg",
      new CoreError(
        "validation",
        "Couldn't fetch an image from that address. Save the picture from the shop's page, then " +
          "paste it or choose the file instead.",
      ),
    );
    const receipt = await listing(hay({ photoUrl: "https://shop.example/walled.jpg" }));
    expect(receipt).toContain(
      "its picture could not be stored, so the link is kept: Couldn't fetch an image from that " +
        "address. If the user wants the picture, ask them to save it from the shop's page and " +
        "paste it into the Listing on the board.",
    );
    expect(receipt).not.toContain("choose the file");
  });

  it("keeps the picture it had when the write replacing it rolls back", async () => {
    answers.set("https://shop.example/a.jpg", JPEG);
    answers.set("https://shop.example/b.jpg", JPEG_2);
    await listing(hay({ photoUrl: "https://shop.example/a.jpg" }));

    const restore = failWrites();
    await expect(
      listing({ listing: "hay-plain-rug", photoUrl: "https://shop.example/b.jpg" }),
    ).rejects.toThrow("disk full");
    restore();

    const served = await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" });
    expect(served.data).toEqual(JPEG.bytes);
    expect(pictures()).toHaveLength(1);
  });

  it("removes the picture it replaced only once the new one is committed", async () => {
    answers.set("https://shop.example/a.jpg", JPEG);
    answers.set("https://shop.example/b.png", PNG);
    await listing(hay({ photoUrl: "https://shop.example/a.jpg" }));
    const [old] = committedPhotoPaths();

    const removals = watchRemovals();
    await listing({ listing: "hay-plain-rug", photoUrl: "https://shop.example/b.png" });

    expect(removals).toEqual([{ path: old, committed: committedPhotoPaths() }]);
    expect(committedPhotoPaths()).not.toContain(old);
    expect(pictures()).toHaveLength(1);
  });

  it("keeps the new picture, and succeeds, when removing the one it replaced fails", async () => {
    answers.set("https://shop.example/a.jpg", JPEG);
    answers.set("https://shop.example/b.png", PNG);
    await listing(hay({ photoUrl: "https://shop.example/a.jpg" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onRemove = () => {
      throw new Error("EBUSY: resource busy");
    };

    await listing({ listing: "hay-plain-rug", photoUrl: "https://shop.example/b.png" });

    onRemove = undefined;
    const served = await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" });
    expect(served.data).toEqual(PNG.bytes);
    expect(String(warn.mock.calls[0])).toContain("EBUSY");
  });

  it("is refused by get_listing_photo when only the link was kept", async () => {
    answers.set("https://shop.example/gone.jpg", new CoreError("validation", "404"));
    await listing(hay({ photoUrl: "https://shop.example/gone.jpg" }));
    const error = await refusal(
      core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" }),
    );
    expect(error.code).toBe("not_found");
    expect(error.message).toContain("https://shop.example/gone.jpg");
  });
});

describe("set_listing_photo, the board's paste box", () => {
  beforeEach(async () => {
    answers.set("https://shop.example/a.jpg", JPEG);
    await listing(hay({ photoUrl: "https://shop.example/a.jpg" }));
  });

  it("takes pasted bytes, replacing the fetched picture and its version", async () => {
    const before = (await listings())[0]?.photoVersion;
    const { listing: after } = await core.run("set_listing_photo", web, {
      home,
      listing: "hay-plain-rug",
      file: PNG.bytes,
    });

    expect(after.photoVersion).not.toBe(before);
    // The source link is left as it was: the user overrode the picture, not where it came from.
    expect(after.photoUrl).toBe("https://shop.example/a.jpg");
    const served = await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" });
    expect([served.mimeType, served.data]).toEqual(["image/png", PNG.bytes]);
    expect(pictures()).toEqual([`hay-plain-rug-${after.photoVersion}.png`]);
  });

  it("takes an image URL instead, fetching it with the same validation, and records it as the source", async () => {
    answers.set("https://shop.example/better.webp", WEBP);
    const { listing: after } = await core.run("set_listing_photo", web, {
      home,
      listing: "hay-plain-rug",
      url: "https://shop.example/better.webp",
    });
    expect(after.photoUrl).toBe("https://shop.example/better.webp");
    expect(
      (await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" })).mimeType,
    ).toBe("image/webp");
  });

  it("keeps the picture it had when the write replacing it rolls back", async () => {
    const restore = failWrites();
    await expect(
      core.run("set_listing_photo", web, { home, listing: "hay-plain-rug", file: JPEG_2.bytes }),
    ).rejects.toThrow("disk full");
    restore();

    const served = await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" });
    expect(served.data).toEqual(JPEG.bytes);
    expect(pictures()).toHaveLength(1);
  });

  it("removes the picture it replaced only once the new one is committed", async () => {
    const [old] = committedPhotoPaths();
    const removals = watchRemovals();

    await core.run("set_listing_photo", web, {
      home,
      listing: "hay-plain-rug",
      file: JPEG_2.bytes,
    });

    expect(removals).toEqual([{ path: old, committed: committedPhotoPaths() }]);
    expect(committedPhotoPaths()).not.toContain(old);
    const served = await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" });
    expect(served.data).toEqual(JPEG_2.bytes);
    expect(pictures()).toHaveLength(1);
  });

  it("keeps the new picture, and succeeds, when removing the one it replaced fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onRemove = () => {
      throw new Error("EBUSY: resource busy");
    };

    await core.run("set_listing_photo", web, {
      home,
      listing: "hay-plain-rug",
      file: JPEG_2.bytes,
    });

    onRemove = undefined;
    const served = await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" });
    expect(served.data).toEqual(JPEG_2.bytes);
    expect(String(warn.mock.calls[0])).toContain("EBUSY");
  });

  it("does not fetch for a Listing the Home has not got", async () => {
    const error = await refusal(
      core.run("set_listing_photo", web, {
        home,
        listing: "nope",
        url: "https://shop.example/a.jpg",
      }),
    );
    expect(error.code).toBe("not_found");
    expect(fetched).toEqual(["https://shop.example/a.jpg"]);
  });

  it("reports its failures, unlike the automatic fetch, because the user is waiting on it", async () => {
    answers.set("https://shop.example/wall", new CoreError("validation", "not an image"));
    const fetchFailed = await refusal(
      core.run("set_listing_photo", web, {
        home,
        listing: "hay-plain-rug",
        url: "https://shop.example/wall",
      }),
    );
    const pastedHtml = await refusal(
      core.run("set_listing_photo", web, {
        home,
        listing: "hay-plain-rug",
        file: new TextEncoder().encode("<!doctype html>"),
      }),
    );
    expect([fetchFailed.code, pastedHtml.code]).toEqual(["validation", "unsupported_file"]);
    expect(pastedHtml.message).toContain("not a JPEG, PNG, or WebP");
    // The picture already stored is untouched by either refusal.
    expect(
      (await core.run("get_listing_photo", web, { home, listing: "hay-plain-rug" })).data,
    ).toEqual(JPEG.bytes);
  });

  it("is refused with neither a file nor a url, and with both", async () => {
    const neither = await refusal(
      core.run("set_listing_photo", web, { home, listing: "hay-plain-rug" }),
    );
    const both = await refusal(
      core.run("set_listing_photo", web, {
        home,
        listing: "hay-plain-rug",
        file: PNG.bytes,
        url: "https://shop.example/a.jpg",
      }),
    );
    expect([neither.code, both.code]).toEqual(["validation", "validation"]);
  });
});

describe("Held", () => {
  beforeEach(async () => {
    await listing(hay({ rating: 4, ratingNote: "Right size, real wool, pricey" }));
  });

  it("is set from the board with its reason and note, stamped with the day, and told to the Agent", async () => {
    const { listing: held } = await core.run("hold_listing", web, {
      home,
      listing: "hay-plain-rug",
      held: { reason: "out-of-stock", note: "back in March, the shop says" },
    });
    expect(held.held).toEqual({
      reason: "out-of-stock",
      note: "back in March, the shop says",
      at: "2026-09-17T10:00:00.000Z",
    });
    // A hold is set in the app, so this line is the only way the Agent ever learns of one.
    expect(await decisionText()).toContain(
      "rated 4/5 (Right size, real wool, pricey): 3 pass, 0 fail, 0 unknown; Held 2026-09-17: " +
        "out of stock (back in March, the shop says)",
    );
  });

  it("keeps the Listing's Rating and its checks, and changes nothing else", async () => {
    const before = (await listings())[0];
    await core.run("hold_listing", web, {
      home,
      listing: "hay-plain-rug",
      held: { reason: "discontinued" },
    });
    const after = (await listings())[0];
    expect({ ...after, held: undefined }).toEqual({ ...before, held: undefined });
  });

  it("is released with null, and the Agent stops being told of it", async () => {
    await core.run("hold_listing", web, {
      home,
      listing: "hay-plain-rug",
      held: { reason: "too-expensive-now" },
    });
    const { listing: released } = await core.run("hold_listing", web, {
      home,
      listing: "hay-plain-rug",
      held: null,
    });
    expect(released.held).toBeUndefined();
    expect(await decisionText()).not.toContain("Held");
  });

  it("is set by the Agent too, and holding again for the same reason does not make the hold look fresh", async () => {
    await listing({ listing: "hay-plain-rug", held: { reason: "out-of-stock" } });
    expect((await listings())[0]?.held?.at).toBe("2026-09-17T10:00:00.000Z");

    // Three weeks on, the same hold re-sent keeps the day it was first set: the board shows a
    // hold by its age, and restamping it would quietly say the stock was checked today.
    now = "2026-10-08T10:00:00.000Z";
    await listing({ listing: "hay-plain-rug", held: { reason: "out-of-stock" } });
    expect((await listings())[0]?.held?.at).toBe("2026-09-17T10:00:00.000Z");

    // A different reason is a new hold, and is stamped now.
    await core.run("hold_listing", web, {
      home,
      listing: "hay-plain-rug",
      held: { reason: "too-expensive-now", note: "up £60 since September" },
    });
    expect((await listings())[0]?.held?.at).toBe("2026-10-08T10:00:00.000Z");
  });

  it("is refused a reason off the list", async () => {
    const error = await refusal(
      core.run("hold_listing", web, { home, listing: "hay-plain-rug", held: { reason: "paused" } }),
    );
    expect(error.code).toBe("validation");
  });
});

describe("drop_listing", () => {
  beforeEach(async () => {
    answers.set("https://shop.example/a.jpg", JPEG);
    await listing(hay({ rating: 4, ratingNote: "Pricey", photoUrl: "https://shop.example/a.jpg" }));
  });

  it("takes the row, its checks, and its stored picture, with one change-log entry and no reason", async () => {
    const before = (await changes()).length;
    const dropped = await core.run("drop_listing", web, { home, listing: "hay-plain-rug" });

    expect(dropped).toEqual({ decision: "wool-rug", listing: "hay-plain-rug" });
    expect(await listings()).toEqual([]);
    expect(pictures()).toEqual([]);
    // The change log reads newest first.
    const all = await changes();
    const added = all.slice(0, all.length - before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      field: "listing hay-plain-rug",
      old: { name: "Hay Plain rug", price: "£450", rating: 4 },
      new: null,
    });
    // The slug is free again, and the Purchase still stands.
    expect((await detail()).requirements).toHaveLength(3);
  });

  it("removes the picture only once the drop is committed", async () => {
    const [old] = committedPhotoPaths();
    const removals = watchRemovals();

    await core.run("drop_listing", web, { home, listing: "hay-plain-rug" });

    expect(removals).toEqual([{ path: old, committed: [] }]);
    expect(pictures()).toEqual([]);
  });

  it("is refused for a Listing this Home has not got", async () => {
    const error = await refusal(core.run("drop_listing", web, { home, listing: "no-such-rug" }));
    expect(error.code).toBe("not_found");
  });
});

describe("a Rejected or Fulfilled Purchase", () => {
  beforeEach(async () => {
    await listing(hay({ rating: 4, ratingNote: "Pricey" }));
  });

  it("still takes a drop and a hold: culling and noting stock are not changes to the Decision", async () => {
    await core.run("set_decision_state", agent(session), {
      session,
      decision: "wool-rug",
      to: "rejected",
      reason: 'The user: "no rug after all"',
    });
    // record_listing is refused on a Rejected Purchase, as it always was.
    expect((await refusal(listing(hay({ name: "Another rug" })))).code).toBe("illegal_transition");

    const { listing: held } = await core.run("hold_listing", web, {
      home,
      listing: "hay-plain-rug",
      held: { reason: "discontinued" },
    });
    expect(held.held?.reason).toBe("discontinued");
    await core.run("drop_listing", web, { home, listing: "hay-plain-rug" });
    expect(await listings()).toEqual([]);
  });
});

describe("the Shopping entry's best rating", () => {
  async function entry() {
    const { considering } = await core.run("get_shopping", web, { home });
    return considering.find((each) => each.slug === "wool-rug");
  }

  it("is the highest among the Listings that fail no must and are not Held, and is absent when none qualifies", async () => {
    expect((await entry())?.bestRating).toBeUndefined();

    await listing(hay({ rating: 4, ratingNote: "Right size, real wool, pricey" }));
    expect((await entry())?.bestRating).toBe(4);

    // A must-failer rated higher never headlines the Purchase: it is not buyable.
    await listing({
      name: "Jute loop rug",
      rating: 5,
      ratingNote: "The terracotta, at a third of the price",
      checks: [
        { requirement: 1, result: "fail" },
        { requirement: 2, result: "fail" },
        { requirement: 3, result: "pass" },
      ],
    });
    expect((await entry())?.bestRating).toBe(4);

    // Nor does a Held one, however good: the user cannot buy it this month.
    await listing({ ...hay(), name: "Nordic Story wool rug", rating: 5, ratingNote: "The one" });
    expect((await entry())?.bestRating).toBe(5);
    await core.run("hold_listing", web, {
      home,
      listing: "nordic-story-wool-rug",
      held: { reason: "out-of-stock" },
    });
    expect((await entry())?.bestRating).toBe(4);

    await core.run("drop_listing", web, { home, listing: "hay-plain-rug" });
    expect((await entry())?.bestRating).toBeUndefined();
  });

  it("names its Listing, with the picture, under the same rules: the first recorded on a tie, and absent exactly when the rating is", async () => {
    expect((await entry())?.bestListing).toBeUndefined();

    answers.set("https://shop.example/hay.jpg", JPEG);
    await listing(
      hay({ rating: 4, ratingNote: "Pricey", photoUrl: "https://shop.example/hay.jpg" }),
    );
    const version = (await listings())[0]?.photoVersion;
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect((await entry())?.bestListing).toEqual({
      slug: "hay-plain-rug",
      name: "Hay Plain rug",
      photoUrl: "https://shop.example/hay.jpg",
      photoVersion: version,
    });

    // A must-failer rated higher, and a Held one, never lend it their picture.
    await listing({
      name: "Jute loop rug",
      rating: 5,
      ratingNote: "Cheap",
      checks: [
        { requirement: 1, result: "fail" },
        { requirement: 2, result: "pass" },
        { requirement: 3, result: "pass" },
      ],
    });
    await listing({ ...hay(), name: "Nordic Story wool rug", rating: 5, ratingNote: "The one" });
    await core.run("hold_listing", web, {
      home,
      listing: "nordic-story-wool-rug",
      held: { reason: "out-of-stock" },
    });
    expect((await entry())?.bestListing?.slug).toBe("hay-plain-rug");

    // A tie goes to the one recorded first; a link that could not be stored has no version.
    await listing({ ...hay(), name: "Loom rug", rating: 4, ratingNote: "Also fine" });
    expect((await entry())?.bestListing?.slug).toBe("hay-plain-rug");
    await core.run("hold_listing", web, {
      home,
      listing: "hay-plain-rug",
      held: { reason: "too-expensive-now" },
    });
    expect((await entry())?.bestListing).toEqual({ slug: "loom-rug", name: "Loom rug" });

    await core.run("drop_listing", web, { home, listing: "loom-rug" });
    const gone = await entry();
    expect(gone?.bestRating).toBeUndefined();
    expect(gone?.bestListing).toBeUndefined();
  });
});
