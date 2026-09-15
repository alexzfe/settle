// The server-enforced rules of slice 3 (Blueprints), and the Blueprint operations: upload,
// view_images, page-to-Level mapping, and Blueprint sources.
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mupdfRenderer } from "./blueprints/mupdf.js";
import {
  type CallContext,
  type Core,
  type CoreOptions,
  createCore,
  type OperationInput,
  type OperationName,
} from "./core.js";
import { CoreError } from "./errors.js";
import type { ChangeEvent } from "./events.js";
import { nodeFileStore, type PdfRenderer } from "./files.js";
import { FIXTURE_FILES } from "./fixture/fixture-home.js";
import type { Measurement } from "./operations/schemas.js";

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

const A3 = readFileSync(join(FIXTURE_FILES, "blueprint-a3.pdf"));
const THREE_PAGES = readFileSync(join(FIXTURE_FILES, "blueprint-3-pages.pdf"));
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const measured = (mm: number): Measurement => ({ mm, provenance: "measured" });
const printed = (mm: number, page = 1, blueprint = "agent-plan"): Measurement => ({
  mm,
  provenance: "blueprint",
  source: { blueprint, page, printed: `${mm / 1000}` },
});

let dataDir: string;
let core: Core;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "idh-blueprints-"));
  core = createCore({ dataDir, clock: () => new Date("2026-09-14T10:00:00.000Z") });
});
afterEach(() => {
  core.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Closes this test's core and builds another on the same data dir, with `options`. */
function replaceCore(options: CoreOptions): void {
  core.close();
  core = createCore({ dataDir, clock: () => new Date("2026-09-14T10:00:00.000Z"), ...options });
}

/** mupdf, except that rendering page `broken` of any file throws, as a damaged page might. */
function failingOnPage(broken: number): PdfRenderer {
  return {
    ...mupdfRenderer,
    open(bytes, type) {
      const doc = mupdfRenderer.open(bytes, type);
      return {
        pageCount: doc.pageCount,
        renderPage(page, options) {
          if (page === broken) throw new Error("broken page");
          return doc.renderPage(page, options);
        },
        textLines: (page, longEdge) => doc.textLines(page, longEdge),
        close: () => doc.close(),
      };
    },
  };
}

type Input<N extends OperationName> = Omit<OperationInput<N>, "session">;

/** A new Home with an open Session, and its calls bound to both. */
async function setUp(name = "My flat") {
  const { home } = await core.run("create_home", web, { name, country: "GB", city: "London" });
  const { session } = await core.run("open_session", agent(home.slug), { skill: "home-intake" });
  const context = agent(home.slug, session);
  return {
    home: home.slug,
    session,
    upload: (file: Uint8Array, fileName: string, label?: string) =>
      core.run("upload_blueprint", web, { home: home.slug, file, fileName, label }),
    viewImages: (input: Input<"view_images">) =>
      core.run("view_images", context, { session, ...input }),
    saveHome: (input: Input<"save_home">) => core.run("save_home", context, { session, ...input }),
    saveRoom: (input: Input<"save_room">) => core.run("save_room", context, { session, ...input }),
    saveItems: (input: Input<"save_items">) =>
      core.run("save_items", context, { session, ...input }),
    blueprints: async () =>
      (await core.run("list_blueprints", web, { home: home.slug })).blueprints,
    opening: async () =>
      (await core.run("open_session", agent(home.slug), { skill: "home-intake" })).opening,
  };
}

function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/** An 8-bit RGB PNG of random noise, which no encoder can compress: a stand-in for a noisy scan. */
function noisyPng(width: number, height: number): Uint8Array {
  const row = width * 3 + 1;
  const raw = randomBytes(row * height);
  for (let y = 0; y < height; y++) raw[y * row] = 0;
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

describe("upload_blueprint", () => {
  it("keeps the file, renders every page at 2000 px with its text layer, and lists it", async () => {
    const my = await setUp();

    const { blueprint } = await my.upload(THREE_PAGES, "plans.pdf", "Estate agent plan");

    expect(blueprint).toEqual({
      slug: "estate-agent-plan",
      label: "Estate agent plan",
      fileName: "plans.pdf",
      fileType: "pdf",
      pageCount: 3,
      uploadedAt: "2026-09-14T10:00:00.000Z",
      pages: [
        { page: 1, width: 1414, height: 2000, hasText: true },
        { page: 2, width: 2000, height: 1414, hasText: true },
        { page: 3, width: 2000, height: 1414, hasText: false },
      ],
    });
    expect(await my.blueprints()).toEqual([blueprint]);
    expect(readFileSync(join(dataDir, "uploads", "my-flat", "estate-agent-plan.pdf"))).toEqual(
      THREE_PAGES,
    );
    for (const page of [1, 2, 3]) {
      const png = join(dataDir, "rendered", "my-flat", "estate-agent-plan", `page-${page}.png`);
      expect(existsSync(png), png).toBe(true);
    }
  });

  it("takes its label from the file's name when none is given, and a fresh slug each time", async () => {
    const my = await setUp();
    const first = await my.upload(A3, "Ground floor.pdf");
    const second = await my.upload(A3, "Ground floor.pdf");
    expect([first.blueprint.label, first.blueprint.slug]).toEqual(["Ground floor", "ground-floor"]);
    expect(second.blueprint.slug).toBe("ground-floor-2");
  });

  it("opens a PNG or a JPEG as a one-page Blueprint, with no text layer", async () => {
    const my = await setUp();
    const page = await core.run("get_blueprint_page", web, {
      home: my.home,
      blueprint: (await my.upload(A3, "plan.pdf")).blueprint.slug,
      page: 1,
    });

    const png = await my.upload(page.data, "screenshot.png");
    const jpeg = await my.upload(mupdfRenderer.jpeg(page.data, 85), "photo.jpg");

    for (const [{ blueprint }, type] of [
      [png, "png"],
      [jpeg, "jpeg"],
    ] as const) {
      expect(blueprint).toMatchObject({
        fileType: type,
        pageCount: 1,
        pages: [{ page: 1, width: 2000, height: 1414, hasText: false }],
      });
    }
    expect(existsSync(join(dataDir, "uploads", "my-flat", "photo.jpg"))).toBe(true);
  });

  it("refuses a file with no pages with no_pages, and stores nothing", async () => {
    const my = await setUp();
    const truncated = await refusal(my.upload(A3.subarray(0, 600), "cut-off.pdf"));
    const empty = await refusal(my.upload(new Uint8Array(), "empty.pdf"));

    expect([truncated.code, empty.code]).toEqual(["no_pages", "no_pages"]);
    expect(truncated.message).toContain("no pages");
    expect(await my.blueprints()).toEqual([]);
    expect(existsSync(join(dataDir, "uploads"))).toBe(false);
  });

  it("refuses with no_pages when a page fails to render, removing what it wrote", async () => {
    replaceCore({ renderPdf: failingOnPage(2) });
    const my = await setUp();
    await my.upload(A3, "plan.pdf", "Plan");

    const error = await refusal(my.upload(THREE_PAGES, "plans.pdf", "Plan"));

    expect(error.code).toBe("no_pages");
    expect(error.message).toContain("Page 2 of plans.pdf could not be rendered (broken page)");
    expect((await my.blueprints()).map((blueprint) => blueprint.slug)).toEqual(["plan"]);
    expect(existsSync(join(dataDir, "rendered", "my-flat", "plan-2"))).toBe(false);
    expect(existsSync(join(dataDir, "uploads", "my-flat", "plan-2.pdf"))).toBe(false);
    // The Blueprint already stored keeps its files.
    expect(existsSync(join(dataDir, "rendered", "my-flat", "plan", "page-1.png"))).toBe(true);
    expect(existsSync(join(dataDir, "uploads", "my-flat", "plan.pdf"))).toBe(true);
  });

  it("removes the pages it rendered when keeping the uploaded file fails", async () => {
    const uploads = join(dataDir, "uploads");
    replaceCore({
      files: {
        ...nodeFileStore,
        writeBytes(path, bytes) {
          if (path.startsWith(uploads)) throw new Error("disk full");
          nodeFileStore.writeBytes(path, bytes);
        },
      },
    });
    const my = await setUp();

    await expect(my.upload(THREE_PAGES, "plans.pdf", "Plan")).rejects.toThrow("disk full");

    expect(await my.blueprints()).toEqual([]);
    expect(existsSync(join(dataDir, "rendered", "my-flat", "plan"))).toBe(false);
  });

  it("removes every file it wrote when its transaction fails", async () => {
    // The clock is first read inside the upload's transaction, for uploadedAt.
    let stopped = false;
    replaceCore({
      clock: () => {
        if (stopped) throw new Error("clock stopped");
        return new Date("2026-09-14T10:00:00.000Z");
      },
    });
    const my = await setUp();

    stopped = true;
    await expect(my.upload(THREE_PAGES, "plans.pdf", "Plan")).rejects.toThrow("clock stopped");
    stopped = false;

    expect(await my.blueprints()).toEqual([]);
    expect(existsSync(join(dataDir, "rendered", "my-flat", "plan"))).toBe(false);
    expect(existsSync(join(dataDir, "uploads", "my-flat", "plan.pdf"))).toBe(false);
  });

  it("refuses HEIC, by its bytes or its name, and anything else, with unsupported_file", async () => {
    const my = await setUp();
    const heicBytes = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0]);
    const heic = await refusal(my.upload(heicBytes, "IMG_0001.jpeg"));
    const heicByName = await refusal(my.upload(randomBytes(64), "IMG_0002.HEIC"));
    const text = await refusal(my.upload(new TextEncoder().encode("rooms: 3"), "notes.txt"));

    for (const error of [heic, heicByName, text]) expect(error.code).toBe("unsupported_file");
    expect(heic.message).toContain("HEIC");
    expect(heicByName.message).toContain("HEIC");
    expect(text.message).toContain("PDF, PNG, or JPEG");
    expect(await my.blueprints()).toEqual([]);
  });

  it("logs the upload from the web and publishes a blueprint event", async () => {
    const events: ChangeEvent[] = [];
    core.subscribe((event) => events.push(event));
    const my = await setUp();

    await my.upload(A3, "plan.pdf", "Agent plan");

    expect(events.at(-1)).toEqual({
      home: my.home,
      recordKind: "blueprint",
      recordSlug: "agent-plan",
    });
    const { changes } = await core.run("get_change_log", web, { home: my.home });
    expect(changes[0]).toMatchObject({
      origin: "web",
      recordKind: "blueprint",
      record: "agent-plan",
      new: { label: "Agent plan", fileName: "plan.pdf", pageCount: 1 },
    });
  });
});

describe("view_images", () => {
  it("returns at most 6 pages per call, enforced by the schema", async () => {
    const my = await setUp();
    await my.upload(THREE_PAGES, "plan.pdf", "Plan");

    const seven = await refusal(my.viewImages({ blueprint: "plan", pages: [1, 2, 3, 1, 2, 3, 1] }));
    const none = await refusal(my.viewImages({ blueprint: "plan", pages: [] }));
    const six = await my.viewImages({ blueprint: "plan", pages: [1, 2, 3, 3, 2, 1] });

    expect([seven.code, none.code]).toEqual(["validation", "validation"]);
    expect(seven.message).toContain("pages");
    expect(six.pages.map((page) => page.page)).toEqual([1, 2, 3]);
  });

  it("returns the pages asked for as PNGs, in order, after a text block naming them", async () => {
    const my = await setUp();
    await my.upload(THREE_PAGES, "plan.pdf", "Plan");
    await my.saveHome({ blueprintPages: [{ blueprint: "plan", page: 1, level: "ground" }] });

    const result = await my.viewImages({ blueprint: "plan", pages: [3, 1] });
    const tool = core.operations.find((operation) => operation.name === "view_images");
    const text = tool?.text?.(result) ?? "";
    const images = tool?.images?.(result) ?? [];

    expect(
      result.pages.map(({ page, level, hasText }) => ({ page, level: level?.slug, hasText })),
    ).toEqual([
      { page: 3, level: undefined, hasText: false },
      { page: 1, level: "ground", hasText: true },
    ]);
    expect(images.map((image) => image.mimeType)).toEqual(["image/png", "image/png"]);
    expect(images.map((image) => [...image.data.subarray(0, 8)])).toEqual([
      PNG_SIGNATURE,
      PNG_SIGNATURE,
    ]);
    expect(images.map((image) => pngSize(image.data))).toEqual([
      [2000, 1414],
      [1414, 2000],
    ]);
    expect(text.indexOf("Page 3")).toBeGreaterThan(0);
    expect(text.indexOf("Page 3")).toBeLessThan(text.indexOf("Page 1"));
  });

  it("renders a quarter of each page at twice the scale with crop", async () => {
    const my = await setUp();
    await my.upload(A3, "plan.pdf", "Plan");

    const whole = await my.viewImages({ blueprint: "plan", pages: [1] });
    const quarter = await my.viewImages({ blueprint: "plan", pages: [1], crop: "bottom-right" });

    expect(quarter.pages[0]).toMatchObject({ page: 1, crop: "bottom-right", width: 2000 });
    expect(pngSize(quarter.pages[0]?.data as Uint8Array)).toEqual([2000, 1414]);
    expect(quarter.pages[0]?.data).not.toEqual(whole.pages[0]?.data);
  });

  it("sends a page whose PNG is over 1 MB as a JPEG of quality 85", async () => {
    const my = await setUp();
    await my.upload(noisyPng(2000, 1414), "scan.png", "Scan");
    const stored = readFileSync(join(dataDir, "rendered", "my-flat", "scan", "page-1.png"));

    const { pages } = await my.viewImages({ blueprint: "scan", pages: [1] });

    expect(stored.length).toBeGreaterThan(1024 * 1024);
    expect(pages[0]?.mimeType).toBe("image/jpeg");
    expect([...(pages[0]?.data.subarray(0, 3) ?? [])]).toEqual(JPEG_SIGNATURE);
    expect(pages[0]?.data.length).toBeLessThan(stored.length);
  });

  it("renders a page again when its rendered PNG has gone missing", async () => {
    const my = await setUp();
    await my.upload(A3, "plan.pdf", "Plan");
    const png = join(dataDir, "rendered", "my-flat", "plan", "page-1.png");
    rmSync(png);

    const { pages } = await my.viewImages({ blueprint: "plan", pages: [1] });

    expect(pngSize(pages[0]?.data as Uint8Array)).toEqual([2000, 1414]);
    expect(existsSync(png)).toBe(true);
  });

  it("refuses a Blueprint or page the Home does not have, naming what it has", async () => {
    const my = await setUp();
    const noBlueprints = await refusal(my.viewImages({ blueprint: "plan", pages: [1] }));
    await my.upload(A3, "plan.pdf", "Plan");
    const unknown = await refusal(my.viewImages({ blueprint: "estate-plan", pages: [1] }));
    const page = await refusal(my.viewImages({ blueprint: "plan", pages: [1, 2] }));

    expect([noBlueprints.code, unknown.code, page.code]).toEqual(Array(3).fill("not_found"));
    expect(noBlueprints.message).toContain("no Blueprints yet");
    expect(unknown.message).toContain("Plan (plan)");
    expect(page.message).toContain("has no page 2");
  });

  it("never shows another Home's Blueprint", async () => {
    const mine = await setUp("My flat");
    const other = await setUp("Holiday cottage");
    await other.upload(A3, "plan.pdf", "Cottage plan");
    const error = await refusal(mine.viewImages({ blueprint: "cottage-plan", pages: [1] }));
    expect(error.code).toBe("not_found");
  });
});

describe("Blueprint sources", () => {
  it("must name a page of one of this Home's Blueprints; the whole write is refused otherwise", async () => {
    const my = await setUp();
    await my.upload(A3, "plan.pdf", "Agent plan");

    await my.saveRoom({ name: "Kitchen", walls: [{ position: 1, length: printed(3620) }] });
    const page = await refusal(
      my.saveRoom({ name: "Hallway", walls: [{ position: 1, length: printed(1600, 2) }] }),
    );
    const blueprint = await refusal(
      my.saveRoom({
        name: "Hallway",
        walls: [{ position: 1, length: printed(1600, 1, "estate-plan") }],
      }),
    );

    expect([page.code, blueprint.code]).toEqual(["not_found", "not_found"]);
    expect(page.message).toContain("walls.0.length names page 2 of Agent plan (agent-plan)");
    expect(page.message).toContain("only page 1");
    expect(blueprint.message).toContain("Agent plan (agent-plan)");
    const { rooms } = await core.run("get_home", web, { home: my.home });
    expect(rooms.map((room) => room.slug)).toEqual(["kitchen"]);
    const kitchen = await core.run("get_room", web, { home: my.home, room: "kitchen" });
    expect(kitchen.room.walls[0]?.length).toEqual(printed(3620));
  });

  it("can't name another Home's Blueprint", async () => {
    const mine = await setUp("My flat");
    const other = await setUp("Holiday cottage");
    await other.upload(A3, "plan.pdf", "Cottage plan");

    const error = await refusal(
      mine.saveRoom({
        name: "Kitchen",
        walls: [{ position: 1, length: printed(3620, 1, "cottage-plan") }],
      }),
    );

    expect(error.code).toBe("not_found");
    expect(error.message).toContain("no Blueprints yet");
  });

  it("go with blueprint Provenance only, and blueprint Provenance needs one, in every write", async () => {
    const my = await setUp();
    await my.upload(A3, "plan.pdf", "Agent plan");
    const bare: Measurement = { mm: 760, provenance: "blueprint" };
    const sourced: Measurement = { ...measured(760), source: printed(760).source };

    const refusals = await Promise.all([
      refusal(my.saveHome({ accessWidth: bare })),
      refusal(my.saveRoom({ name: "Kitchen", ceilingHeight: bare })),
      refusal(my.saveItems({ items: [{ name: "Sofa", category: "seating", width: bare }] })),
      refusal(my.saveRoom({ name: "Kitchen", ceilingHeight: sourced })),
    ]);

    expect(refusals.map((error) => error.code)).toEqual(Array(4).fill("validation"));
    expect(refusals[0]?.message).toContain("accessWidth has blueprint Provenance but no source");
    expect(refusals[2]?.message).toContain("items.0.width");
    expect(refusals[3]?.message).toContain("a source but measured Provenance");
  });

  it("are stored with the value and shown in receipts", async () => {
    const my = await setUp();
    await my.upload(A3, "plan.pdf", "Agent plan");
    const { receipt } = await my.saveRoom({
      name: "Kitchen",
      walls: [
        {
          position: 1,
          length: {
            ...printed(3620),
            source: { blueprint: "agent-plan", page: 1, printed: "3.62 m" },
          },
        },
      ],
    });
    expect(receipt).toContain("length 3.62 m (Blueprint, agent-plan p.1: 3.62 m)");
  });
});

describe("page-to-Level mapping through save_home", () => {
  it("records the Level each page shows, in list_blueprints and the Home Overview", async () => {
    const my = await setUp();
    await my.upload(THREE_PAGES, "plan.pdf", "Plan");

    const mapped = await my.saveHome({
      levels: [{ name: "First", storey: 1 }],
      blueprintPages: [
        { blueprint: "plan", page: 1, level: "ground" },
        { blueprint: "plan", page: 2, level: "First" },
      ],
    });
    const remapped = await my.saveHome({
      blueprintPages: [
        { blueprint: "plan", page: 2, level: "ground" },
        { blueprint: "plan", page: 1, level: "ground" },
      ],
    });

    expect(mapped.receipt.split("\n")).toEqual([
      "First (first): added, storey 1",
      "Plan (plan) page 1: shows Ground",
      "Plan (plan) page 2: shows First",
    ]);
    expect(remapped.receipt.split("\n")).toEqual([
      "Plan (plan) page 2: shows Ground, was First",
      "Plan (plan) page 1: already shows Ground, nothing changed",
    ]);
    const [plan] = await my.blueprints();
    expect(plan?.pages.map((page) => page.level?.slug)).toEqual(["ground", "ground", undefined]);
    expect(await my.opening()).toContain(
      "Blueprints:\n- Plan (plan): 3 pages; p.1 Ground, p.2 Ground, p.3 no Level yet",
    );
  });

  it("refuses an unknown page, Blueprint, or Level, and changes nothing", async () => {
    const my = await setUp();
    await my.upload(THREE_PAGES, "plan.pdf", "Plan");

    const page = await refusal(
      my.saveHome({
        tenure: "rented",
        blueprintPages: [
          { blueprint: "plan", page: 1, level: "ground" },
          { blueprint: "plan", page: 4, level: "ground" },
        ],
      }),
    );
    const blueprint = await refusal(
      my.saveHome({ blueprintPages: [{ blueprint: "estate-plan", page: 1, level: "ground" }] }),
    );
    const level = await refusal(
      my.saveHome({ blueprintPages: [{ blueprint: "plan", page: 1, level: "loft" }] }),
    );

    expect([page.code, blueprint.code, level.code]).toEqual(Array(3).fill("not_found"));
    expect(page.message).toContain("Plan (plan) has no page 4: it has pages 1 to 3");
    expect(blueprint.message).toContain("Plan (plan)");
    expect(level.message).toContain("Ground (ground)");
    const [plan] = await my.blueprints();
    expect(plan?.pages.map((each) => each.level)).toEqual([undefined, undefined, undefined]);
    const { home } = await core.run("get_home", web, { home: my.home });
    expect(home.tenure).toBeUndefined();
  });

  it("unmaps the pages of a Level when it is removed", async () => {
    const my = await setUp();
    await my.upload(THREE_PAGES, "plan.pdf", "Plan");
    await my.saveHome({
      levels: [{ name: "First", storey: 1 }],
      blueprintPages: [{ blueprint: "plan", page: 2, level: "first" }],
    });

    const { receipt } = await my.saveHome({ levels: [{ level: "first", remove: true }] });

    expect(receipt.split("\n")).toEqual([
      "First (first): removed",
      "Plan (plan) page 2: no longer shows a Level",
    ]);
    const [plan] = await my.blueprints();
    expect(plan?.pages[1]?.level).toBeUndefined();
  });
});

describe("get_blueprint_page", () => {
  it("serves a page's rendered PNG, and refuses a page the Blueprint lacks", async () => {
    const my = await setUp();
    await my.upload(THREE_PAGES, "plan.pdf", "Plan");

    const page = await core.run("get_blueprint_page", web, {
      home: my.home,
      blueprint: "plan",
      page: 2,
    });
    const error = await refusal(
      core.run("get_blueprint_page", web, { home: my.home, blueprint: "plan", page: 9 }),
    );

    expect(page.mimeType).toBe("image/png");
    expect(pngSize(page.data)).toEqual([2000, 1414]);
    expect(error.code).toBe("not_found");
  });
});
