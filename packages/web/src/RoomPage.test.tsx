import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionSummary, Home, RoomDetail } from "./api";
import { FakeEventSource, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const livingRoomRef = { slug: "living-room", name: "Living room" };

/** A get_room answer with every part of a Room Sheet; its Walls arrive out of order. */
function livingRoom(): RoomDetail {
  return {
    slug: "living-room",
    name: "Living room",
    level: { slug: "ground", name: "Ground", storey: 0 },
    functions: ["living", "office"],
    outdoor: false,
    ceilingHeight: { mm: 2600, provenance: "measured" },
    timesOfUse: ["evening", "night"],
    windowless: false,
    walls: [
      {
        slug: "living-room/wall-2",
        position: 2,
        length: { mm: 3600, provenance: "estimated" },
        beyond: { kind: "room", room: { slug: "kitchen", name: "Kitchen", outdoor: false } },
      },
      {
        slug: "living-room/wall-1",
        position: 1,
        length: { mm: 4200, provenance: "measured" },
        facing: "s",
        beyond: { kind: "room", room: { slug: "balcony", name: "Balcony", outdoor: true } },
        label: "window wall",
        obstruction: "partly",
        deciduous: true,
      },
      { slug: "living-room/wall-4", position: 4, beyond: { kind: "unknown" } },
      {
        slug: "living-room/wall-3",
        position: 3,
        length: { mm: 3600, provenance: "blueprint" },
        beyond: { kind: "outside" },
        surface: {
          slug: "living-room/wall-3/surface",
          part: "walls",
          wall: "living-room/wall-3",
          color: { name: "Inchyra Blue", provenance: "estimated" },
        },
      },
    ],
    windows: [
      {
        slug: "living-room-window",
        wall: "living-room/wall-1",
        kind: "bay",
        width: { mm: 2400, provenance: "blueprint" },
        height: { mm: 1500, provenance: "blueprint" },
        sillHeight: { mm: 450, provenance: "estimated" },
        offset: { mm: 300, provenance: "measured" },
      },
      { slug: "skylight", wall: "roof", kind: "roof", roofFacing: "n", glass: "obscured" },
    ],
    doors: [
      {
        slug: "balcony-door",
        wall: "living-room/wall-1",
        to: "outdoor-room",
        otherRoom: { slug: "balcony", name: "Balcony" },
        glazed: true,
        offset: { mm: 2900, provenance: "measured" },
        sideA: true,
      },
      {
        slug: "kitchen-doorway",
        wall: "living-room/wall-2",
        to: "room",
        otherRoom: { slug: "kitchen", name: "Kitchen" },
        otherWall: "kitchen/wall-4",
        noDoor: true,
        clearWidth: { mm: 800, provenance: "measured" },
        // Measured along the Kitchen's Wall 4, so it does not place the doorway here.
        offset: { mm: 500, provenance: "measured" },
        sideA: false,
      },
    ],
    surfaces: [
      {
        slug: "living-room/walls",
        part: "walls",
        materials: [{ material: "plaster" }],
        color: {
          name: "Setting Plaster",
          brand: "Farrow & Ball",
          code: "231",
          hex: "#e3c9b6",
          provenance: "measured",
        },
        finish: "matt",
      },
      {
        slug: "living-room/floor",
        part: "floor",
        materials: [
          { material: "oak boards", where: "living end" },
          { material: "tiles", where: "by the door" },
        ],
      },
    ],
    features: [
      {
        slug: "radiator",
        kind: "radiator",
        wall: "living-room/wall-1",
        positionNote: "under the window",
        width: { mm: 1000, provenance: "measured" },
        height: { mm: 600, provenance: "measured" },
      },
    ],
    items: [
      {
        slug: "sofa",
        name: "Sofa",
        category: "seating",
        quantity: 1,
        room: livingRoomRef,
        wall: "living-room/wall-3",
        width: { mm: 2100, provenance: "measured" },
        depth: { mm: 950, provenance: "estimated" },
      },
      {
        slug: "floor-lamp",
        name: "Floor lamp",
        category: "lighting",
        quantity: 1,
        room: livingRoomRef,
        light: { role: "ambient", colorTemperature: 2700, dimming: "dim-to-warm" },
      },
    ],
    lights: [
      {
        source: "item",
        slug: "floor-lamp",
        name: "Floor lamp",
        light: { role: "ambient", colorTemperature: 2700, dimming: "dim-to-warm" },
      },
    ],
    gaps: ["length of Wall 4", "woodwork Surface"],
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubRoom(room: () => RoomDetail, decisions: () => DecisionSummary[] = () => []) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_room: () => ({ room: room(), decisions: decisions() }),
  });
}

function roomDecision(
  slug: string,
  title: string,
  kind: DecisionSummary["kind"],
  state: DecisionSummary["state"],
  extra: Partial<DecisionSummary> = {},
): DecisionSummary {
  return {
    slug,
    title,
    kind,
    state,
    statement: `${title}.`,
    room: livingRoomRef,
    createdAt: "2026-09-14T10:00:00Z",
    openFlags: [],
    openConflicts: [],
    ...extra,
  };
}

/** The text of the section a heading starts. */
function section(heading: string): string {
  const section = screen.getByRole("heading", { name: heading }).closest("section");
  if (!section) throw new Error(`No section for ${heading}`);
  return section.textContent ?? "";
}

/** The text of what follows a heading: its list or facts. */
function after(heading: string): string {
  return screen.getByRole("heading", { name: heading }).nextElementSibling?.textContent ?? "";
}

function listAfter(heading: string): string[] {
  const list = screen.getByRole("heading", { name: heading }).nextElementSibling;
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) => li.textContent ?? "");
}

it("renders the Room Sheet from get_room as structured sections", async () => {
  const fetch = stubRoom(livingRoom);
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByRole("heading", { name: "Living room", level: 1 });
  const request = fetch.mock.calls.find(([url]) => url === "/api/get_room")?.[1]?.body;
  expect(JSON.parse(String(request))).toEqual({ home: "flat", room: "living-room" });

  // The Room's own facts, the empty ones left out, the lengths tagged with their Provenance.
  expect(document.querySelector("dl")?.textContent).toBe(
    "LevelGround (Level 0)" +
      "Functionsliving, office" +
      "Ceiling height2.60 m Measured" +
      "Times of useevening, night" +
      "DaylightWindow facing S, Skylight facing N, Glazed door facing S",
  );

  // Walls in clockwise order, each with its Windows and Doors in order along it.
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Wall 1 (window wall)",
    "Wall 2",
    "Wall 3",
    "Wall 4",
    "In the roof",
  ]);
  expect(section("Wall 1 (window wall)")).toBe(
    "Wall 1 (window wall)" +
      "Length4.20 m Measured" +
      "FacingS" +
      "BeyondBalcony (outdoor)" +
      "ObstructionPartly, deciduous trees" +
      "Windows and Doors" +
      "Bay window, W 2.40 m × H 1.50 m Blueprint, sill ~0.45 m Estimated, " +
      "0.30 m Measured from the Wall's start" +
      "Glazed door to Balcony, 2.90 m Measured from the Wall's start",
  );
  expect(section("Wall 2")).toBe(
    "Wall 2" +
      "Length~3.60 m Estimated" +
      "BeyondKitchen" +
      "Windows and Doors" +
      "Doorway to Kitchen (its Wall 4), clear width 0.80 m Measured",
  );
  expect(section("Wall 3")).toBe("Wall 3Length3.60 m BlueprintBeyondOutside");
  expect(section("Wall 4")).toBe("Wall 4");
  expect(section("In the roof")).toBe("In the roofRoof window, roof facing N, obscured glass");
  expect(screen.getAllByRole("link", { name: "Kitchen" })[0]?.getAttribute("href")).toBe(
    "/homes/flat/rooms/kitchen",
  );

  // The Surfaces, with the whole-Wall exception after the Room's own.
  expect(after("Surfaces")).toBe(
    "Wallsplaster, Setting Plaster (Farrow & Ball 231) Measured, matt" +
      "Flooroak boards (living end), tiles (by the door)" +
      "Wall 3~Inchyra Blue Estimated",
  );
  expect(listAfter("Features")).toEqual([
    "Radiator or heater, Wall 1, under the window, W 1.00 m × H 0.60 m Measured",
  ]);
  expect(listAfter("Lights")).toEqual(["Floor lamp (Item): ambient, 2700 K, dim to warm"]);
  expect(listAfter("Items")).toEqual([
    "Sofa (Seating), Wall 3, W 2.10 m Measured × D ~0.95 m Estimated",
    "Floor lamp (Lighting), light: ambient, 2700 K, dim to warm",
  ]);
  expect(listAfter("Gaps")).toEqual(["length of Wall 4", "woodwork Surface"]);
});

it("links every value printed on a Blueprint to its page, with the text as printed", async () => {
  const onPlan = (mm: number, printed: string) => ({
    mm,
    provenance: "blueprint" as const,
    source: { blueprint: "estate-agent-plan", page: 2, printed },
  });
  const room = livingRoom();
  stubRoom(() => ({
    ...room,
    walls: [
      {
        slug: "living-room/wall-1",
        position: 1,
        length: onPlan(4190, `13'9"`),
        beyond: { kind: "outside" },
      },
      ...room.walls.filter((wall) => wall.position === 3),
    ],
    windows: [
      {
        slug: "living-room-window",
        wall: "living-room/wall-1",
        width: onPlan(2400, "2400"),
        height: onPlan(1500, "1500"),
      },
    ],
    doors: [],
  }));
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByRole("heading", { name: "Wall 1", level: 3 });

  // Values printed on a Blueprint are tagged one by one, even when they share the Provenance.
  expect(section("Wall 1")).toBe(
    "Wall 1" +
      `Length4.19 m Blueprint p.2: 13'9"` +
      "BeyondOutside" +
      "Windows and Doors" +
      "Window, W 2.40 m Blueprint p.2: 2400 × H 1.50 m Blueprint p.2: 1500",
  );
  expect(screen.getByRole("link", { name: `Blueprint p.2: 13'9"` }).getAttribute("href")).toBe(
    "/homes/flat/blueprints/estate-agent-plan/2",
  );
  // A Blueprint value recorded without its source keeps the plain tag.
  expect(section("Wall 3")).toBe("Wall 3Length3.60 m BlueprintBeyondOutside");
});

it("says what is not recorded when the Room has nothing yet", async () => {
  stubRoom(() => ({
    slug: "box-room",
    name: "Box room",
    level: { slug: "first", name: "First", storey: 1 },
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
    gaps: [],
  }));
  renderRoutes("/homes/flat/rooms/box-room");
  await screen.findByText("No Walls recorded.");
  expect(document.querySelector("dl")?.textContent).toBe("LevelFirst (Level 1)");
  expect(screen.getByText("No Surfaces recorded.")).toBeDefined();
  expect(screen.getByText("No Features recorded.")).toBeDefined();
  expect(screen.getByText("No lights recorded, so how the Room is lit is unknown.")).toBeDefined();
  expect(screen.getByText("No Items in this Room.")).toBeDefined();
  expect(screen.getByText("None: everything advice needs is recorded.")).toBeDefined();
});

it("lists the Room's open Decisions that get_room answers with, each linking to its page", async () => {
  // get_room gives the Candidate, Leaning, and Locked-but-not-Fulfilled ones only.
  stubRoom(livingRoom, () => [
    roomDecision("reading-corner", "A reading corner", "room-use", "candidate"),
    roomDecision("low-sofa", "A low sofa", "purchase", "leaning"),
    roomDecision("calm", "Calm and low", "room-direction", "locked", {
      openFlags: [
        {
          slug: "calm/flag-1",
          decision: { slug: "calm", title: "Calm and low" },
          cause: "reopened",
          source: { kind: "decision", slug: "design-direction", name: "Warm minimalism" },
          raisedAt: "2026-09-14T11:00:00Z",
        },
      ],
    }),
  ]);
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByText("A reading corner");
  expect(listAfter("Decisions")).toEqual([
    "A reading corner, Room use, Candidate",
    "A low sofa, Purchase, Leaning",
    "Calm and low, Room Direction, Locked, Flagged",
  ]);
  expect(screen.getByRole("link", { name: "Calm and low" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/calm",
  );
});

it("says when the Room has no open Decisions, and shows one the Agent adds", async () => {
  let decisions: DecisionSummary[] = [];
  stubRoom(livingRoom, () => decisions);
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByText("No open Decisions.");

  decisions = [roomDecision("calm", "Calm and low", "room-direction", "candidate")];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "calm",
    }),
  );
  expect(await screen.findByText("Calm and low")).toBeDefined();
});

it("shows the refusal when the Room does not exist", async () => {
  stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_room: () =>
      Response.json(
        { error: { code: "not_found", message: 'This Home has no Room "attic".' } },
        { status: 404 },
      ),
  });
  renderRoutes("/homes/flat/rooms/attic");
  expect(await screen.findByText('This Home has no Room "attic".')).toBeDefined();
});

it("shows the new value when the Agent saves the Room while the page is open", async () => {
  let room = livingRoom();
  stubRoom(() => room);
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByText("~3.60 m");

  room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.position === 2 ? { ...wall, length: { mm: 3620, provenance: "measured" } } : wall,
    ),
  };
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "wall",
      recordSlug: "living-room/wall-2",
    }),
  );

  expect(await screen.findByText("3.62 m")).toBeDefined();
  expect(screen.queryByText("~3.60 m")).toBeNull();
});

/** The value of one term in the Surfaces list: "Walls", or a Wall's name for its exception. */
function surfaceFact(term: string): HTMLElement {
  const surfaces = screen.getByRole("heading", { name: "Surfaces" }).nextElementSibling;
  return within(surfaces as HTMLElement).getByText(term).nextElementSibling as HTMLElement;
}

it("shows each Surface color as a swatch, with a placeholder when it has no hex", async () => {
  stubRoom(livingRoom);
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByRole("heading", { name: "Surfaces" });
  const swatch = within(surfaceFact("Walls")).getByTitle("Approximately #e3c9b6");
  expect(swatch.style.backgroundColor).toBe("rgb(227, 201, 182)");
  expect(within(surfaceFact("Wall 3")).getByTitle("No screen color recorded")).toBeDefined();
});

it("shows the new Surface color when a Room color is Fulfilled while the page is open", async () => {
  let room = livingRoom();
  let decisions = [
    roomDecision("olive-walls", "Olive walls", "room-color", "locked"),
    roomDecision("low-sofa", "A low sofa", "purchase", "leaning"),
  ];
  stubRoom(
    () => room,
    () => decisions,
  );
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByText("Olive walls");
  // A Room color is listed with the Room's other open Decisions.
  expect(listAfter("Decisions")).toEqual([
    "Olive walls, Room color, Locked",
    "A low sofa, Purchase, Leaning",
  ]);

  // Fulfilment changes the walls Surface and publishes a surface change, then a decision one.
  room = {
    ...room,
    surfaces: room.surfaces.map((surface) =>
      surface.part === "walls"
        ? {
            ...surface,
            color: { name: "Olive", hex: "#708238", provenance: "estimated" },
            finish: "eggshell",
          }
        : surface,
    ),
  };
  decisions = decisions.filter((decision) => decision.slug !== "olive-walls");
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "surface",
      recordSlug: "living-room/walls",
    }),
  );
  expect(await screen.findByTitle("Approximately #708238")).toBeDefined();
  expect(surfaceFact("Walls").textContent).toBe("plaster, ~Olive Estimated, eggshell");
  expect(screen.queryByTitle("Approximately #e3c9b6")).toBeNull();

  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "olive-walls",
    }),
  );
  await waitFor(() => expect(listAfter("Decisions")).toEqual(["A low sofa, Purchase, Leaning"]));
});
