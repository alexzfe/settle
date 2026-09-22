import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionSummary, Home, Level, Room, RoomDetail } from "./api";
import { type ApiHandlers, FakeEventSource, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };
const upper: Level = { slug: "upper", name: "", storey: 1 };

const kitchen: Room = { slug: "kitchen", name: "Kitchen", level: "ground" };
const living: Room = { slug: "living-room", name: "Living room", level: "ground" };
const bedroom: Room = { slug: "bedroom", name: "Bedroom", level: "upper" };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The Rooms page's operations, answering with an empty Home unless `handlers` says otherwise. */
function stubRoomsPage(handlers: ApiHandlers) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground, upper], rooms: [], unplacedItems: 0 }),
    list_decisions: () => ({ decisions: [] }),
    ...handlers,
  });
}

/** A Room Sheet with nothing recorded but its Gaps. */
function roomDetail(room: Room, gaps: string[]): RoomDetail {
  return {
    slug: room.slug,
    name: room.name,
    level: room.level === "upper" ? upper : ground,
    functions: [],
    outdoor: false,
    timesOfUse: [],
    windowless: false,
    walls: [],
    windows: [],
    doors: [],
    surfaces: [],
    features: [],
    items: [],
    lights: [],
    gaps,
  };
}

function openDecision(slug: string, room: Room, state: DecisionSummary["state"]): DecisionSummary {
  return {
    slug,
    title: slug,
    kind: "purchase",
    state,
    statement: `${slug}.`,
    createdAt: "2026-09-14T10:00:00Z",
    openFlags: [],
    openConflicts: [],
    room: { slug: room.slug, name: room.name },
  };
}

it("shows every Room by Level under a summary line, titled for the Home", async () => {
  const gaps: Record<string, string[]> = {
    kitchen: ["ceiling height"],
    "living-room": [],
    bedroom: ["floor Surface", "times of use"],
  };
  stubRoomsPage({
    get_home: () => ({
      home: flat,
      levels: [upper, ground],
      rooms: [kitchen, living, bedroom],
      unplacedItems: 3,
    }),
    get_room: (input) => {
      const room = [kitchen, living, bedroom].find((each) => each.slug === input.room);
      if (!room) throw new Error(`No Room ${input.room}`);
      return { room: roomDetail(room, gaps[room.slug] ?? []), decisions: [] };
    },
    list_decisions: () => ({
      decisions: [
        openDecision("rug", living, "candidate"),
        openDecision("lamp", bedroom, "leaning"),
        openDecision("sofa", living, "settled"),
      ],
    }),
  });
  renderRoutes("/homes/flat/rooms");
  expect(await screen.findByRole("heading", { level: 1, name: "Rooms" })).toBeDefined();
  await waitFor(() =>
    expect(screen.getByText("3 Rooms · 2 with Gaps · 2 open Decisions")).toBeDefined(),
  );
  await waitFor(() => expect(document.title).toBe("Rooms · Flat · Settle"));

  const levels = screen.getAllByRole("heading", { level: 3 });
  expect(levels.map((heading) => heading.textContent)).toEqual(["Level 0 · Ground", "Level 1"]);
  const groundTiles = levels[0]?.parentElement as HTMLElement;
  expect(
    within(groundTiles)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Kitchen", "Living room"]);
  expect(screen.getByRole("link", { name: "Bedroom" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/bedroom",
  );
  expect(screen.getByRole("link", { name: "3 Unplaced Items" }).getAttribute("href")).toBe(
    "/homes/flat/items",
  );
});

it("offers Home Intake when there are no Rooms yet", async () => {
  stubRoomsPage({});
  renderRoutes("/homes/flat/rooms");
  const empty = (await screen.findByText("No Rooms yet")).parentElement as HTMLElement;
  expect(within(empty).getByRole("button", { name: /Ask the Agent/ })).toBeDefined();
  expect(screen.queryByText(/0 Rooms/)).toBeNull();
  expect(screen.getByRole("link", { name: "0 Unplaced Items" })).toBeDefined();
});
