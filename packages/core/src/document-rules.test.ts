// The rules of Documents: the papers the user keeps with an Item (a receipt, a warranty, a
// manual, another), added on the web as a PDF or an image, validated by their bytes under a cap of
// their own, stored as files under uploads/<home>/documents/, renamed or re-kinded, deleted
// outright, listed by kind on the Item page, and logged on the Item by kind and name. The Agent's
// line for them is in render.test.ts.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import { nodeFileStore } from "./files.js";
import { MAX_IMAGE_BYTES } from "./images.js";
import { MAX_DOCUMENT_BYTES } from "./operations/documents.js";

const web: CallContext = { caller: { kind: "web" } };

const PDF = file(new TextEncoder().encode("%PDF-1.7\n"), 1);
const JPEG = file([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46], 2);
const PNG = file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 3);
/** An iPhone's photo: a box of length 24, then "ftyp" and the brand "heic". */
const HEIC = file([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")], 4);

/** 64 fake bytes behind a real signature, told apart by `mark`. */
function file(signature: ArrayLike<number>, mark: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set(signature);
  bytes[60] = mark;
  return bytes;
}

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

let dataDir: string;
let core: Core;
let home: string;
/** Paths whose write the file store refuses, to fail an upload partway. */
let failing: RegExp | undefined;

const add = (input: Partial<OperationInput<"add_document">> = {}) =>
  core.run("add_document", web, { home, item: "lamp", kind: "receipt", file: PDF, ...input });
const edit = (input: Omit<OperationInput<"edit_document">, "home" | "item">) =>
  core.run("edit_document", web, { home, item: "lamp", ...input });
const page = (item = "lamp") => core.run("get_item", web, { home, item });
const documentsDir = () => join(dataDir, "uploads", home, "documents");
const stored = () => (existsSync(documentsDir()) ? readdirSync(documentsDir()).sort() : []);

beforeEach(async () => {
  failing = undefined;
  dataDir = mkdtempSync(join(tmpdir(), "settle-documents-"));
  core = createCore({
    dataDir,
    clock: () => new Date("2026-10-06T10:00:00.000Z"),
    files: {
      ...nodeFileStore,
      writeBytes(path, bytes) {
        if (failing?.test(path)) throw new Error(`The disk refused ${path}`);
        nodeFileStore.writeBytes(path, bytes);
      },
    },
  });
  home = (await core.run("create_home", web, { name: "My flat", country: "CL", city: "Santiago" }))
    .home.slug;
  const session = (
    await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "home-intake" })
  ).session;
  const agent: CallContext = { caller: { kind: "session", session }, home };
  await core.run("save_room", agent, { session, name: "Living room" });
  await core.run("save_items", agent, {
    session,
    items: [
      { name: "Lamp", category: "lighting", room: "living-room" },
      { name: "Sofa", category: "seating", room: "living-room" },
      { name: "Old rug", category: "rugs", room: "living-room" },
    ],
  });
  await core.run("save_items", agent, {
    session,
    items: [{ item: "old-rug", archive: true, archiveReason: "worn out" }],
  });
});
afterEach(() => {
  core.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("add_document", () => {
  it("stores a PDF unnamed, and serves it back with its type and the kind as its file name", async () => {
    const { documents } = await add();
    expect(documents).toEqual([
      {
        id: expect.any(Number),
        kind: "receipt",
        type: "application/pdf",
        bytes: 64,
        version: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    ]);
    const id = documents[0]?.id ?? 0;
    expect(stored()).toEqual([`${id}.pdf`]);
    const got = await core.run("get_document", web, { home, item: "lamp", document: id });
    expect(got).toEqual({ mimeType: "application/pdf", fileName: "receipt.pdf", data: PDF });
  });

  it("stores an image with its name, trimmed, and an empty name is none", async () => {
    const named = (await add({ kind: "warranty", file: JPEG, name: "  Card from the box " }))
      .documents[0];
    const { documents } = await add({ kind: "other", file: PNG, name: "   " });
    expect(named).toMatchObject({
      kind: "warranty",
      name: "Card from the box",
      type: "image/jpeg",
    });
    expect(documents[1]).toMatchObject({ kind: "other", type: "image/png" });
    expect(documents[1]).not.toHaveProperty("name");
    expect(stored()).toEqual([`${named?.id}.jpg`, `${documents[1]?.id}.png`]);
    const got = await core.run("get_document", web, {
      home,
      item: "lamp",
      document: named?.id ?? 0,
    });
    expect([got.mimeType, got.fileName]).toEqual(["image/jpeg", "Card from the box.jpg"]);
  });

  it("takes each kind, and refuses any other", async () => {
    for (const kind of ["receipt", "warranty", "manual", "other"] as const) {
      expect((await add({ kind })).documents.some((each) => each.kind === kind)).toBe(true);
    }
    const error = await refusal(add({ kind: "invoice" as "other" }));
    expect(error.code).toBe("validation");
  });

  it("refuses a HEIC by name, saying to export a JPEG", async () => {
    const error = await refusal(add({ file: HEIC }));
    expect(error.code).toBe("unsupported_file");
    expect(error.message).toMatch(/HEIC image.*Export it as a JPEG/);
    expect(stored()).toEqual([]);
  });

  it("refuses a file that is neither a PDF nor an image, whatever it is called", async () => {
    const error = await refusal(add({ file: new TextEncoder().encode("<!doctype html>") }));
    expect(error.code).toBe("unsupported_file");
    expect(error.message).toContain("not a PDF, JPEG, PNG, or WebP");
  });

  it("refuses a file over 50 MB, pointing a long manual at the Manual link", async () => {
    // Told it is over the cap without allocating 50 MB.
    const big = PDF.slice();
    Object.defineProperty(big, "length", { value: MAX_DOCUMENT_BYTES + 1 });
    const error = await refusal(add({ file: big }));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("over 50 MB");
    expect(error.message).toContain("Manual link");
    expect(stored()).toEqual([]);
  });

  it("takes an image over the 2 MB Photos and Listing pictures are held to", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG.subarray(0, 8));
    const { documents } = await add({ file: big });
    expect(documents[0]).toMatchObject({ type: "image/jpeg", bytes: MAX_IMAGE_BYTES + 1 });
  });

  it("leaves no file and no Document when the write fails", async () => {
    failing = /documents/;
    await expect(add()).rejects.toThrow("The disk refused");
    expect(stored()).toEqual([]);
    expect((await page()).documents).toEqual([]);
  });

  it("takes a Document on an Archived Item", async () => {
    const { documents } = await add({ item: "old-rug" });
    expect((await page("old-rug")).documents).toEqual(documents);
  });
});

it("get_item lists them by kind, then oldest first, and none as empty", async () => {
  await add({ kind: "other", name: "Delivery note" });
  await add({ kind: "manual", name: "User guide" });
  await add({ kind: "receipt", name: "Second receipt" });
  await add({ kind: "warranty" });
  const { documents } = await add({ kind: "receipt", name: "Third receipt" });
  const order = [
    ["receipt", "Second receipt"],
    ["receipt", "Third receipt"],
    ["warranty", undefined],
    ["manual", "User guide"],
    ["other", "Delivery note"],
  ];
  expect(documents.map((each) => [each.kind, each.name])).toEqual(order);
  expect((await page()).documents).toEqual(documents);
  expect((await page("sofa")).documents).toEqual([]);
  // No Document trace on the Item itself, in lists or on the page.
  expect((await page()).item).not.toHaveProperty("documents");
});

describe("edit_document and delete_document", () => {
  it("edits the kind, the name, and clears the name with null or an empty string", async () => {
    const id = (await add({ name: "Receipt" })).documents[0]?.id ?? 0;
    expect((await edit({ document: id, kind: "warranty" })).documents[0]).toMatchObject({
      kind: "warranty",
      name: "Receipt",
    });
    expect((await edit({ document: id, name: "Warranty card" })).documents[0]).toMatchObject({
      kind: "warranty",
      name: "Warranty card",
    });
    expect((await edit({ document: id, name: "" })).documents[0]).not.toHaveProperty("name");
    await edit({ document: id, name: "again" });
    expect((await edit({ document: id, name: null })).documents[0]).not.toHaveProperty("name");
  });

  it("deletes the row and the file", async () => {
    const id = (await add()).documents[0]?.id ?? 0;
    const kept = (await add({ file: JPEG })).documents[1]?.id;
    const { documents } = await core.run("delete_document", web, {
      home,
      item: "lamp",
      document: id,
    });
    expect(documents.map((each) => each.id)).toEqual([kept]);
    expect(stored()).toEqual([`${kept}.jpg`]);
  });

  it("refuses not_found for a Document that is not on the named Item", async () => {
    const id = (await add()).documents[0]?.id ?? 0;
    const refused = await Promise.all([
      refusal(core.run("edit_document", web, { home, item: "sofa", document: id, name: "x" })),
      refusal(core.run("delete_document", web, { home, item: "sofa", document: id })),
      refusal(core.run("get_document", web, { home, item: "sofa", document: id })),
      refusal(core.run("delete_document", web, { home, item: "lamp", document: id + 1 })),
      refusal(add({ item: "no-such-item" })),
    ]);
    expect(refused.map((each) => each.code)).toEqual([
      "not_found",
      "not_found",
      "not_found",
      "not_found",
      "not_found",
    ]);
    expect(stored()).toEqual([`${id}.pdf`]);
  });
});

it("offers a file name with accents dropped and anything that would break the header taken out", async () => {
  const id = (await add({ name: 'Garantía "Sony" TV\\a/b' })).documents[0]?.id ?? 0;
  const got = await core.run("get_document", web, { home, item: "lamp", document: id });
  expect(got.fileName).toBe("Garantia Sony TVab.pdf");
});

it("logs each change on the Item from the web, naming the Document by kind and name, never its id", async () => {
  const id = (await add({ name: "IKEA receipt" })).documents[0]?.id ?? 0;
  await edit({ document: id, kind: "warranty", name: null });
  await edit({ document: id, kind: "warranty" });
  await core.run("delete_document", web, { home, item: "lamp", document: id });
  const { changes } = await core.run("get_change_log", web, { home });
  const documentChanges = changes.filter((each) => each.field === "document").reverse();
  const entry = { at: expect.any(String), origin: "web", recordKind: "item", record: "lamp" };
  const reason = "edited by the user on the web";
  expect(documentChanges).toEqual([
    { ...entry, field: "document", new: { kind: "receipt", name: "IKEA receipt" }, reason },
    // An edit that changes nothing logs nothing.
    {
      ...entry,
      field: "document",
      old: { kind: "receipt", name: "IKEA receipt" },
      new: { kind: "warranty" },
      reason,
    },
    { ...entry, field: "document", old: { kind: "warranty" }, new: null, reason },
  ]);
  expect(
    (await page()).history.flatMap((entry) => entry.changes.map((each) => each.field)),
  ).toContain("document");
});

it("is never offered to the Agent", () => {
  for (const name of ["add_document", "edit_document", "delete_document", "get_document"]) {
    expect(core.operations.find((each) => each.name === name)?.surface).toBe("web");
  }
});
