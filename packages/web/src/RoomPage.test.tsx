import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionSummary, Home, Room, RoomDetail } from "./api";
import { daylightOpenings, facingMeaning, placeOpening, roomSize } from "./RoomPage";
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

const rooms: Room[] = [
  { slug: "hall", name: "Hall", level: "ground" },
  { slug: "living-room", name: "Living room", level: "ground" },
  { slug: "kitchen", name: "Kitchen", level: "ground" },
];

function stubRoom(room: () => RoomDetail, decisions: () => DecisionSummary[] = () => []) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({
      home: { ...flat, homeFolderPath: "~/Homes/flat" },
      levels: [{ slug: "ground", name: "Ground", storey: 0 }],
      rooms,
      unplacedItems: 0,
    }),
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

/** The text of the section or card a heading starts. */
function section(heading: string, level = 2): string {
  const found = partOf(heading, level);
  if (!found) throw new Error(`No section for ${heading}`);
  return found.textContent ?? "";
}

/** A section a heading starts, or for a card's heading the card. */
function partOf(heading: string, level: number): Element | null {
  const [found] = screen
    .getAllByRole("heading", { name: heading, level })
    .filter((each) => each.parentElement?.tagName !== "DIV" || level === 2);
  if (!found) return null;
  return found.closest("section") ?? found.parentElement;
}

/** The items of the first list in the part of the page a heading starts. */
function listIn(heading: string): string[] {
  const part = partOf(heading, 2);
  const list = part?.querySelector("ul");
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) => li.textContent ?? "");
}

/** The drawing card of one Wall, by its title. */
function wallCard(title: string): HTMLElement {
  const button = screen.getByRole("button", {
    name: new RegExp(`^${title.replace(/[()]/g, "\\$&")}`),
  });
  return button.closest("li") as HTMLElement;
}

it("renders the Room Sheet from get_room: banner, Walls, daylight, Gaps, and the rest", async () => {
  const fetch = stubRoom(livingRoom);
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByRole("heading", { name: "Living room", level: 1 });
  const request = fetch.mock.calls.find(([url]) => url === "/api/get_room")?.[1]?.body;
  expect(JSON.parse(String(request))).toEqual({ home: "flat", room: "living-room" });

  // The banner, filled with the walls color, with functions, Level and size as a caption.
  const banner = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
  expect(banner.style.backgroundColor).toBe("rgb(227, 201, 182)");
  expect(banner.textContent).toBe(
    "Living room" +
      "Living, office · Ground (Level 0) · 4.20 × ~3.60 m" +
      "Walls: Setting Plaster (Farrow & Ball 231)",
  );
  // The Room's other facts, the empty ones left out; a Measured length reads plain.
  expect(document.querySelector("dl")?.textContent).toBe(
    "Ceiling height2.60 m" + "Times of useevening, night",
  );

  // One drawing per Wall in clockwise order, with its facing, length, and what lies beyond.
  const titles = screen
    .getAllByRole("button", { expanded: false })
    .map((button) => button.querySelector("span span")?.textContent);
  expect(titles.slice(0, 4)).toEqual(["Wall 1 (window wall)", "Wall 2", "Wall 3", "Wall 4"]);
  expect(wallCard("Wall 1 (window wall)").textContent).toBe(
    "Wall 1 (window wall)SWindow4.20 mBeyond: Balcony (outdoor)" +
      "Glazed door · position not recorded",
  );
  // The doorway is seen from side B, so it is never placed on this Wall.
  expect(wallCard("Wall 2").textContent).toBe(
    "Wall 2?~3.60 mBeyond: Kitchen" + "Doorway · position not recorded",
  );
  expect(wallCard("Wall 4").textContent).toBe("Wall 4?length ?Beyond: not recorded");
  // The bay window is placed from its offset, width, height, and sill; the door lacks a size.
  const wall1 = within(wallCard("Wall 1 (window wall)"));
  expect(wall1.getByRole("img").querySelectorAll("rect")).toHaveLength(2);
  expect(wall1.getByText("Glazed door · position not recorded")).toBeDefined();

  // Clicking a Wall shows its facts below the strip.
  fireEvent.click(screen.getByRole("button", { name: /^Wall 1/ }));
  expect(section("Wall 1 (window wall)", 3)).toBe(
    "Wall 1 (window wall)" +
      "Length4.20 m" +
      "FacingS" +
      "BeyondBalcony (outdoor)" +
      "ObstructionPartly, deciduous trees" +
      "Windows and Doors" +
      "Bay window, W 2.40 m × H 1.50 m Blueprint, sill ~0.45 m estimate, " +
      "0.30 m from the Wall's start" +
      "Glazed door to Balcony, 2.90 m from the Wall's start",
  );
  expect(section("In the roof", 3)).toBe("In the roofRoof window, roof facing N, obscured glass");
  expect(screen.getAllByRole("link", { name: "Kitchen" })[0]?.getAttribute("href")).toBe(
    "/homes/flat/rooms/kitchen",
  );

  // Daylight: the skylight above the compass, the openings with their obstruction, and a line
  // on what the facing means (Madrid is north of the equator, so south faces the sun).
  expect(screen.getByRole("img", { name: /^Compass:/ }).getAttribute("aria-label")).toBe(
    "Compass: Window and Glazed door facing S",
  );
  expect(section("Daylight")).toBe(
    "Daylight" +
      "☼ Skylight facing N" +
      "NNEESESSWWNW2" +
      "▭ Window facing S, Partly blocked (deciduous trees)" +
      "▮ Glazed door facing S, Partly blocked (deciduous trees)" +
      "Faces the sun: bright, warm light, so colors read warmer and lighter, and cool colors hold up well.",
  );

  // Gaps as a checklist, with a prompt naming Home Intake.
  expect(listIn("Gaps")).toEqual(["Length of Wall 4", "Woodwork Surface"]);
  expect(screen.getByRole("button", { name: /Fill the Gaps/ }).getAttribute("title")).toBe(
    `claude "Using the Home Intake Skill: Let's fill the Gaps in Living room: length of Wall 4, woodwork Surface (slug: living-room)"`,
  );

  // Surfaces as swatches, the whole-Wall exception after the Room's own.
  expect(listIn("Surfaces")).toEqual([
    "WallsSetting Plaster (Farrow & Ball 231), plaster, matt",
    "Flooroak boards (living end), tiles (by the door)",
    "Wall 3~Inchyra Blue estimate",
  ]);
  expect(listIn("Features")).toEqual([
    "Radiator or heater, Wall 1, under the window, W 1.00 m × H 0.60 m",
  ]);
  expect(listIn("Lights")).toEqual(["Floor lamp (Item): ambient, 2700 K, dim to warm"]);
  expect(listIn("Items")).toEqual([
    "Sofa (Seating), Wall 3, W 2.10 m × D ~0.95 m estimate",
    "Floor lamp (Lighting), light: ambient, 2700 K, dim to warm",
  ]);

  // The Rooms either side, in the Home's order.
  const nav = within(screen.getByRole("navigation", { name: "Rooms" }));
  expect(nav.getByRole("link", { name: "← Hall" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/hall",
  );
  expect(nav.getByRole("link", { name: "Kitchen →" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/kitchen",
  );
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
  fireEvent.click(await screen.findByRole("button", { name: /^Wall 1/ }));

  // Values printed on a Blueprint are tagged one by one, even when they share the Provenance.
  expect(section("Wall 1", 3)).toBe(
    "Wall 1" +
      `Length4.19 m Blueprint p.2: 13'9"` +
      "BeyondOutside" +
      "Windows and Doors" +
      "Window, W 2.40 m Blueprint p.2: 2400 × H 1.50 m Blueprint p.2: 1500",
  );
  expect(screen.getByRole("link", { name: `Blueprint p.2: 13'9"` }).getAttribute("href")).toBe(
    "/homes/flat/blueprints/estate-agent-plan/2",
  );
  // A Blueprint value recorded without its source keeps the plain chip.
  fireEvent.click(screen.getByRole("button", { name: /^Wall 3/ }));
  expect(section("Wall 3", 3)).toBe("Wall 3Length3.60 m BlueprintBeyondOutside");
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
  expect(screen.getByRole("heading", { level: 1 }).closest("header")?.textContent).toBe(
    "Box roomFirst (Level 1)",
  );
  expect(screen.getByText("No Windows recorded yet.")).toBeDefined();
  expect(screen.getByText("No Surfaces recorded.")).toBeDefined();
  expect(screen.getByText("No Features recorded.")).toBeDefined();
  expect(screen.getByText("No lights recorded, so how the Room is lit is unknown.")).toBeDefined();
  expect(screen.getByText("No Items in this Room.")).toBeDefined();
  expect(section("Gaps")).toBe("Gaps✓ None: everything advice needs is recorded.");
  expect(screen.queryByRole("button", { name: /Fill the Gaps/ })).toBeNull();
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
  expect(listIn("Decisions")).toEqual([
    "○CandidateA reading cornerRoom use",
    "◐LeaningA low sofaPurchase",
    "●LockedCalm and lowRoom Direction⚑",
  ]);
  expect(screen.getByRole("link", { name: "Calm and low" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/calm",
  );
  expect(screen.getByRole("img", { name: "Flagged" })).toBeDefined();
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

/** The card of one Surface: "Walls", or a Wall's name for its exception. */
function surfaceCard(term: string): HTMLElement {
  return screen.getByRole("heading", { name: term, level: 3 }).closest("li") as HTMLElement;
}

it("shows each Surface color as a swatch, with a placeholder when it has no hex", async () => {
  stubRoom(livingRoom);
  renderRoutes("/homes/flat/rooms/living-room");
  await screen.findByRole("heading", { name: "Surfaces" });
  const swatch = within(surfaceCard("Walls")).getByTitle("Approximately #e3c9b6");
  expect(swatch.style.backgroundColor).toBe("rgb(227, 201, 182)");
  expect(within(surfaceCard("Wall 3")).getByTitle("No screen color recorded")).toBeDefined();
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
  expect(listIn("Decisions")).toEqual([
    "●LockedOlive wallsRoom color",
    "◐LeaningA low sofaPurchase",
  ]);

  // Fulfilment changes the walls Surface and publishes a surface change, then a decision one.
  room = {
    ...room,
    surfaces: room.surfaces.map((surface) =>
      surface.part === "walls"
        ? {
            ...surface,
            color: { name: "Olive", hex: "#708238", provenance: "estimated", lrv: 18 },
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
  expect(surfaceCard("Walls").textContent).toBe(
    "Walls~Olive estimate, plaster, eggshellLRV 18 · dark, soaks up light",
  );
  expect(screen.queryByTitle("Approximately #e3c9b6")).toBeNull();
  // The banner takes the new walls color, with light text on the dark ground.
  const banner = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
  expect(banner.style.backgroundColor).toBe("rgb(112, 130, 56)");

  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "olive-walls",
    }),
  );
  await waitFor(() => expect(listIn("Decisions")).toEqual(["◐LeaningA low sofaPurchase"]));
});

describe("placeOpening", () => {
  const measured = (mm: number) => ({ mm, provenance: "measured" as const });

  it("places a Window only with its offset, width, height, and sill", () => {
    const window = {
      slug: "w",
      wall: "r/wall-1",
      offset: measured(300),
      width: measured(1200),
      height: measured(1400),
    };
    expect(placeOpening({ window })).toBeUndefined();
    expect(placeOpening({ window: { ...window, sillHeight: measured(900) } })).toEqual({
      slug: "w",
      kind: "window",
      offset: 300,
      width: 1200,
      height: 1400,
      sill: 900,
    });
  });

  it("never places a Door seen from side B", () => {
    const door = {
      slug: "d",
      wall: "r/wall-2",
      to: "room" as const,
      offset: measured(100),
      clearWidth: measured(800),
      height: measured(2000),
      glazed: true,
    };
    expect(placeOpening({ door: { ...door, sideA: false } })).toBeUndefined();
    expect(placeOpening({ door: { ...door, sideA: true } })?.kind).toBe("glazed door");
  });
});

describe("facingMeaning", () => {
  it("turns the sun side round south of the equator", () => {
    expect(facingMeaning(["n"], 40)).toMatch(/^Faces away from the sun/);
    expect(facingMeaning(["n"], -12)).toMatch(/^Faces the sun:/);
    expect(facingMeaning(["se"], 51)).toMatch(/^Faces the sun in the morning/);
  });

  it("reads east and west by the time of day, and several sides as even light", () => {
    expect(facingMeaning(["e"])).toMatch(/^Faces east/);
    expect(facingMeaning(["w"])).toMatch(/^Faces west/);
    expect(facingMeaning(["s", "sw"], 40)).toMatch(/^Faces the sun/);
    expect(facingMeaning(["s", "w"], 40)).toMatch(/^Light from more than one side/);
    expect(facingMeaning([])).toBe("");
  });
});

it("counts a glazed Door leading outside as daylight, but not one to an indoor Room", () => {
  const room = livingRoom();
  const kinds = (doors: RoomDetail["doors"]) =>
    daylightOpenings({ ...room, windows: [], doors }).map((opening) => opening.kind);
  const [balcony, kitchen] = room.doors as [RoomDetail["doors"][0], RoomDetail["doors"][0]];
  expect(kinds([balcony])).toEqual(["glazed door"]);
  expect(kinds([{ ...kitchen, glazed: true, noDoor: false }])).toEqual([]);
});

it("gives a size only for a four-Walled Room with its first two lengths", () => {
  const room = livingRoom();
  const walls = room.walls.toSorted((a, b) => a.position - b.position);
  expect(roomSize(walls)).toBe("4.20 × ~3.60 m");
  expect(roomSize(walls.slice(0, 3))).toBeUndefined();
});
