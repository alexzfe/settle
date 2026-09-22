import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Home, Item, ItemPage } from "./api";
import { recordPath } from "./decisions";
import { changedFields, draftOf } from "./ItemEdit";
import { historySummary } from "./ItemPage";
import { FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

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
  decisions: [],
  history: [created("2026-09-15T16:21:00Z", "home-intake-r4qu", ["home-intake"])],
};

const rich: ItemPage = {
  item: { ...mattress, archivedAt: "2026-10-12T10:00:00Z", archivedReason: "sagging" },
  replaces: [{ slug: "old-futon", name: "Old futon" }],
  replacedBy: { slug: "new-mattress", name: "New mattress" },
  picture: { listing: "drimer-aero", photoVersion: "abc123" },
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

function stubItem(record: () => ItemPage, edit?: (input: unknown) => unknown) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_item: () => record(),
    ...(edit
      ? { edit_item: (input) => edit(input) as { receipt: string } }
      : { edit_item: () => ({ receipt: "Saved." }) }),
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
    expect(fact.Size).toBe("W 153 cm × D 203 cm × H 26 cm");
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
    expect(rows).toEqual([
      "relies on itMain bedroom bed frame ◐Leaning" +
        "Fits a 153 × 203 cm mattress (must)Slats ≤ 7 cm apart (must)",
      "bought byA new mattress ●Settled✓ Fulfilled",
      "replaced byA better mattress ●Settled✓ Fulfilled",
    ]);
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
