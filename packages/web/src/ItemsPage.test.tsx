import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Home, Item, Level, Room } from "./api";
import { groupItems } from "./ItemsPage";
import { FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const levels: Level[] = [
  { slug: "ground", name: "Ground", storey: 0 },
  { slug: "first", name: "First", storey: 1 },
];
const rooms: Room[] = [
  { slug: "living-room", name: "Living room", level: "ground" },
  { slug: "kitchen", name: "Kitchen", level: "ground" },
  { slug: "main-bedroom", name: "Main bedroom", level: "first" },
];
const roomName: Record<string, string> = {
  "living-room": "Living room",
  kitchen: "Kitchen",
  "main-bedroom": "Main bedroom",
  "old-study": "Old study",
};

function item(slug: string, name: string, room?: string, extra: Partial<Item> = {}): Item {
  return {
    slug,
    name,
    category: "decor",
    quantity: 1,
    ...(room ? { room: { slug: room, name: roomName[room] ?? room } } : {}),
    ...extra,
  };
}

describe("groupItems", () => {
  it("groups by Room in the Home's order, then Rooms it no longer lists, then Unplaced", () => {
    const items = [
      item("lamp", "Lamp", "main-bedroom"),
      item("sofa", "Sofa", "living-room"),
      item("mirror", "Mirror"),
      item("armchair", "Armchair", "living-room"),
      item("desk", "Desk", "old-study"),
      item("boxed-books", "Boxed books"),
    ];
    expect(
      groupItems(items, rooms).map((group) => [
        group.title,
        group.room,
        group.items.map((each) => each.name),
      ]),
    ).toEqual([
      ["Living room", "living-room", ["Armchair", "Sofa"]],
      ["Main bedroom", "main-bedroom", ["Lamp"]],
      ["Old study", "old-study", ["Desk"]],
      ["Unplaced", undefined, ["Boxed books", "Mirror"]],
    ]);
  });

  it("has no groups when there are no Items", () => {
    expect(groupItems([], rooms)).toEqual([]);
  });
});

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubItems(list: (archived: boolean) => Item[]) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels, rooms, unplacedItems: 1 }),
    list_items: (input) => ({ items: list(input.archived === true) }),
  });
}

/** Each Item's row as [name and kind, colors and materials, size]. */
function rows(): string[][] {
  return [...document.querySelectorAll("li[class*='row']")].map((row) =>
    [...row.children].map((cell) => cell.textContent ?? ""),
  );
}

/** Each group's heading. */
function groups(): string[] {
  return screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent ?? "");
}

/** The header stats, as they read. */
function stats(): string[] {
  return within(screen.getByRole("list", { name: "Show" }))
    .getAllByRole("button")
    .map((stat) => stat.textContent ?? "");
}

it("lists the Inventory by Room, with Unplaced last, and includes Archived Items on request", async () => {
  const inventory = [
    item("sofa", "Sofa", "living-room", {
      category: "seating",
      width: { mm: 2100, provenance: "measured" },
      depth: { mm: 950, provenance: "estimated" },
      height: { mm: 800, provenance: "measured" },
      colors: [{ name: "Oatmeal", hex: "#d8cbb4", provenance: "estimated" }],
      materials: ["linen"],
      condition: "worn",
      brand: "Muji",
      pricePaid: "€900",
      link: "https://example.com/sofa",
    }),
    item("dining-chair", "Dining chair", "kitchen", { category: "seating", quantity: 6 }),
    item("boxed-lamp", "Boxed lamp", undefined, { category: "lighting" }),
  ];
  const archived = item("old-rug", "Old rug", "living-room", {
    category: "rugs",
    archivedAt: "2026-09-01T12:00:00Z",
    archivedReason: "worn out",
  });
  const fetch = stubItems((withArchived) => (withArchived ? [...inventory, archived] : inventory));
  renderRoutes("/homes/flat/items");

  await screen.findByText("Sofa");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Inventory");
  expect(groups()).toEqual(["Living room 1", "Kitchen 1", "Unplaced 1needs a room"]);
  // Item sizes read in centimetres, and only an Estimated one is marked, with "~".
  expect(rows()).toEqual([
    ["Sofa" + "Seating · Worn", "~Oatmeallinen", "210 × ~95 × 80 cm"],
    ["Dining chair" + "Seating · ×6", "", ""],
    ["Boxed lamp" + "Lighting", "", ""],
  ]);
  expect(screen.getByRole("link", { name: "Kitchen" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/kitchen",
  );

  // The name is the row's only link, and it opens the Item's page.
  const sofa = screen.getByRole("link", { name: "Sofa" });
  expect(sofa.getAttribute("href")).toBe("/homes/flat/items/sofa");
  expect(within(sofa.closest("li") as HTMLElement).getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByText("Muji")).toBeNull();
  expect(screen.queryByText("Old rug")).toBeNull();

  fireEvent.click(screen.getByLabelText("Include Archived"));

  const oldRug = await screen.findByRole("link", { name: "Old rug" });
  expect(oldRug.getAttribute("href")).toBe("/homes/flat/items/old-rug");
  expect(inputsTo(fetch, "list_items")).toEqual([
    { home: "flat", archived: false },
    { home: "flat", archived: true },
  ]);
});

it("opens an Item's page from anywhere in its row", async () => {
  stubItems(() => [item("sofa", "Sofa", "living-room")]);
  const { router } = renderRoutes("/homes/flat/items");
  fireEvent.click(await screen.findByText("Decor"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/homes/flat/items/sofa"));
});

it("counts what is missing in plain words, and a stat filters the list", async () => {
  stubItems(() => [
    item("sofa", "Sofa", "living-room", {
      width: { mm: 2100, provenance: "measured" },
      colors: [{ name: "Oatmeal", provenance: "estimated" }],
    }),
    item("dining-chair", "Dining chair", "kitchen"),
    item("boxed-lamp", "Boxed lamp"),
  ]);
  const { router } = renderRoutes("/homes/flat/items");
  await screen.findByText("Sofa");
  expect(stats()).toEqual(["3 Items", "2 No dimensions", "2 No colors", "1 Unplaced"]);
  expect(document.body.textContent).not.toMatch(/Gap/);

  fireEvent.click(screen.getByRole("button", { name: "2 No colors" }));
  expect(router.state.location.search).toBe("?show=no-colors");
  expect(rows().map((row) => row[0])).toEqual(["Dining chair" + "Decor", "Boxed lamp" + "Decor"]);

  // The same stat again shows everything.
  fireEvent.click(screen.getByRole("button", { name: "2 No colors" }));
  expect(rows()).toHaveLength(3);
});

it("shows the Items a stat names when the page is opened on one", async () => {
  stubItems(() => [item("sofa", "Sofa", "living-room"), item("boxed-lamp", "Boxed lamp")]);
  renderRoutes("/homes/flat/items?show=unplaced");
  await screen.findByText("Boxed lamp");
  expect(rows()).toHaveLength(1);
  expect(groups()).toEqual(["Unplaced 1needs a room"]);
});

it("finds Items by name", async () => {
  stubItems(() => [
    item("sofa", "Sofa", "living-room"),
    item("sofa-cushions", "Sofa cushions"),
    item("mirror", "Mirror"),
  ]);
  renderRoutes("/homes/flat/items");
  await screen.findByText("Mirror");

  fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "sofa" } });
  expect(rows().map((row) => row[0])).toEqual(["SofaDecor", "Sofa cushionsDecor"]);

  fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "lamp" } });
  expect(screen.getByText("No Items match.")).toBeDefined();
});

it("says so when there are no Items, with a prompt for the Agent", async () => {
  stubItems(() => []);
  renderRoutes("/homes/flat/items");
  expect(await screen.findByText(/No Items yet/)).toBeDefined();
  expect(screen.getByRole("button", { name: /Ask the Agent/ })).toBeDefined();
});
