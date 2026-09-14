import { cleanup, fireEvent, screen } from "@testing-library/react";
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

it("lists the Inventory by Room with an Unplaced group, and includes Archived Items on request", async () => {
  const inventory = [
    item("sofa", "Sofa", "living-room", {
      category: "seating",
      width: { mm: 2100, provenance: "measured" },
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
  const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings()).toEqual(["Living room", "Kitchen", "Unplaced"]);
  expect(screen.getByRole("link", { name: "Kitchen" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/kitchen",
  );
  expect(screen.getByText("Dining chair").parentElement?.textContent).toBe(
    "Dining chair ×6 (Seating)",
  );
  expect(screen.queryByText("Old rug")).toBeNull();

  fireEvent.click(screen.getByLabelText("Include Archived"));

  expect(await screen.findByText("Old rug")).toBeDefined();
  expect(screen.getByText(/^Archived/).textContent).toContain("worn out");
  expect(inputsTo(fetch, "list_items")).toEqual([
    { home: "flat", archived: false },
    { home: "flat", archived: true },
  ]);
});

it("says so when there are no Items", async () => {
  stubItems(() => []);
  renderRoutes("/homes/flat/items");
  expect(await screen.findByText(/No Items yet/)).toBeDefined();
});
