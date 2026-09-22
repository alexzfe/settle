import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionSummary, Flag, Home, Level, Session, ShoppingEntry } from "./api";
import { lastClosedSession, waitingOnYou } from "./HomePage";
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
    get_shopping: () => ({ shoppingList: [], considering: [] }),
    ...handlers,
  });
}

/** The page itself, without the sidebar's links and counts. */
function main(): HTMLElement {
  return screen.getByRole("main");
}

const raised = "2026-09-14T10:00:00Z";

function summary(
  slug: string,
  title: string,
  kind: DecisionSummary["kind"],
  state: DecisionSummary["state"],
  rest: Partial<DecisionSummary> = {},
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
    ...rest,
  };
}

const calm = summary("living-room-direction", "Calm and low", "room-direction", "settled");

function flagOn(decision: DecisionSummary): Flag {
  return {
    slug: `${decision.slug}/flag-1`,
    decision: { slug: decision.slug, title: decision.title },
    cause: "reopened",
    source: { kind: "decision", slug: "design-direction", name: "Warm minimalism" },
    raisedAt: raised,
  };
}

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

const colorSession: Session = {
  slug: "s2",
  skills: ["color"],
  openedAt: "2026-09-12T10:00:00Z",
  closedAt: "2026-09-15T10:00:00Z",
  summary: {
    changed: "Chose the Palette.",
    open: "The hallway's wall color.",
    next: "Pick a wall color for the hallway",
  },
};

function shoppingEntry(slug: string): ShoppingEntry {
  return {
    slug,
    title: slug,
    statement: "",
    state: "settled",
    requirements: { must: 0, prefer: 0 },
    hasGuides: false,
    fullGuideOutOfDate: false,
    listings: 0,
    measureFirst: [],
    openFlags: 0,
  };
}

it("puts the Flags strip first when something is open, and says nothing at zero", async () => {
  let decisions = [{ ...calm, openFlags: [flagOn(calm)] }];
  stubHomePage({
    list_sessions: () => ({ sessions: [walkthrough] }),
    list_decisions: () => ({ decisions }),
  });
  renderRoutes("/homes/flat");
  const strip = await screen.findByRole("complementary", { name: "Flags" });
  expect(strip.textContent).toBe("1 Flag Calm and low needs a look.Review");
  // Above the page's title.
  const heading = screen.getByRole("heading", { level: 1, name: "Flat" });
  expect(strip.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  decisions = [calm];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "flag",
      recordSlug: "living-room-direction/flag-1",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "Flags" })).toBeNull());
  expect(screen.queryByText(/Nothing needs you/)).toBeNull();
});

it("leads with the last closed Session's next step, what is open, and what it changed", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const unwrapped: Session = { slug: "s3", skills: ["purchase"], openedAt: "2026-09-16T10:00:00Z" };
  stubHomePage({ list_sessions: () => ({ sessions: [walkthrough, colorSession, unwrapped] }) });
  renderRoutes("/homes/flat");
  const nextUp = (await screen.findByRole("heading", { name: "Next up" })).closest(
    "section",
  ) as HTMLElement;
  // The Color Session opened earlier but closed last.
  expect(within(nextUp).getByText(/Written by the Agent/).textContent).toBe(
    "Written by the Agent · Color Session · 15 Sep",
  );
  expect(within(nextUp).getByText("Pick a wall color for the hallway")).toBeDefined();
  expect(
    within(nextUp)
      .getByText(/^Still open:/)
      .closest("p")?.textContent,
  ).toBe("Still open: The hallway's wall color.");
  const changed = within(nextUp).getByText(/changed:/);
  expect(changed.textContent).toBe("Last Session changed: Chose the Palette. · Change log");
  expect(within(changed).getByRole("link", { name: "Last Session" }).getAttribute("href")).toBe(
    "/homes/flat/sessions/s2",
  );
  expect(within(changed).getByRole("link", { name: "Change log" }).getAttribute("href")).toBe(
    "/homes/flat/log",
  );

  await act(async () => fireEvent.click(within(nextUp).getByRole("button", { name: /Continue/ })));
  expect(writeText).toHaveBeenCalledWith(
    `claude "Let's pick up where the last Session left off. Next: Pick a wall color for the hallway"`,
  );
  expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
});

it("lists the Leaning Decisions waiting on the user as rows, oldest first", async () => {
  const lamp = summary("floor-lamp", "Floor lamp", "purchase", "leaning", {
    room: { slug: "living-room", name: "Living room" },
    createdAt: "2026-09-10T10:00:00Z",
  });
  const direction = summary("design-direction", "Warm minimalism", "design-direction", "leaning", {
    createdAt: "2026-09-05T10:00:00Z",
  });
  const decisions = [
    lamp,
    direction,
    summary("rug", "Wool rug", "purchase", "candidate"),
    calm,
    summary("old-lamp", "Old lamp", "purchase", "leaning", { archivedAt: raised }),
  ];
  const fetch = stubHomePage({
    list_sessions: () => ({ sessions: [walkthrough] }),
    list_decisions: () => ({ decisions }),
  });
  renderRoutes("/homes/flat");
  const section = (await screen.findByRole("heading", { name: "Waiting on you" })).closest(
    "section",
  ) as HTMLElement;
  const rows = [...section.querySelectorAll("li")];
  expect(rows.map((row) => row.textContent)).toEqual([
    "Warm minimalismWhole home5 Sep",
    "Floor lampLiving room10 Sep",
  ]);
  expect(within(rows[1] as HTMLElement).getByRole("img", { name: "Leaning" })).toBeDefined();
  // The title is the row's one link.
  expect(within(rows[1] as HTMLElement).getAllByRole("link")).toHaveLength(1);
  expect(within(section).getByRole("link", { name: "Floor lamp" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/floor-lamp",
  );
  // The Decisions are asked for as the Flags strip and the sidebar ask, so all three share one
  // cache entry.
  const asked = inputsTo(fetch, "list_decisions");
  expect(asked.length).toBeGreaterThan(0);
  expect(asked).toEqual(asked.map(() => ({ home: "flat", archived: true })));
});

it("leaves Waiting on you out when nothing is Leaning", async () => {
  stubHomePage({
    list_sessions: () => ({ sessions: [walkthrough] }),
    list_decisions: () => ({ decisions: [calm] }),
  });
  renderRoutes("/homes/flat");
  await screen.findByRole("heading", { name: "Next up" });
  expect(screen.queryByRole("heading", { name: "Waiting on you" })).toBeNull();
});

it("counts the Shopping List on one line, and leaves it out at zero", async () => {
  let shoppingList = [shoppingEntry("sofa"), shoppingEntry("rug"), shoppingEntry("lamp")];
  stubHomePage({
    list_decisions: () => ({ decisions: [calm] }),
    get_shopping: () => ({ shoppingList, considering: [] }),
  });
  renderRoutes("/homes/flat");
  const line = await within(main()).findByText(/things to buy/);
  expect(line.textContent).toBe("3 things to buy · Shopping");
  expect(within(line).getByRole("link", { name: "Shopping" }).getAttribute("href")).toBe(
    "/homes/flat/shopping",
  );

  shoppingList = [];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "sofa",
    }),
  );
  await waitFor(() => expect(within(main()).queryByText(/to buy/)).toBeNull());
});

it("says one thing to buy", async () => {
  stubHomePage({
    list_decisions: () => ({ decisions: [calm] }),
    get_shopping: () => ({ shoppingList: [shoppingEntry("sofa")], considering: [] }),
  });
  renderRoutes("/homes/flat");
  expect((await within(main()).findByText(/to buy/)).textContent).toBe("1 thing to buy · Shopping");
});

it("shows the getting-started steps for a Home with no Decisions and no closed Session", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  // A Session left open proves nothing was recorded yet.
  stubHomePage({
    list_sessions: () => ({
      sessions: [{ slug: "s1", skills: ["home-intake"], openedAt: "2026-09-13T10:00:00Z" }],
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByRole("heading", { name: "Getting started" });
  expect(screen.getByRole("button", { name: "Set up Home Folder" })).toBeDefined();
  expect(screen.queryByRole("heading", { name: "Next up" })).toBeNull();
  const intake = screen.getByText("Start with Home Intake").parentElement as HTMLElement;
  await act(async () =>
    fireEvent.click(within(intake).getByRole("button", { name: /Ask the Agent/ })),
  );
  expect(writeText).toHaveBeenCalledWith(
    `claude "Using the Home Intake Skill: Let's record my home; I'll upload the floor plan"`,
  );
});

it("drops the getting-started steps once the Home has a Decision", async () => {
  stubHomePage({
    list_decisions: () => ({ decisions: [summary("sofa", "Sofa", "purchase", "leaning")] }),
  });
  renderRoutes("/homes/flat");
  await screen.findByRole("heading", { name: "Waiting on you" });
  expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Next up" })).toBeNull();
});

it("no longer shows the Rooms, the Palette, the recent Sessions, or a search field", async () => {
  stubHomePage({
    get_home: () => ({
      home: flat,
      levels: [ground],
      rooms: [{ slug: "kitchen", name: "Kitchen", level: "ground" }],
      unplacedItems: 2,
    }),
    list_sessions: () => ({ sessions: [walkthrough] }),
    list_decisions: () => ({
      decisions: [summary("palette", "Earthy palette", "palette", "settled", { colors: [] })],
    }),
  });
  renderRoutes("/homes/flat");
  await screen.findByRole("heading", { name: "Next up" });
  const headings = within(main())
    .getAllByRole("heading")
    .map((heading) => heading.textContent);
  expect(headings).toEqual(["Flat", "Next up"]);
  expect(within(main()).queryByRole("searchbox")).toBeNull();
  expect(within(main()).queryByRole("textbox")).toBeNull();
  expect(within(main()).queryByText("Kitchen")).toBeNull();
});

it("refetches only the Sessions when a Session change event arrives", async () => {
  const opened: Session = { slug: "s1", skills: ["home-intake"], openedAt: "2026-09-13T10:00:00Z" };
  let sessions: Session[] = [opened];
  const fetch = stubHomePage({
    list_sessions: () => ({ sessions }),
    list_decisions: () => ({ decisions: [calm] }),
  });
  renderRoutes("/homes/flat");
  await screen.findByRole("link", { name: /^About this Home/ });
  await waitFor(() => expect(inputsTo(fetch, "list_sessions").length).toBeGreaterThan(0));
  expect(screen.queryByRole("heading", { name: "Next up" })).toBeNull();
  const homeFetches = fetch.mock.calls.filter(([url]) => url === "/api/get_home").length;

  sessions = [walkthrough];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "session",
      recordSlug: "s1",
    }),
  );

  expect(await screen.findByText("Measure the Kitchen")).toBeDefined();
  expect(fetch.mock.calls.filter(([url]) => url === "/api/get_home")).toHaveLength(homeFetches);
});

it("links to the About page for the Home's facts", async () => {
  stubHomePage({});
  renderRoutes("/homes/flat");
  const link = await screen.findByRole("link", { name: /^About this Home/ });
  expect(link.getAttribute("href")).toBe("/homes/flat/about");
});

it("picks the Session closed last, skipping unwrapped ones", () => {
  const open: Session = { slug: "s3", skills: [], openedAt: "2026-09-20T10:00:00Z" };
  expect(lastClosedSession([walkthrough, colorSession, open])?.slug).toBe("s2");
  expect(lastClosedSession([open])).toBeUndefined();
});

it("keeps only Leaning Decisions not Archived, oldest first", () => {
  const a = summary("a", "A", "purchase", "leaning", { createdAt: "2026-09-10T00:00:00Z" });
  const b = summary("b", "B", "purchase", "leaning", { createdAt: "2026-09-01T00:00:00Z" });
  const archived = { ...a, slug: "c", archivedAt: raised };
  expect(waitingOnYou([a, calm, archived, b]).map((d) => d.slug)).toEqual(["b", "a"]);
});
