import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Home, Item, ItemPage, Photo } from "./api";
import { recordPath } from "./decisions";
import { changedFields, draftOf } from "./ItemEdit";
import { historySummary } from "./ItemPage";
import { preparePhoto } from "./photoPrep";
import { FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

// jsdom can neither decode nor draw a picture; the compression has its own tests.
vi.mock("./photoPrep", () => ({ preparePhoto: vi.fn() }));
// The crop box is the library's; here it hands back a box around the middle quarter.
vi.mock("./PhotoCrop", () => ({
  default: ({
    src,
    initial,
    onDone,
    onCancel,
  }: {
    src: string;
    initial?: unknown;
    onDone: (crop: unknown) => void;
    onCancel: () => void;
  }) => (
    <section aria-label="Crop the photo" data-src={src} data-initial={JSON.stringify(initial)}>
      <button
        type="button"
        onClick={() => onDone({ unit: "%", x: 25, y: 50, width: 50, height: 25 })}
      >
        Done
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  ),
}));

const flat: Home = { slug: "flat", name: "Flat", country: "Peru", city: "Lima", latitude: -12 };

const rosemary: Item = {
  slug: "rosemary",
  name: "Rosemary",
  category: "plants",
  quantity: 1,
  room: { slug: "balcony", name: "Balcony" },
  positionNote: "in the grey clay pot on the balcony floor",
};

const mattress: Item = {
  slug: "drimer-queen-mattress",
  name: "Drimer Pocket Aero Látex mattress, Queen",
  category: "beds",
  quantity: 1,
  room: { slug: "main-bedroom", name: "Main bedroom" },
  wall: "main-bedroom/wall-3",
  positionNote: "head against the wall opposite the hallway",
  width: { mm: 1530, provenance: "measured" },
  depth: { mm: 2030, provenance: "measured" },
  height: { mm: 260, provenance: "measured" },
  colors: [{ name: "white", provenance: "listed" }],
  materials: ["latex", "pocket springs"],
  condition: "good",
  brand: "Drimer",
  model: "Pocket Aero Látex, Queen Americano",
  link: "https://www.drimer.pe/colchon-pocket-aero-latex-728/p?skuId=730",
  boughtOn: "2025-03",
  boughtFrom: "drimer.pe",
  pricePaid: "S/ 1,299",
  warrantyUntil: "2099-03",
  serialNumber: "DR-1234",
  manualLink: "https://www.drimer.pe/garantia",
  listed: ["boughtFrom", "link"],
};

const created = (at: string, origin: string, skills?: string[]): ItemPage["history"][number] => ({
  at,
  origin,
  ...(skills ? { skills } : {}),
  changes: [{ new: { name: "Drimer queen mattress" } }],
});

const bare: ItemPage = {
  item: rosemary,
  photos: [],
  decisions: [],
  history: [created("2026-09-15T16:21:00Z", "home-intake-r4qu", ["home-intake"])],
};

const rich: ItemPage = {
  item: { ...mattress, archivedAt: "2026-10-12T10:00:00Z", archivedReason: "sagging" },
  replaces: [{ slug: "old-futon", name: "Old futon" }],
  replacedBy: { slug: "new-mattress", name: "New mattress" },
  picture: { listing: "drimer-aero", photoVersion: "abc123" },
  photos: [],
  decisions: [
    {
      relation: "relies-on",
      slug: "bed-frame",
      title: "Main bedroom bed frame",
      state: "leaning",
      fulfilled: false,
      archived: false,
      requirements: [
        { position: 1, text: "Fits a 153 × 203 cm mattress", strength: "must", field: "width" },
        { position: 2, text: "Slats ≤ 7 cm apart", strength: "must" },
      ],
    },
    {
      relation: "bought-by",
      slug: "mattress",
      title: "A new mattress",
      state: "settled",
      fulfilled: true,
      archived: false,
    },
    {
      relation: "replaced-by",
      slug: "better-mattress",
      title: "A better mattress",
      state: "settled",
      fulfilled: true,
      archived: false,
    },
  ],
  history: [
    {
      at: "2026-09-18T05:35:52Z",
      origin: "web",
      changes: [
        {
          field: "width",
          old: { mm: 1530, provenance: "estimated" },
          new: { mm: 1530, provenance: "measured" },
        },
      ],
    },
    {
      at: "2026-09-18T01:36:28Z",
      origin: "purchase-gv9x",
      skills: ["purchase"],
      changes: [
        { field: "name", old: "Drimer queen mattress", new: mattress.name },
        { field: "width", new: { mm: 1530, provenance: "estimated" } },
        { field: "depth", new: { mm: 2030, provenance: "estimated" } },
        { field: "materials", old: ["latex"], new: ["latex", "pocket springs"] },
        { field: "model", new: mattress.model },
      ],
    },
    created("2026-09-15T16:21:00Z", "home-intake-r4qu", ["home-intake"]),
  ],
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubItem(
  record: () => ItemPage,
  edit?: (input: unknown) => unknown,
  photoWrites: Parameters<typeof stubApi>[0] = {},
) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_item: () => record(),
    ...(edit
      ? { edit_item: (input) => edit(input) as { receipt: string } }
      : { edit_item: () => ({ receipt: "Saved." }) }),
    ...photoWrites,
  });
}

/** The facts list as [term, value] pairs. */
function facts(): [string, string][] {
  const list = document.querySelector("dl");
  if (!list) return [];
  return [...list.querySelectorAll("dt")].map((dt) => [
    dt.textContent ?? "",
    dt.nextElementSibling?.textContent ?? "",
  ]);
}

function headings(): string[] {
  return screen.getAllByRole("heading").map((heading) => heading.textContent ?? "");
}

describe("a bare Item", () => {
  it("shows only what is recorded: no empty labels, no blank sections, no picture", async () => {
    stubItem(() => bare);
    renderRoutes("/homes/flat/items/rosemary");
    await screen.findByRole("heading", { name: "Rosemary" });
    expect(facts()).toEqual([["Where", "Balcony · in the grey clay pot on the balcony floor"]]);
    expect(headings()).toEqual(["Rosemary", "History"]);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/from the Listing/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/—|Not recorded|Listed/);
    expect(screen.getByText("Plants")).toBeDefined();
    // One history line, naming and linking its Session.
    const history = screen.getByRole("heading", { name: "History" }).closest("section");
    expect(within(history as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Home Intake Session" }).getAttribute("href")).toBe(
      "/homes/flat/sessions/home-intake-r4qu",
    );
    expect(history?.textContent).toContain("Home Intake Session: added");
  });

  it("says so when only a name is recorded, pointing at the pencil", async () => {
    stubItem(() => ({
      ...bare,
      item: { slug: "vase", name: "Vase", category: "decor", quantity: 1 },
    }));
    renderRoutes("/homes/flat/items/vase");
    await screen.findByRole("heading", { name: "Vase" });
    expect(screen.getByText("Only a name is recorded. ✎ to add more.")).toBeDefined();
    expect(document.querySelector("dl")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit its facts" })).toBeDefined();
  });

  it("leaves the History out when it has none", async () => {
    stubItem(() => ({ ...bare, history: [] }));
    renderRoutes("/homes/flat/items/rosemary");
    await screen.findByRole("heading", { name: "Rosemary" });
    expect(headings()).toEqual(["Rosemary"]);
  });
});

describe("a rich Item", () => {
  it("shows its register in order, with Listed tags and dates at their precision", async () => {
    stubItem(() => rich);
    renderRoutes("/homes/flat/items/drimer-queen-mattress");
    await screen.findByRole("heading", { name: mattress.name });
    expect(facts().map(([term]) => term)).toEqual([
      "Where",
      "Size",
      "Colors & materials",
      "Brand · Model",
      "Bought",
      "Warranty",
      "Serial",
      "Manual",
      "Link",
    ]);
    const fact = Object.fromEntries(facts());
    expect(fact.Where).toBe("Main bedroom · Wall 3 · head against the wall opposite the hallway");
    // The page examines one record, so every Provenance is written out, Measured included.
    expect(fact.Size).toBe("W 153 cm × D 203 cm × H 26 cm Measured");
    expect(fact["Colors & materials"]).toBe("white Listedlatex, pocket springs");
    expect(fact["Brand · Model"]).toBe("Drimer · Pocket Aero Látex, Queen Americano");
    expect(fact.Bought).toBe("Mar 2025 from drimer.pe Listed · S/ 1,299");
    expect(fact.Warranty).toMatch(/^until Mar 2099 \(ends in \d+ months\)$/);
    expect(fact.Link).toBe("drimer.pe Listed");
    expect(screen.getAllByText("Listed")[0]?.getAttribute("title")).toMatch(/^From the Listing/);
    expect(screen.getByText("Beds · Good")).toBeDefined();
  });

  it("shows the Archived banner, what it replaces, and the picture from the Listing", async () => {
    stubItem(() => rich);
    renderRoutes("/homes/flat/items/drimer-queen-mattress");
    await screen.findByRole("heading", { name: mattress.name });
    const banner = screen.getByText(/^Archived 12 Oct 2026/);
    expect(banner.textContent).toBe("Archived 12 Oct 2026 — replaced by New mattress");
    expect(screen.getByText("sagging")).toBeDefined();
    expect(screen.getByRole("link", { name: "New mattress" }).getAttribute("href")).toBe(
      "/homes/flat/items/new-mattress",
    );
    expect(screen.getByRole("link", { name: "Old futon" }).getAttribute("href")).toBe(
      "/homes/flat/items/old-futon",
    );
    const picture = screen.getByRole("img", { name: mattress.name });
    expect(picture.getAttribute("src")).toBe(
      "/api/get_listing_photo?home=flat&listing=drimer-aero&v=abc123",
    );
    expect(picture.closest("figure")?.textContent).toBe("from the Listing");
  });

  it("shows each relation to a Decision, with the Requirements that rely on it", async () => {
    stubItem(() => rich);
    renderRoutes("/homes/flat/items/drimer-queen-mattress");
    const section = (await screen.findByRole("heading", { name: "Decisions" })).closest("section");
    const rows = [...(section?.querySelectorAll(":scope > ul > li") ?? [])].map(
      (row) => row.textContent,
    );
    // The mark is the state: it is named for a screen reader, not written in the row.
    expect(rows).toEqual([
      "relies on itMain bedroom bed frame" +
        "Fits a 153 × 203 cm mattress (must)Slats ≤ 7 cm apart (must)",
      "bought byA new mattress✓ Fulfilled",
      "replaced byA better mattress✓ Fulfilled",
    ]);
    expect(
      within(section as HTMLElement)
        .getAllByRole("img")
        .map((mark) => mark.getAttribute("aria-label")),
    ).toEqual(["Leaning", "Settled", "Settled"]);
    expect(screen.getByRole("link", { name: "Main bedroom bed frame" }).getAttribute("href")).toBe(
      "/homes/flat/decisions/bed-frame",
    );
  });

  it("reads each change event as one line, opening to the exact values", async () => {
    stubItem(() => rich);
    renderRoutes("/homes/flat/items/drimer-queen-mattress");
    const section = (await screen.findByRole("heading", { name: "History" })).closest("section");
    const lines = () =>
      [...(section?.querySelectorAll(":scope > ul > li > p") ?? [])].map((line) =>
        line.textContent?.replace(/^\d+ [A-Z][a-z]{2}/, "<date>"),
      );
    expect(lines()).toEqual([
      "<date>Edited here: size now Measured▸",
      "<date>Purchase Session: renamed; size, model set; materials changed▸",
      "<date>Home Intake Session: added",
    ]);
    const [open] = screen.getAllByRole("button", { name: "Show the exact changes" });
    fireEvent.click(open as HTMLElement);
    expect(screen.getByText("width 153 cm (Estimated) → 153 cm (Measured)")).toBeDefined();
  });
});

describe("the history summary", () => {
  it("reads an archiving with its reason", () => {
    expect(
      historySummary([
        { field: "archivedAt", new: "2026-10-12T10:00:00Z" },
        { field: "archivedReason", new: "worn out" },
      ]),
    ).toBe("archived: worn out");
  });

  it("reads cleared fields", () => {
    expect(historySummary([{ field: "serialNumber", old: "X1" }])).toBe("serial cleared");
  });
});

describe("the pencil", () => {
  it("sends only what changed: cm as mm, a warranty length as a date, a cleared field as null", async () => {
    const fetch = stubItem(() => ({ ...bare, item: { ...rosemary, brand: "Vivero" } }));
    renderRoutes("/homes/flat/items/rosemary");
    fireEvent.click(await screen.findByRole("button", { name: "Edit its facts" }));
    const form = screen.getByRole("form", { name: "Edit its facts" });
    // Every editable field is there, empty ones included.
    for (const label of ["Width", "Depth", "Height", "Condition", "Bought on", "Serial number"]) {
      expect(within(form).getByLabelText(label)).toBeDefined();
    }
    expect(within(form).queryByLabelText("Name")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Width"), { target: { value: "30.5" } });
    fireEvent.change(within(form).getByLabelText("Height"), { target: { value: "45" } });
    const height = within(form).getByRole("radiogroup", { name: "Height: how it is known" });
    fireEvent.click(within(height).getByLabelText("Estimated"));
    fireEvent.change(within(form).getByLabelText("Bought on"), { target: { value: "2024-03" } });
    fireEvent.change(within(form).getByLabelText("Warranty until"), {
      target: { value: "2 years" },
    });
    fireEvent.change(within(form).getByLabelText("Brand"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add a material" }));
    fireEvent.change(within(form).getByLabelText("Material 1"), { target: { value: "clay" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(inputsTo(fetch, "edit_item")).toHaveLength(1));
    expect(inputsTo(fetch, "edit_item")[0]).toEqual({
      home: "flat",
      item: "rosemary",
      fields: {
        width: { mm: 305, provenance: "measured" },
        height: { mm: 450, provenance: "estimated" },
        boughtOn: "2024-03",
        warrantyUntil: "2026-03",
        brand: null,
        materials: ["clay"],
      },
    });
    // Saved, the form closes and the page is read afresh.
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect(inputsTo(fetch, "get_item")).toHaveLength(2);
  });

  it("refuses a warranty length with no bought on, saying why, and sends nothing", async () => {
    const fetch = stubItem(() => bare);
    renderRoutes("/homes/flat/items/rosemary");
    fireEvent.click(await screen.findByRole("button", { name: "Edit its facts" }));
    fireEvent.change(screen.getByLabelText("Warranty until"), { target: { value: "2 years" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toMatch(/needs a bought on date/);
    expect(inputsTo(fetch, "edit_item")).toEqual([]);
  });

  it("shows the server's refusal", async () => {
    stubItem(
      () => bare,
      () =>
        Response.json(
          {
            error: {
              code: "invalid_input",
              message: "Bought on must be 2024, 2024-03, or 2024-03-14.",
            },
          },
          { status: 400 },
        ),
    );
    renderRoutes("/homes/flat/items/rosemary");
    fireEvent.click(await screen.findByRole("button", { name: "Edit its facts" }));
    fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Bought on must be 2024, 2024-03, or 2024-03-14.",
    );
    expect(screen.getByRole("form")).toBeDefined();
  });

  it("closes on Cancel without sending", async () => {
    const fetch = stubItem(() => bare);
    renderRoutes("/homes/flat/items/rosemary");
    fireEvent.click(await screen.findByRole("button", { name: "Edit its facts" }));
    fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
    expect(inputsTo(fetch, "edit_item")).toEqual([]);
  });
});

describe("changedFields", () => {
  it("sends nothing when nothing changed, whatever the Provenance", () => {
    const listed: Item = { ...mattress, width: { mm: 1530, provenance: "listed" } };
    expect(changedFields(listed, draftOf(listed))).toEqual({ fields: {}, errors: [] });
  });

  it("sends a size whose switch alone changed, and keeps a color kept by name", () => {
    const draft = draftOf(mattress);
    draft.sizes.depth.provenance = "estimated";
    draft.colors = ["white", "grey"];
    expect(changedFields(mattress, draft).fields).toEqual({
      depth: { mm: 2030, provenance: "estimated" },
      colors: [
        { name: "white", provenance: "listed" },
        { name: "grey", provenance: "estimated" },
      ],
    });
  });

  it("clears an emptied size and list", () => {
    const draft = draftOf(mattress);
    draft.sizes.height.cm = "";
    draft.materials = [" "];
    expect(changedFields(mattress, draft).fields).toEqual({ height: null, materials: null });
  });

  it("refuses a size that is not centimetres, and a malformed date", () => {
    const draft = draftOf(rosemary);
    draft.sizes.width.cm = "1.5 m";
    draft.text.boughtOn = "March 2024";
    expect(changedFields(rosemary, draft).errors).toEqual([
      "Bought on: give a year, a month, or a day, like 2024, 2024-03, or 2024-03-14.",
      "Width: give it in centimetres, like 153 or 153.5.",
    ]);
  });
});

it("refetches the page on an Item change, and on a Decision change", async () => {
  const fetch = stubItem(() => bare);
  renderRoutes("/homes/flat/items/rosemary");
  await screen.findByRole("heading", { name: "Rosemary" });
  FakeEventSource.open().emit("change", {
    home: "flat",
    recordKind: "item",
    recordSlug: "rosemary",
  });
  await waitFor(() => expect(inputsTo(fetch, "get_item")).toHaveLength(2));
  FakeEventSource.open().emit("change", { home: "flat", recordKind: "decision", recordSlug: "x" });
  await waitFor(() => expect(inputsTo(fetch, "get_item")).toHaveLength(3));
});

it("links every Item mention to its page", () => {
  expect(recordPath("flat", "item", "rosemary")).toBe("/homes/flat/items/rosemary");
});

describe("Photos", () => {
  const march: Photo = {
    id: 7,
    version: "a1b2",
    takenOn: "2026-03-14",
    caption: "scratch on the left leg",
  };
  const january: Photo = { id: 3, version: "c3d4", takenOn: "2026-01-02" };
  const withPhotos: ItemPage = { ...rich, photos: [march, january] };

  it("shows the newest Photo in the Listing picture's place, the Listing picture not at all", async () => {
    stubItem(() => withPhotos);
    renderRoutes("/homes/flat/items/drimer-queen-mattress");
    await screen.findByRole("heading", { name: mattress.name });
    expect(screen.queryByText("from the Listing")).toBeNull();
    expect(document.querySelector('img[src*="get_listing_photo"]')).toBeNull();
    const main = screen.getByRole("img", { name: mattress.name });
    expect(main.getAttribute("src")).toBe(
      "/api/get_photo?home=flat&item=drimer-queen-mattress&photo=7&size=full&v=a1b2",
    );
    expect(main.closest("figure")?.querySelector("figcaption")?.textContent).toBe(
      "14 Mar 2026scratch on the left leg",
    );
    // The others as thumbnails beneath it.
    const strip = screen.getByRole("list", { name: "More photos" });
    const thumbs = within(strip).getAllByRole("button");
    expect(thumbs.map((thumb) => thumb.getAttribute("aria-label"))).toEqual([
      "Open the photo from 2 Jan 2026",
    ]);
    expect(thumbs[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/get_photo?home=flat&item=drimer-queen-mattress&photo=3&size=thumb&v=c3d4",
    );
  });

  it("shows no strip for one Photo, and nothing of Photos but the add buttons for none", async () => {
    stubItem(() => ({ ...bare, photos: [january] }));
    renderRoutes("/homes/flat/items/rosemary");
    await screen.findByRole("heading", { name: "Rosemary" });
    expect(screen.queryByRole("list", { name: "More photos" })).toBeNull();
    cleanup();
    stubItem(() => bare);
    renderRoutes("/homes/flat/items/rosemary");
    await screen.findByRole("heading", { name: "Rosemary" });
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.body.textContent).not.toMatch(/No photos/i);
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Choose photo" })).toBeDefined();
  });

  it("offers the camera first, and the library through a plain file input", async () => {
    stubItem(() => bare);
    renderRoutes("/homes/flat/items/rosemary");
    const take = await screen.findByRole("button", { name: "Take photo" });
    const choose = screen.getByRole("button", { name: "Choose photo" });
    expect(take.compareDocumentPosition(choose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const camera = screen.getByLabelText("Photo from the camera") as HTMLInputElement;
    expect(camera.getAttribute("accept")).toBe("image/*");
    expect(camera.getAttribute("capture")).toBe("environment");
    const file = screen.getByLabelText("Photo file") as HTMLInputElement;
    expect(file.getAttribute("accept")).toBe("image/*");
    expect(file.hasAttribute("capture")).toBe(false);
    const clicked = vi.spyOn(camera, "click").mockImplementation(() => {});
    fireEvent.click(take);
    expect(clicked).toHaveBeenCalled();
  });

  it("adds a Photo through a plain file input: made ready, previewed, captioned, sent", async () => {
    const file = new Blob(["small"], { type: "image/jpeg" });
    const thumb = new Blob(["smaller"], { type: "image/jpeg" });
    vi.mocked(preparePhoto).mockResolvedValue({ file, thumb, takenOn: "2026-03-14" });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() }),
    );
    let sent: FormData | undefined;
    const fetch = stubItem(() => bare, undefined, {
      add_photo: (form) => {
        sent = form;
        return { photos: [march] };
      },
    });
    renderRoutes("/homes/flat/items/rosemary");
    await screen.findByRole("button", { name: "Choose photo" });
    const input = screen.getByLabelText("Photo file") as HTMLInputElement;
    const picked = new File(["big"], "IMG_0001.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [picked] } });
    const form = await screen.findByRole("form", { name: "Add a photo" });
    expect(preparePhoto).toHaveBeenCalledWith(picked);
    expect(within(form).getByRole("img").getAttribute("src")).toBe("blob:preview");
    // Crop is offered, never opened unasked.
    expect(within(form).getByRole("button", { name: "Crop" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Crop the photo" })).toBeNull();
    fireEvent.change(within(form).getByLabelText("Caption (optional)"), {
      target: { value: " under the window " },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Add a photo" })).toBeNull());
    const posted = sent as FormData;
    expect(posted.get("home")).toBe("flat");
    expect(posted.get("item")).toBe("rosemary");
    expect(await (posted.get("file") as Blob).text()).toBe("small");
    expect(await (posted.get("thumb") as Blob).text()).toBe("smaller");
    expect(posted.get("takenOn")).toBe("2026-03-14");
    expect(posted.get("caption")).toBe("under the window");
    await waitFor(() => expect(inputsTo(fetch, "get_item")).toHaveLength(2));
  });

  it("shows core's refusal of a photo it could not take", async () => {
    const original = new File(["ftypheic"], "IMG_0002.HEIC", { type: "image/heic" });
    vi.mocked(preparePhoto).mockResolvedValue({ file: original, thumb: original });
    const message = "This is a HEIC photo, which the app cannot read. Export it as a JPEG.";
    stubItem(() => bare, undefined, {
      add_photo: () =>
        Response.json({ error: { code: "unsupported_file", message } }, { status: 400 }),
    });
    renderRoutes("/homes/flat/items/rosemary");
    await screen.findByRole("button", { name: "Choose photo" });
    fireEvent.change(screen.getByLabelText("Photo file"), { target: { files: [original] } });
    const form = await screen.findByRole("form", { name: "Add a photo" });
    // Not decoded here, so not previewed or cropped either: its name stands in.
    expect(within(form).queryByRole("img")).toBeNull();
    expect(within(form).getByText("IMG_0002.HEIC")).toBeDefined();
    expect(within(form).queryByRole("button", { name: "Crop" })).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect((await within(form).findByRole("alert")).textContent).toBe(message);
  });

  it("crops a Photo before it is sent, and reopens the crop from the whole picture", async () => {
    const whole = {
      file: new Blob(["whole"]),
      thumb: new Blob(["w"]),
      size: { width: 4000, height: 3000 },
    };
    const cut = {
      file: new Blob(["cut"]),
      thumb: new Blob(["c"]),
      size: { width: 4000, height: 3000 },
    };
    vi.mocked(preparePhoto).mockImplementation(async (_, crop) => (crop ? cut : whole));
    let urls = 0;
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => `blob:${++urls}`, revokeObjectURL: vi.fn() }),
    );
    let sent: FormData | undefined;
    stubItem(() => bare, undefined, {
      add_photo: (form) => {
        sent = form;
        return { photos: [march] };
      },
    });
    renderRoutes("/homes/flat/items/rosemary");
    await screen.findByRole("button", { name: "Choose photo" });
    const picked = new File(["big"], "IMG_0001.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Photo file"), { target: { files: [picked] } });
    let form = await screen.findByRole("form", { name: "Add a photo" });
    fireEvent.change(within(form).getByLabelText("Caption (optional)"), {
      target: { value: "the lamp" },
    });

    // Cancel keeps the photo as it was.
    fireEvent.click(within(form).getByRole("button", { name: "Crop" }));
    let crop = await screen.findByRole("region", { name: "Crop the photo" });
    expect(crop.dataset.src).toBe("blob:1");
    fireEvent.click(within(crop).getByRole("button", { name: "Cancel" }));
    form = await screen.findByRole("form", { name: "Add a photo" });
    expect(within(form).getByRole("img").getAttribute("src")).toBe("blob:1");
    expect(preparePhoto).toHaveBeenCalledTimes(1);

    // Done cuts the box from the whole picture, in its own pixels, and previews the result.
    fireEvent.click(within(form).getByRole("button", { name: "Crop" }));
    crop = await screen.findByRole("region", { name: "Crop the photo" });
    fireEvent.click(within(crop).getByRole("button", { name: "Done" }));
    form = await screen.findByRole("form", { name: "Add a photo" });
    await waitFor(() => expect(within(form).getByRole("img").getAttribute("src")).toBe("blob:2"));
    expect(preparePhoto).toHaveBeenLastCalledWith(picked, {
      x: 1000,
      y: 1500,
      width: 2000,
      height: 750,
    });

    // Reopened, it shows the whole picture again with the last box.
    fireEvent.click(within(form).getByRole("button", { name: "Crop" }));
    crop = await screen.findByRole("region", { name: "Crop the photo" });
    expect(crop.dataset.src).toBe("blob:1");
    expect(JSON.parse(crop.dataset.initial ?? "null")).toEqual({
      unit: "%",
      x: 25,
      y: 50,
      width: 50,
      height: 25,
    });
    fireEvent.click(within(crop).getByRole("button", { name: "Cancel" }));

    form = await screen.findByRole("form", { name: "Add a photo" });
    expect(within(form).getByLabelText<HTMLInputElement>("Caption (optional)").value).toBe(
      "the lamp",
    );
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toBeDefined());
    expect(await ((sent as FormData).get("file") as Blob).text()).toBe("cut");
    expect(await ((sent as FormData).get("thumb") as Blob).text()).toBe("c");
  });

  it("opens a Photo full size, steps to the next, and edits and clears its caption", async () => {
    const fetch = stubItem(() => withPhotos, undefined, {
      edit_photo: () => ({ photos: [march, january] }),
    });
    renderRoutes("/homes/flat/items/drimer-queen-mattress");
    fireEvent.click(await screen.findByRole("button", { name: "Open the photo from 14 Mar 2026" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("1 of 2")).toBeDefined();
    expect(within(dialog).getByText("scratch on the left leg")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit the caption" }));
    fireEvent.change(within(dialog).getByLabelText("Caption"), {
      target: { value: "scratch, left leg" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(inputsTo(fetch, "edit_photo")).toHaveLength(1));
    expect(inputsTo(fetch, "edit_photo")[0]).toEqual({
      home: "flat",
      item: "drimer-queen-mattress",
      photo: 7,
      caption: "scratch, left leg",
    });
    // The arrow keys step too, wherever focus fell after the save.
    await waitFor(() =>
      expect(within(dialog).queryByRole("form", { name: "Edit the caption" })).toBeNull(),
    );
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(within(dialog).getByText("2 Jan 2026")).toBeDefined();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(within(dialog).getByText("1 of 2")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next ›" }));
    expect(within(dialog).getByText("2 Jan 2026")).toBeDefined();
    expect(within(dialog).getByText("2 of 2")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "‹ Previous" }));
    await waitFor(() =>
      expect(within(dialog).queryByRole("form", { name: "Edit the caption" })).toBeNull(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit the caption" }));
    fireEvent.change(within(dialog).getByLabelText("Caption"), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(inputsTo(fetch, "edit_photo")).toHaveLength(2));
    expect(inputsTo(fetch, "edit_photo")[1]).toMatchObject({ photo: 7, caption: null });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes a Photo only once armed, and keeps it when the user says so", async () => {
    let photos = [march, january];
    const fetch = stubItem(() => ({ ...rich, photos }), undefined, {
      delete_photo: (input) => {
        photos = photos.filter((photo) => photo.id !== input.photo);
        return { photos };
      },
    });
    renderRoutes("/homes/flat/items/drimer-queen-mattress");
    fireEvent.click(await screen.findByRole("button", { name: "Open the photo from 14 Mar 2026" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(within(dialog).getByText("Deletes this photo for good.")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(within(dialog).queryByText("Deletes this photo for good.")).toBeNull();
    expect(inputsTo(fetch, "delete_photo")).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(inputsTo(fetch, "delete_photo")).toHaveLength(1));
    expect(inputsTo(fetch, "delete_photo")[0]).toEqual({
      home: "flat",
      item: "drimer-queen-mattress",
      photo: 7,
    });
    // The one left takes its place, in the dialog and on the page.
    await waitFor(() => expect(within(dialog).getByText("2 Jan 2026")).toBeDefined());
    await waitFor(() =>
      expect(
        screen.getAllByRole("img", { name: mattress.name }).map((img) => img.getAttribute("src")),
      ).toEqual([
        "/api/get_photo?home=flat&item=drimer-queen-mattress&photo=3&size=full&v=c3d4",
        "/api/get_photo?home=flat&item=drimer-queen-mattress&photo=3&size=full&v=c3d4",
      ]),
    );
  });

  it("reads a Photo's history as added, captioned, and deleted", () => {
    expect(historySummary([{ field: "photo", new: { takenOn: "2026-03-14" } }])).toBe(
      "photo added",
    );
    expect(historySummary([{ field: "photo caption", old: "a", new: "b" }])).toBe(
      "photo caption changed",
    );
    expect(historySummary([{ field: "photo", old: { takenOn: "2026-03-14" } }])).toBe(
      "photo deleted",
    );
  });
});
