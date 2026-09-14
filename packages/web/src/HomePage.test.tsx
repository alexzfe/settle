import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Constraint, Home, Level, Note, Room, Session } from "./api";
import { type ApiHandlers, FakeEventSource, renderRoutes, stubApi } from "./testSupport";

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
    ...handlers,
  });
}

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
