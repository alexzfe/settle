import type { PaletteColor } from "@settle/core";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Conflict,
  DecisionSummary,
  Flag,
  Home,
  Level,
  Room,
  RoomDetail,
  Session,
} from "./api";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The Home page's operations, answering with an empty Home unless `handlers` says otherwise. */
function stubHomePage(handlers: ApiHandlers) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms: [], unplacedItems: 0 }),
    list_sessions: () => ({ sessions: [] }),
    list_decisions: () => ({ decisions: [] }),
    ...handlers,
  });
}

const raised = "2026-09-14T10:00:00Z";

function summary(
  slug: string,
  title: string,
  kind: DecisionSummary["kind"],
  state: DecisionSummary["state"],
): DecisionSummary {
  return {
    slug,
    title,
    kind,
    state,
    statement: `${title}.`,
    createdAt: raised,
    openFlags: [],
    openConflicts: [],
  };
}

const calm = summary("living-room-direction", "Calm and low", "room-direction", "locked");
const nook = summary("hallway-use", "Reading nook", "room-use", "candidate");
const sofa = summary("sofa", "A low sofa", "purchase", "locked");

/** A flag raised on `decision` when the Design Direction was reopened. */
function flagOn(decision: DecisionSummary): Flag {
  return {
    slug: `${decision.slug}/flag-1`,
    decision: { slug: decision.slug, title: decision.title },
    cause: "reopened",
    source: { kind: "decision", slug: "design-direction", name: "Warm minimalism" },
    raisedAt: raised,
  };
}

function conflictOn(decision: DecisionSummary, description: string): Conflict {
  return {
    slug: `${decision.slug}/conflict-1`,
    decision: { slug: decision.slug, title: decision.title },
    description,
    raisedAt: raised,
  };
}

/** The "Needs you" band. */
function needsYou(): HTMLElement {
  return screen.getByRole("region", { name: "Needs you" });
}

/** Each open flag and Conflict in the band: its question, and the buttons that decide it here. */
function reviewLines(): { question: string | null; decide: (string | null)[] }[] {
  return [...needsYou().querySelectorAll(":scope > ul > li")].map((li) => ({
    question: li.querySelector("p")?.textContent ?? null,
    decide: [...li.querySelectorAll("details button")].map((button) => button.textContent),
  }));
}

it("asks about each open flag and Conflict in plain words, linking to its Decision", async () => {
  const decisions: DecisionSummary[] = [
    { ...calm, openFlags: [flagOn(calm)] },
    { ...nook, openFlags: [flagOn(nook)] },
    { ...sofa, openConflicts: [conflictOn(sofa, "The sofa we saw is 90 cm tall.")] },
  ];
  stubHomePage({ list_decisions: () => ({ decisions }) });
  renderRoutes("/homes/flat");
  await screen.findByText(/The sofa we saw/);
  expect(reviewLines()).toEqual([
    {
      question:
        "⚑ Something under Calm and low changed: Warm minimalism was reopened. " +
        "Is Calm and low still right?",
      decide: ["Keep", "Reopen", "Reject"],
    },
    {
      // Only a Locked Decision can be reopened.
      question:
        "⚑ Something under Reading nook changed: Warm minimalism was reopened. " +
        "Is Reading nook still right?",
      decide: ["Keep", "Reject"],
    },
    {
      question:
        "⚑ Something new goes against A low sofa: The sofa we saw is 90 cm tall. " +
        "Does A low sofa still hold?",
      decide: ["Keep", "Reopen", "Reject"],
    },
  ]);
  expect(screen.getByRole("link", { name: "Reading nook" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/hallway-use",
  );
  // What each resolution does is said beside it.
  const first = needsYou().querySelector(":scope > ul > li") as HTMLElement;
  expect(within(first).getByText(/Reopen moves it back to Leaning/)).toBeDefined();
});

it("offers to talk a flag through with the owning Skill, naming the Decision's slug", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  stubHomePage({
    list_decisions: () => ({ decisions: [{ ...calm, openFlags: [flagOn(calm)] }] }),
  });
  renderRoutes("/homes/flat");
  const button = await screen.findByRole("button", { name: /Talk it through/ });
  await act(async () => fireEvent.click(button));
  expect(writeText).toHaveBeenCalledWith(
    `claude "Using the Design Direction Skill: Calm and low was flagged because Warm minimalism ` +
      `was reopened. Help me decide whether to keep it, reopen it, or reject it. ` +
      `(slug: living-room-direction)"`,
  );
});

it("keeps a flagged Decision: posts resolve_flag with the reason, and the question goes", async () => {
  let flags = [flagOn(calm)];
  const fetch = stubHomePage({
    list_decisions: () => ({ decisions: [{ ...calm, openFlags: flags }] }),
    resolve_flag: () => {
      flags = [];
      return { receipt: "Kept Calm and low.", decision: calm };
    },
  });
  renderRoutes("/homes/flat");
  const line = (await screen.findByText(/Something under/)).closest("li") as HTMLElement;

  fireEvent.change(within(line).getByLabelText("Reason (optional)"), {
    target: { value: "still right for the room" },
  });
  fireEvent.click(within(line).getByRole("button", { name: "Keep" }));

  expect(await screen.findByText("Nothing needs you right now.")).toBeDefined();
  expect(inputsTo(fetch, "resolve_flag")).toEqual([
    {
      home: "flat",
      flag: "living-room-direction/flag-1",
      resolution: "keep",
      reason: "still right for the room",
    },
  ]);
});

it("reopens the Decision in Conflict through resolve_conflict", async () => {
  const fetch = stubHomePage({
    list_decisions: () => ({
      decisions: [{ ...calm, openConflicts: [conflictOn(calm, "Too dark.")] }],
    }),
    resolve_conflict: () => ({ receipt: "Reopened Calm and low.", decision: calm }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText(/Something new goes against/);
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await waitFor(() => expect(inputsTo(fetch, "resolve_conflict")).toHaveLength(1));
  expect(inputsTo(fetch, "resolve_conflict")).toEqual([
    { home: "flat", conflict: "living-room-direction/conflict-1", resolution: "reopen" },
  ]);
});

it("names the source of Deviation and value_changed flags, and the field that changed", async () => {
  const cushions = summary("clay-cushions", "Clay cushions", "purchase", "leaning");
  const flag = (decision: DecisionSummary, n: number, rest: Pick<Flag, "cause" | "source">) => ({
    slug: `${decision.slug}/flag-${n}`,
    decision: { slug: decision.slug, title: decision.title },
    raisedAt: raised,
    ...rest,
  });
  const decisions: DecisionSummary[] = [
    {
      ...cushions,
      openFlags: [
        flag(cushions, 1, {
          cause: "deviation",
          source: { kind: "decision", slug: "wool-rug", name: "Wool rug" },
        }),
      ],
    },
    {
      ...sofa,
      openFlags: [
        flag(sofa, 1, {
          cause: "value_changed",
          source: { kind: "wall", slug: "living-room/wall-2", name: "Wall 2", field: "length" },
        }),
        // A reason naming no field: any change to the record flags it.
        flag(sofa, 2, {
          cause: "value_changed",
          source: { kind: "door", slug: "living-room-hallway-door", name: "Hallway door" },
        }),
      ],
    },
  ];
  const fetch = stubHomePage({
    get_home: () => ({
      home: flat,
      levels: [ground],
      rooms: [{ slug: "living-room", name: "Living room", level: "ground" }],
      unplacedItems: 0,
    }),
    list_decisions: () => ({ decisions }),
    resolve_flag: () => ({ receipt: "Reopened A low sofa.", decision: sofa }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText(/length changed/);
  expect(reviewLines()).toEqual([
    {
      question:
        "⚑ Something under Clay cushions changed: Wool rug was Fulfilled with a Deviation from " +
        "a must Requirement. Is Clay cushions still right?",
      decide: ["Keep", "Reject"],
    },
    {
      question:
        "⚑ Something under A low sofa changed: Wall 2's length changed. Is A low sofa still right?",
      decide: ["Keep", "Reopen", "Reject"],
    },
    {
      question:
        "⚑ Something under A low sofa changed: Hallway door changed. Is A low sofa still right?",
      decide: ["Keep", "Reopen", "Reject"],
    },
  ]);
  // Each source links to the page showing it; a Door's Room is found among the Home's Rooms.
  const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");
  expect(href("Wool rug")).toBe("/homes/flat/decisions/wool-rug");
  expect(href("Wall 2")).toBe("/homes/flat/rooms/living-room");
  expect((await screen.findByRole("link", { name: "Hallway door" })).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );

  const line = screen.getByText(/length changed/).closest("li") as HTMLElement;
  fireEvent.click(within(line).getByRole("button", { name: "Reopen" }));
  await waitFor(() => expect(inputsTo(fetch, "resolve_flag")).toHaveLength(1));
  expect(inputsTo(fetch, "resolve_flag")).toEqual([
    { home: "flat", flag: "sofa/flag-1", resolution: "reopen" },
  ]);
});

it("shows a new flag when a flag change event arrives", async () => {
  let flags: Flag[] = [];
  stubHomePage({ list_decisions: () => ({ decisions: [{ ...calm, openFlags: flags }] }) });
  renderRoutes("/homes/flat");
  await screen.findByText("Nothing needs you right now.");

  flags = [flagOn(calm)];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "flag",
      recordSlug: "living-room-direction/flag-1",
    }),
  );
  expect(await screen.findByText(/Something under/)).toBeDefined();
});

/** A Room Sheet with nothing recorded but what is given. */
function roomDetail(room: Room, rest: Partial<RoomDetail> = {}): RoomDetail {
  return {
    slug: room.slug,
    name: room.name,
    level: ground,
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
    ...rest,
  };
}

it("shows each Room as a tile with its wall color, functions, Gaps, open Decisions, and flag", async () => {
  const living: Room = { slug: "living-room", name: "Living room", level: "ground" };
  const balcony: Room = { slug: "balcony", name: "Balcony", level: "ground" };
  const details: Record<string, RoomDetail> = {
    "living-room": roomDetail(living, {
      functions: ["living", "dining"],
      surfaces: [
        {
          slug: "living-room/walls",
          part: "walls",
          color: { name: "Setting Plaster", hex: "#e3c9b6", provenance: "measured" },
        },
      ],
      gaps: ["ceiling height", "times of use", "floor Surface"],
    }),
    balcony: roomDetail(balcony, { outdoor: true }),
  };
  const onLiving = (slug: string, title: string, state: DecisionSummary["state"]) => ({
    ...summary(slug, title, "purchase", state),
    room: { slug: "living-room", name: "Living room" },
  });
  stubHomePage({
    get_home: () => ({ home: flat, levels: [ground], rooms: [living, balcony], unplacedItems: 0 }),
    get_room: (input) => {
      const room = details[input.room];
      if (!room) throw new Error(`No Room ${input.room}`);
      return { room, decisions: [] };
    },
    list_decisions: () => ({
      decisions: [
        onLiving("rug", "Wool rug", "candidate"),
        { ...onLiving("lamp", "Floor lamp", "leaning"), openFlags: [flagOn(calm)] },
        onLiving("sofa", "A low sofa", "locked"),
      ],
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText("3 Gaps");
  const tile = screen.getByRole("link", { name: "Living room" }).closest("li") as HTMLElement;
  expect(tile.textContent).toBe("Living room ⚑Living, dining3 Gaps2 open Decisions");
  expect(within(tile).getByRole("img", { name: "Flagged" })).toBeDefined();
  expect(within(tile).getByTitle("Walls: Setting Plaster, approximately #e3c9b6")).toBeDefined();
  const outdoor = screen.getByRole("link", { name: "Balcony" }).closest("li") as HTMLElement;
  expect(outdoor.textContent).toBe("BalconyNo functions yetOutdoorNo Gaps");
  expect(screen.getByRole("heading", { name: /^Level 0/ }).textContent).toBe("Level 0 · Ground");
  // The band counts the Rooms with Gaps, linking to the Rooms page.
  expect(
    within(needsYou()).getByRole("link", { name: "1 Room with Gaps" }).getAttribute("href"),
  ).toBe("/homes/flat/rooms");
  expect(screen.getByRole("link", { name: "All Rooms →" }).getAttribute("href")).toBe(
    "/homes/flat/rooms",
  );
});

it("re-renders the Room list when a Room change event arrives", async () => {
  let rooms: Room[] = [{ slug: "kitchen", name: "Kitchen", level: "ground" }];
  stubHomePage({ get_home: () => ({ home: flat, levels: [ground], rooms, unplacedItems: 0 }) });
  renderRoutes("/homes/flat");
  await screen.findByText("Kitchen");
  expect(screen.queryByText("Living room")).toBeNull();

  const events = FakeEventSource.open();
  expect(events.url).toBe("/events?home=flat");
  rooms = [...rooms, { slug: "living-room", name: "Living room", level: "ground" }];
  act(() => events.emit("change", { home: "flat", recordKind: "room", recordSlug: "living-room" }));

  expect(await screen.findByText("Living room")).toBeDefined();
  expect(screen.getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );
});

it("offers Home Intake when there are no Rooms yet", async () => {
  stubHomePage({});
  renderRoutes("/homes/flat");
  const empty = (await screen.findByText("No Rooms yet")).parentElement as HTMLElement;
  expect(within(empty).getByRole("button", { name: /Ask the Agent/ })).toBeDefined();
});

it("links the Unplaced Item count to the Items list", async () => {
  stubHomePage({
    get_home: () => ({ home: flat, levels: [ground], rooms: [], unplacedItems: 2 }),
  });
  renderRoutes("/homes/flat");
  const link = await screen.findByRole("link", { name: "2 Unplaced Items" });
  expect(link.getAttribute("href")).toBe("/homes/flat/items");
});

it("links to the About page for the Home's facts", async () => {
  stubHomePage({});
  renderRoutes("/homes/flat");
  const link = await screen.findByRole("link", { name: /^About this Home/ });
  expect(link.getAttribute("href")).toBe("/homes/flat/about");
});

it("shows the getting-started checklist until the first Session", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  stubHomePage({});
  renderRoutes("/homes/flat");
  await screen.findByRole("heading", { name: "Getting started" });
  expect(screen.getByRole("button", { name: "Set up Home Folder" })).toBeDefined();
  const intake = screen.getByText("Start with Home Intake").parentElement as HTMLElement;
  await act(async () =>
    fireEvent.click(within(intake).getByRole("button", { name: /Ask the Agent/ })),
  );
  expect(writeText).toHaveBeenCalledWith(
    `claude "Using the Home Intake Skill: Let's record my home; I'll upload the floor plan"`,
  );
});

const walkthrough: Session = {
  slug: "s1",
  skills: ["home-intake"],
  openedAt: "2026-09-13T10:00:00Z",
  closedAt: "2026-09-13T10:30:00Z",
  summary: {
    changed: "Added the Kitchen.",
    open: "Its ceiling height.",
    next: "Measure the Kitchen",
  },
};

it("picks up where the newest summarised Session left off, settling the Design Direction first", async () => {
  const later: Session = { slug: "s2", skills: ["color"], openedAt: "2026-09-15T10:00:00Z" };
  let decisions = [summary("design-direction", "Warm minimalism", "design-direction", "leaning")];
  stubHomePage({
    list_sessions: () => ({ sessions: [walkthrough, later] }),
    list_decisions: () => ({ decisions }),
  });
  renderRoutes("/homes/flat");
  const card = (await screen.findByRole("heading", { name: "Where we left off" })).closest(
    "section",
  ) as HTMLElement;
  expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
  expect(within(card).getByText(/Written by the Agent/).textContent).toBe(
    "Written by the Agent · Home Intake Session · 13 Sep",
  );
  expect(within(card).getByText("Added the Kitchen.")).toBeDefined();
  expect(within(card).getByText("Its ceiling height.")).toBeDefined();
  const steps = () =>
    [...card.querySelectorAll("ol > li > span:first-child")].map((s) => s.textContent);
  expect(steps()).toEqual(["Settle the Design Direction", "Measure the Kitchen"]);

  decisions = [summary("design-direction", "Warm minimalism", "design-direction", "locked")];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "design-direction",
    }),
  );
  await waitFor(() => expect(steps()).toEqual(["Measure the Kitchen"]));
});

it("refetches only the Sessions when a Session change event arrives", async () => {
  const opened: Session = { slug: "s1", skills: ["home-intake"], openedAt: "2026-09-13T10:00:00Z" };
  let sessions: Session[] = [opened];
  const fetch = stubHomePage({ list_sessions: () => ({ sessions }) });
  renderRoutes("/homes/flat");
  await screen.findByText(/unsummarised/);
  expect(screen.getByRole("link", { name: "Home Intake" }).getAttribute("href")).toBe(
    "/homes/flat/sessions/s1",
  );
  const homeFetches = fetch.mock.calls.filter(([url]) => url === "/api/get_home").length;

  sessions = [walkthrough];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "session",
      recordSlug: "s1",
    }),
  );

  expect(await screen.findByText("Added the Kitchen.")).toBeDefined();
  expect(fetch.mock.calls.filter(([url]) => url === "/api/get_home")).toHaveLength(homeFetches);
});

const earthyColors: PaletteColor[] = [
  {
    name: "Setting Plaster",
    brand: "Farrow & Ball",
    code: "231",
    hex: "#e3c9b6",
    provenance: "measured",
    role: "base",
  },
  { name: "Olive", provenance: "estimated", role: "accent", note: "cushions" },
];

/** A Palette as list_decisions gives it: its colors come with it, for swatches. */
function palette(slug: string, title: string, state: DecisionSummary["state"]): DecisionSummary {
  return { ...summary(slug, title, "palette", state), colors: earthyColors };
}

/** The Palette section: the Palette's name and state, and its colors' names. */
function paletteSection(): { line: string | null | undefined; colors: (string | null)[] } {
  const section = screen.getByRole("heading", { name: "Palette" }).closest("section");
  return {
    line: section?.querySelector("h2")?.nextElementSibling?.textContent,
    colors: [...(section?.querySelectorAll("figure li") ?? [])].map(
      (li) => li.querySelector("span + span > span")?.textContent ?? null,
    ),
  };
}

it("shows the Locked Palette as chips linking to its Decision", async () => {
  const fetch = stubHomePage({
    list_decisions: () => ({
      decisions: [
        palette("sunny-palette", "Sunny palette", "leaning"),
        palette("earthy-palette", "Earthy palette", "locked"),
        palette("cool-palette", "Cool palette", "candidate"),
      ],
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText(/Setting Plaster/);
  expect(paletteSection()).toEqual({
    line: "Earthy palette●Locked",
    colors: ["Setting Plaster", "Olive"],
  });
  expect(screen.getByRole("link", { name: "Earthy palette" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/earthy-palette",
  );
  expect(screen.getByTitle("Approximately #e3c9b6")).toBeDefined();
  expect(screen.getAllByTitle("No screen color recorded")).toHaveLength(1);
  // The list carries the colors, so no Decision is fetched for them.
  expect(inputsTo(fetch, "get_decision")).toEqual([]);
});

it("shows the latest Leaning Palette when none is Locked, under the Design Direction", async () => {
  stubHomePage({
    list_decisions: () => ({
      decisions: [
        summary("design-direction", "Warm minimalism", "design-direction", "locked"),
        palette("sunny-palette", "Sunny palette", "leaning"),
        palette("earthy-palette", "Earthy palette", "leaning"),
      ],
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText(/Setting Plaster/);
  expect(paletteSection().line).toBe("Earthy palette◐Leaning");
  const direction = screen.getByText("Design Direction").parentElement;
  expect(direction?.textContent).toBe("Design Direction Warm minimalism ●Locked");
});

it("says there is no Palette yet, and shows one the Agent Locks", async () => {
  let decisions = [
    palette("earthy-palette", "Earthy palette", "candidate"),
    palette("pastel-palette", "Pastels", "rejected"),
  ];
  stubHomePage({ list_decisions: () => ({ decisions }) });
  renderRoutes("/homes/flat");
  expect(await screen.findByText("No Palette yet")).toBeDefined();

  decisions = [palette("earthy-palette", "Earthy palette", "locked")];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "earthy-palette",
    }),
  );
  await screen.findByText(/Setting Plaster/);
  expect(paletteSection().line).toBe("Earthy palette●Locked");
});
