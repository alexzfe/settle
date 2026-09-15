import type { PaletteColor } from "@idh/core";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Conflict,
  Constraint,
  DecisionSummary,
  Flag,
  Home,
  Level,
  Note,
  Room,
  Session,
} from "./api";
import { formatDate } from "./format";
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
    list_constraints: () => ({ constraints: [] }),
    list_notes: () => ({ notes: [] }),
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

/** The Decisions line of the Home page's Flags and Conflicts list: its text and its buttons. */
function reviewLines(): { text: string; buttons: (string | null)[] }[] {
  const list = screen.getByRole("heading", { name: "Flags and Conflicts" }).nextElementSibling;
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) => ({
    text: [...li.childNodes]
      .filter((node) => node.nodeName !== "FORM")
      .map((node) => node.textContent)
      .join(""),
    buttons: [...li.querySelectorAll("button")].map((button) => button.textContent),
  }));
}

it("shows each open flag and Conflict on one line, linking to its Decision", async () => {
  const decisions: DecisionSummary[] = [
    { ...calm, openFlags: [flagOn(calm)] },
    { ...nook, openFlags: [flagOn(nook)] },
    { ...sofa, openConflicts: [conflictOn(sofa, "The sofa we saw is 90 cm tall.")] },
  ];
  stubHomePage({ list_decisions: () => ({ decisions }) });
  renderRoutes("/homes/flat");
  await screen.findByText(/The sofa we saw/);
  const date = formatDate(raised);
  expect(reviewLines()).toEqual([
    {
      text: `Flag on Calm and low (Room Direction, Locked): Warm minimalism was reopened, raised ${date}.`,
      buttons: ["Keep", "Reopen", "Reject"],
    },
    {
      // Only a Locked Decision can be reopened.
      text: `Flag on Reading nook (Room use, Candidate): Warm minimalism was reopened, raised ${date}.`,
      buttons: ["Keep", "Reject"],
    },
    {
      text: `Conflict on A low sofa (Purchase, Locked): The sofa we saw is 90 cm tall., raised ${date}.`,
      buttons: ["Keep", "Reopen", "Reject"],
    },
  ]);
  expect(screen.getByRole("link", { name: "Reading nook" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/hallway-use",
  );
});

it("keeps a flagged Decision: posts resolve_flag with the reason, and the line goes", async () => {
  let flags = [flagOn(calm)];
  const fetch = stubHomePage({
    list_decisions: () => ({ decisions: [{ ...calm, openFlags: flags }] }),
    resolve_flag: () => {
      flags = [];
      return { receipt: "Kept Calm and low.", decision: calm };
    },
  });
  renderRoutes("/homes/flat");
  const line = (await screen.findByText(/Flag on/)).closest("li") as HTMLElement;

  fireEvent.change(within(line).getByLabelText("Reason (optional)"), {
    target: { value: "still right for the room" },
  });
  fireEvent.click(within(line).getByRole("button", { name: "Keep" }));

  expect(await screen.findByText("None: no Decision needs review.")).toBeDefined();
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
  await screen.findByText(/Conflict on/);
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
  const date = formatDate(raised);
  expect(reviewLines()).toEqual([
    {
      text:
        `Flag on Clay cushions (Purchase, Leaning): Wool rug was Fulfilled with a Deviation ` +
        `from a must Requirement, raised ${date}.`,
      buttons: ["Keep", "Reject"],
    },
    {
      text: `Flag on A low sofa (Purchase, Locked): Wall 2's length changed, raised ${date}.`,
      buttons: ["Keep", "Reopen", "Reject"],
    },
    {
      text: `Flag on A low sofa (Purchase, Locked): Hallway door changed, raised ${date}.`,
      buttons: ["Keep", "Reopen", "Reject"],
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
  await screen.findByText("None: no Decision needs review.");

  flags = [flagOn(calm)];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "flag",
      recordSlug: "living-room-direction/flag-1",
    }),
  );
  expect(await screen.findByText(/Flag on/)).toBeDefined();
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

it("refetches only the Sessions list when a Session change event arrives", async () => {
  const opened: Session = { slug: "s1", skills: ["home-intake"], openedAt: "2026-09-13T10:00:00Z" };
  let sessions: Session[] = [opened];
  const fetch = stubHomePage({ list_sessions: () => ({ sessions }) });
  renderRoutes("/homes/flat");
  await screen.findByText(/unsummarised/);
  const homeFetches = fetch.mock.calls.filter(([url]) => url === "/api/get_home").length;

  sessions = [
    {
      ...opened,
      closedAt: "2026-09-13T10:30:00Z",
      summary: { changed: "Added the Kitchen.", open: "Its size.", next: "home-intake" },
    },
  ];
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

it("shows only the Home facts that are recorded, with their Provenance", async () => {
  const described: Home = {
    ...flat,
    tenure: "rented",
    plannedStay: "1-3-years",
    buildingType: "apartment",
    buildingEra: "1960s block",
    lift: true,
    liftDoorWidth: { mm: 800, provenance: "measured" },
    liftCarDepth: { mm: 1400, provenance: "estimated" },
    accessWidth: { mm: 760, provenance: "measured" },
    accessNote: "turn in the communal stair",
  };
  stubHomePage({
    get_home: () => ({ home: described, levels: [ground], rooms: [], unplacedItems: 0 }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText("Rented");
  const facts = [...(document.querySelector("dl")?.children ?? [])].map((each) => each.textContent);
  expect(facts).toEqual([
    "City",
    "Madrid",
    "Country",
    "Spain",
    "Latitude",
    "40.4°",
    "Tenure",
    "Rented",
    "Planned stay",
    "1–3 years",
    "Building type",
    "Apartment",
    "Building era",
    "1960s block",
    "Lift",
    "Yes",
    "Lift door width",
    "0.80 m Measured",
    "Lift car depth",
    "~1.40 m Estimated",
    "Narrowest access point",
    "0.76 m Measured, turn in the communal stair",
  ]);
});

it("leaves out the Home facts that are not recorded, and says when there is no lift", async () => {
  stubHomePage({
    get_home: () => ({
      home: { ...flat, lift: false },
      levels: [ground],
      rooms: [],
      unplacedItems: 0,
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText("Madrid");
  expect(screen.queryByText("Tenure")).toBeNull();
  expect(screen.queryByText("Lift door width")).toBeNull();
  expect(screen.getByText("Lift").nextElementSibling?.textContent).toBe("None");
});

it("links the Unplaced Item count to the Items list", async () => {
  stubHomePage({
    get_home: () => ({ home: flat, levels: [ground], rooms: [], unplacedItems: 2 }),
  });
  renderRoutes("/homes/flat");
  const link = await screen.findByRole("link", { name: "2 Unplaced Items" });
  expect(link.getAttribute("href")).toBe("/homes/flat/items");
});

it("shows the Constraints in force, and the Archived ones on request", async () => {
  const drilling: Constraint = { slug: "no-drilling", text: "Rented: no drilling." };
  const painting: Constraint = {
    slug: "no-painting",
    text: "Rented: no painting.",
    archivedAt: "2026-09-10T09:00:00Z",
    archivedReason: "the landlord agreed to paint",
  };
  const fetch = stubHomePage({
    list_constraints: (input) => ({
      constraints: input.archived ? [drilling, painting] : [drilling],
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText("Rented: no drilling.");
  expect(screen.queryByText(/Rented: no painting\./)).toBeNull();

  fireEvent.click(screen.getByLabelText("Show archived Constraints"));

  const archived = await screen.findByText(/Rented: no painting\./);
  expect(archived.textContent).toContain("the landlord agreed to paint");
  expect(fetch.mock.calls.filter(([url]) => url === "/api/list_constraints")).toHaveLength(2);
});

it("refetches the Constraints when a Constraint change event arrives", async () => {
  let constraints: Constraint[] = [];
  stubHomePage({ list_constraints: () => ({ constraints }) });
  renderRoutes("/homes/flat");
  await screen.findByText("No Constraints in force.");

  constraints = [{ slug: "two-cats", text: "Two cats." }];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "constraint",
      recordSlug: "two-cats",
    }),
  );
  expect(await screen.findByText("Two cats.")).toBeDefined();
});

it("shows the Notes, newest first", async () => {
  const notes: Note[] = [
    { slug: "dog", text: "We might get a dog.", createdAt: "2026-09-01T10:00:00Z" },
    { slug: "cat", text: "The cat scratches fabric.", createdAt: "2026-09-12T10:00:00Z" },
  ];
  stubHomePage({ list_notes: () => ({ notes }) });
  renderRoutes("/homes/flat");
  await screen.findByText(/We might get a dog/);
  const list = screen.getByRole("heading", { name: "Notes" }).nextElementSibling;
  expect([...(list?.querySelectorAll("li") ?? [])].map((li) => li.firstChild?.textContent)).toEqual(
    ["The cat scratches fabric.", "We might get a dog."],
  );
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

/** The Palette section: the line naming the Palette, and the row of its colors. */
function paletteSection(): { line: string | null | undefined; colors: (string | null)[] } {
  const line = screen.getByRole("heading", { name: "Palette" }).nextElementSibling;
  const row = line?.nextElementSibling;
  return {
    line: line?.textContent,
    colors: [...(row?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
  };
}

it("shows the Locked Palette as a row of swatches linking to its Decision", async () => {
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
    line: "Earthy palette, Locked",
    colors: ["Setting Plaster (Farrow & Ball 231), base", "~Olive, accent"],
  });
  expect(screen.getByRole("link", { name: "Earthy palette" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/earthy-palette",
  );
  expect(screen.getByTitle("Approximately #e3c9b6")).toBeDefined();
  expect(screen.getByTitle("No screen color recorded")).toBeDefined();
  // The list carries the colors, so no Decision is fetched for them.
  expect(inputsTo(fetch, "get_decision")).toEqual([]);
});

it("shows the latest Leaning Palette when none is Locked", async () => {
  stubHomePage({
    list_decisions: () => ({
      decisions: [
        palette("sunny-palette", "Sunny palette", "leaning"),
        palette("earthy-palette", "Earthy palette", "leaning"),
      ],
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText(/Setting Plaster/);
  expect(paletteSection().line).toBe("Earthy palette, Leaning");
});

it("says there is no Palette yet, and shows one the Agent Locks", async () => {
  let decisions = [
    palette("earthy-palette", "Earthy palette", "candidate"),
    palette("pastel-palette", "Pastels", "rejected"),
  ];
  stubHomePage({ list_decisions: () => ({ decisions }) });
  renderRoutes("/homes/flat");
  expect(await screen.findByText("No Palette yet.")).toBeDefined();

  decisions = [palette("earthy-palette", "Earthy palette", "locked")];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "earthy-palette",
    }),
  );
  await screen.findByText(/Setting Plaster/);
  expect(paletteSection().line).toBe("Earthy palette, Locked");
});
