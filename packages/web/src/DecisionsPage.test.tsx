import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionSummary, Home, Level, Room } from "./api";
import { openSince } from "./DecisionsPage";
import { FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };
const rooms: Room[] = [
  { slug: "living-room", name: "Living room", level: "ground" },
  { slug: "hallway", name: "Hallway", level: "ground" },
];
const livingRoom = { slug: "living-room", name: "Living room" };
const hallway = { slug: "hallway", name: "Hallway" };
const raised = "2026-09-14T10:00:00Z";

function summary(
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
    createdAt: raised,
    openFlags: [],
    openConflicts: [],
    ...extra,
  };
}

/** The fixture's Decisions, listed out of state order to show the page groups them itself. */
const decisions: DecisionSummary[] = [
  summary("hallway-use", "Reading nook", "room-use", "candidate", { room: hallway }),
  summary("living-room-direction", "Calm and low", "room-direction", "settled", {
    room: livingRoom,
    openFlags: [
      {
        slug: "living-room-direction/flag-1",
        decision: { slug: "living-room-direction", title: "Calm and low" },
        cause: "reopened",
        source: { kind: "decision", slug: "design-direction", name: "Warm minimalism" },
        raisedAt: raised,
      },
    ],
  }),
  summary("design-direction", "Warm minimalism", "design-direction", "leaning"),
  summary("palette", "Earthy palette", "palette", "settled", {
    openConflicts: [
      {
        slug: "palette/conflict-1",
        decision: { slug: "palette", title: "Earthy palette" },
        description: "The new rug's red clashes with the accent.",
        raisedAt: raised,
      },
    ],
  }),
  summary("old-sofa", "Keep the old sofa", "purchase", "rejected", { room: livingRoom }),
  summary("old-rug", "A jute rug", "purchase", "settled", {
    room: livingRoom,
    archivedAt: "2026-09-10T12:00:00Z",
  }),
];

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stubList(listed: () => DecisionSummary[] = () => decisions) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms, unplacedItems: 0 }),
    list_decisions: (input) => ({
      decisions: listed().filter(
        (each) =>
          (!input.state || each.state === input.state) &&
          (!input.kind || each.kind === input.kind) &&
          (input.archived === true || !each.archivedAt),
      ),
    }),
    get_shopping: () => ({
      shoppingList: [],
      considering: [
        {
          slug: "old-sofa",
          title: "Keep the old sofa",
          statement: "",
          state: "candidate" as const,
          requirements: { must: 0, prefer: 0 },
          hasGuides: false,
          fullGuideOutOfDate: false,
          listings: 4,
          measureFirst: [],
          openFlags: 0,
        },
      ],
    }),
  });
}

/**
 * Each group's heading and its rows: a row's title, kind, room (its state when grouped by room),
 * and how long it has been open, joined by " | ". Its mark and second line are checked separately.
 */
function groups(): [string | null | undefined, string[]][] {
  return [...document.querySelectorAll("main section")].map((section) => [
    section.querySelector("h2")?.textContent,
    [...section.querySelectorAll("li")].map((li) => {
      const [, title, facts, since] = [...(li.firstElementChild?.children ?? [])];
      return [
        title?.firstElementChild?.textContent,
        ...[...(facts?.children ?? [])].map((cell) => cell.textContent),
        since?.textContent,
      ].join(" | ");
    }),
  ]);
}

/** The titles listed, in order, whatever the grouping. */
function titles(): string[] {
  return groups().flatMap(([, rows]) => rows.map((row) => row.split(" | ")[0] ?? ""));
}

function grouping(): HTMLElement {
  return screen.getByRole("navigation", { name: "Group" });
}

it("groups the Decisions by state, in the order they need the user", async () => {
  const fetch = stubList();
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  // The one request the sidebar and the Flags strip share.
  expect(inputsTo(fetch, "list_decisions")).toEqual([{ home: "flat", archived: true }]);
  expect(groups()).toEqual([
    [
      "Leaning1favoured, not committed yet",
      ["Warm minimalism | Design Direction | Whole home | 14 Sep"],
    ],
    ["Candidate1being considered, no commitment", ["Reading nook | Room use | Hallway | 14 Sep"]],
    [
      "Settled2committed, and later Decisions build on it",
      [
        "Calm and low | Room Direction | Living room | 14 Sep",
        "Earthy palette | Palette | Whole home | 14 Sep",
      ],
    ],
  ]);
  // Leaning heads the page and counts the Decisions in it; a group's mark says its state.
  const leaning = screen.getByRole("region", { name: "Leaning" });
  expect(within(leaning).getByRole("img", { name: "Leaning" })).toBeDefined();
  // The title is the one link, and the row's state is the mark beside it.
  expect(screen.getByRole("link", { name: "Calm and low" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/living-room-direction",
  );
  expect(screen.queryByRole("link", { name: "Living room" })).toBeNull();
});

it("says under the title what needs the user, and the neutral facts beside it", async () => {
  stubList();
  renderRoutes("/homes/flat/decisions");
  const flagged = await screen.findByText("Calm and low");
  const row = flagged.closest("div") as HTMLElement;
  expect(within(row).getByText("Flagged: Warm minimalism was reopened")).toBeDefined();
  const conflicted = screen.getByText("Earthy palette").closest("div") as HTMLElement;
  expect(within(conflicted).getByText("Conflict")).toBeDefined();
});

it("regroups by room and by kind, showing the state in the fourth column by room", async () => {
  const fetch = stubList();
  const { router } = renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");

  fireEvent.click(within(grouping()).getByRole("link", { name: "By room" }));
  await waitFor(() => expect(router.state.location.search).toBe("?group=room"));
  expect(groups()).toEqual([
    [
      "Whole home2",
      [
        "Warm minimalism | Design Direction | Leaning | 14 Sep",
        "Earthy palette | Palette | Settled | 14 Sep",
      ],
    ],
    ["Living room1", ["Calm and low | Room Direction | Settled | 14 Sep"]],
    ["Hallway1", ["Reading nook | Room use | Candidate | 14 Sep"]],
  ]);
  expect(screen.getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );

  fireEvent.click(within(grouping()).getByRole("link", { name: "By kind" }));
  await waitFor(() => expect(router.state.location.search).toBe("?group=kind"));
  expect(groups().map(([title]) => title)).toEqual([
    "Design Direction1",
    "Room Direction1",
    "Room use1",
    "Palette1",
  ]);
  // Regrouping never asks the server again.
  expect(inputsTo(fetch, "list_decisions")).toEqual([{ home: "flat", archived: true }]);
});

it("shows only the flagged Decisions when the Flags strip sends the user here", async () => {
  stubList();
  const { router } = renderRoutes("/homes/flat/decisions?flagged=1");
  await screen.findByText("Calm and low");
  expect(titles()).toEqual(["Calm and low", "Earthy palette"]);

  fireEvent.click(screen.getByRole("link", { name: "Show all Decisions" }));
  await waitFor(() => expect(router.state.location.search).toBe(""));
  expect(titles()).toContain("Reading nook");
});

it("shows a Purchase's Listing count, and its Fulfilment, as neutral facts", async () => {
  stubList(() => [
    summary("old-sofa", "Keep the old sofa", "purchase", "candidate", { room: livingRoom }),
    summary("rug", "Wool rug", "purchase", "settled", { fulfilledAt: raised }),
  ]);
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Wool rug");
  expect(screen.getByText("4 Listings")).toBeDefined();
  expect(screen.getByText("✓ Fulfilled 14 Sep")).toBeDefined();
});

it("hides Rejected and Archived Decisions behind one switch, which it remembers", async () => {
  const fetch = stubList();
  const { unmount } = renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(screen.queryByText("Keep the old sofa")).toBeNull();
  expect(screen.queryByText("A jute rug")).toBeNull();

  fireEvent.click(screen.getByLabelText("Show Rejected / Archived (2)"));
  expect(groups().at(-1)).toEqual([
    "Rejected1ruled out, won't be proposed again",
    ["Keep the old sofa | Purchase | Living room | 14 Sep"],
  ]);
  expect(titles()).toContain("A jute rug");
  expect(inputsTo(fetch, "list_decisions")).toEqual([{ home: "flat", archived: true }]);
  unmount();

  renderRoutes("/homes/flat/decisions");
  expect(await screen.findByText("Keep the old sofa")).toBeDefined();
});

it("has no switch when nothing is Rejected or Archived", async () => {
  stubList(() =>
    decisions.filter((decision) => decision.state !== "rejected" && !decision.archivedAt),
  );
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(screen.queryByLabelText(/Show Rejected/)).toBeNull();
});

it("says when there are no Decisions, none match the search, or nothing is flagged", async () => {
  stubList(() => []);
  const { unmount } = renderRoutes("/homes/flat/decisions");
  expect(
    await screen.findByText(
      "No Decisions yet. Settle them with the Agent in this Home's Home Folder.",
    ),
  ).toBeDefined();
  unmount();

  const { unmount: second } = renderRoutes("/homes/flat/decisions?q=nothing");
  expect(await screen.findByText("No Decisions match.")).toBeDefined();
  second();

  renderRoutes("/homes/flat/decisions?flagged=1");
  expect(await screen.findByText("Nothing is flagged.")).toBeDefined();
});

it("searches the titles, keeping the words in the query string", async () => {
  stubList();
  const { router } = renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");

  fireEvent.change(screen.getByRole("searchbox", { name: "Search titles" }), {
    target: { value: "CALM low" },
  });
  await waitFor(() => expect(screen.queryByText("Reading nook")).toBeNull());
  expect(router.state.location.search).toBe("?q=CALM+low");
  expect(titles()).toEqual(["Calm and low"]);
});

it("shows a Palette's colors as small swatches in its row", async () => {
  stubList(() => [
    summary("palette", "Earthy palette", "palette", "settled", {
      colors: [
        { name: "Setting Plaster", hex: "#e3c9b6", provenance: "estimated", role: "base" },
        { name: "Olive", provenance: "estimated", role: "accent" },
      ],
    }),
  ]);
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Earthy palette");
  expect(screen.getByTitle("Approximately #e3c9b6")).toBeDefined();
  expect(screen.getByTitle("No screen color recorded")).toBeDefined();
});

it("dates when a Decision was opened, naming the year only once it is past", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  expect(openSince("2026-09-14T10:00:00Z", now)).toBe("14 Sep");
  expect(openSince("2025-11-02T10:00:00Z", now)).toBe("Nov 2025");
});
