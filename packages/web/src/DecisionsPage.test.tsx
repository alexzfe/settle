import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionSummary, Home, Level, Room } from "./api";
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

/** The fixture's Decisions, listed out of scope order to show the page groups them itself. */
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
  summary("design-direction", "Warm minimalism", "design-direction", "settled"),
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
  });
}

/** Each group's heading and its rows, each row's columns joined by " | ". */
function groups(): [string | null | undefined, string[]][] {
  return [...document.querySelectorAll("main section")].map((section) => [
    section.querySelector("h2")?.textContent,
    [...section.querySelectorAll("li")].map((li) =>
      [...(li.firstElementChild?.children ?? [])].map((cell) => cell.textContent).join(" | "),
    ),
  ]);
}

function filters(name: string): HTMLElement {
  return screen.getByRole("navigation", { name });
}

it("lists every Decision by scope: Home-wide first, then each Room in the Home's order", async () => {
  const fetch = stubList();
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(inputsTo(fetch, "list_decisions")).toEqual([{ home: "flat", archived: true }]);
  expect(groups()).toEqual([
    [
      "Home-wide",
      [
        "Warm minimalism | Design Direction | ●Settled | ",
        "Earthy palette | Palette | ●Settled | Conflict: The new rug's red clashes with the accent.",
      ],
    ],
    ["Living room", ["Calm and low | Room Direction | ●Settled | ⚑ Warm minimalism was reopened"]],
    ["Hallway", ["Reading nook | Room use | ○Candidate | "]],
  ]);
  // A flag says it is one to screen readers, not by its color alone.
  expect(screen.getByRole("img", { name: "Flagged" })).toBeDefined();
  expect(screen.getByRole("link", { name: "Calm and low" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/living-room-direction",
  );
  expect(screen.getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );
});

it("hides Rejected and Archived Decisions behind one switch, which it remembers", async () => {
  const fetch = stubList();
  const { unmount } = renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(screen.queryByText("Keep the old sofa")).toBeNull();
  expect(screen.queryByText("A jute rug")).toBeNull();

  fireEvent.click(screen.getByLabelText("Show Rejected / Archived (2)"));
  expect(groups()[1]).toEqual([
    "Living room",
    [
      "Calm and low | Room Direction | ●Settled | ⚑ Warm minimalism was reopened",
      "Keep the old sofa | Purchase | ✕Rejected | ",
      "A jute rug | Purchase | ●SettledArchived | ",
    ],
  ]);
  expect(inputsTo(fetch, "list_decisions")).toEqual([{ home: "flat", archived: true }]);
  unmount();

  renderRoutes("/homes/flat/decisions");
  expect(await screen.findByText("Keep the old sofa")).toBeDefined();
});

it("shows Rejected Decisions when filtered on Rejected, keeping Archived ones behind the switch", async () => {
  stubList(() => [
    ...decisions,
    summary("old-lamp", "A brass lamp", "purchase", "rejected", {
      archivedAt: "2026-09-10T12:00:00Z",
    }),
  ]);
  renderRoutes("/homes/flat/decisions?state=rejected");
  expect(await screen.findByText("Keep the old sofa")).toBeDefined();
  expect(screen.queryByText("A brass lamp")).toBeNull();
  expect(screen.getByLabelText("Show Rejected / Archived (1)")).toBeDefined();
});

it("has no switch when nothing is Rejected or Archived", async () => {
  stubList(() =>
    decisions.filter((decision) => decision.state !== "rejected" && !decision.archivedAt),
  );
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(screen.queryByLabelText(/Show Rejected/)).toBeNull();
});

it("filters by state and by kind with plain links, each keeping the other", async () => {
  const fetch = stubList();
  const { router } = renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(within(filters("State")).queryByRole("link", { name: "All" })).toBeNull();

  fireEvent.click(within(filters("State")).getByRole("link", { name: "Settled" }));
  await waitFor(() => expect(screen.queryByText("Reading nook")).toBeNull());
  expect(router.state.location.search).toBe("?state=settled");

  fireEvent.click(within(filters("Kind")).getByRole("link", { name: "Palette" }));
  await waitFor(() => expect(screen.queryByText("Warm minimalism")).toBeNull());
  expect(router.state.location.search).toBe("?state=settled&kind=palette");
  expect(groups().map(([title, rows]) => [title, rows.length])).toEqual([["Home-wide", 1]]);
  expect(screen.getByRole("link", { name: "Earthy palette" })).toBeDefined();
  // The filters in force read as plain text, and All clears one.
  expect(within(filters("State")).queryByRole("link", { name: "Settled" })).toBeNull();
  expect(within(filters("Kind")).queryByRole("link", { name: "Palette" })).toBeNull();

  fireEvent.click(within(filters("State")).getByRole("link", { name: "All" }));
  await waitFor(() => expect(router.state.location.search).toBe("?kind=palette"));
  expect(inputsTo(fetch, "list_decisions")).toEqual([
    { home: "flat", archived: true },
    { home: "flat", state: "settled", archived: true },
    { home: "flat", state: "settled", kind: "palette", archived: true },
    { home: "flat", kind: "palette", archived: true },
  ]);
});

it("says when there are no Decisions, or none match the filters", async () => {
  stubList(() => []);
  const { unmount } = renderRoutes("/homes/flat/decisions");
  expect(
    await screen.findByText(
      "No Decisions yet. Settle them with the Agent in this Home's Home Folder.",
    ),
  ).toBeDefined();
  unmount();

  renderRoutes("/homes/flat/decisions?state=rejected");
  expect(await screen.findByText("No Decisions match.")).toBeDefined();
});

it("shows the Decisions needing review, the Leaning ones, or those whose title matches", async () => {
  const fetch = stubList();
  const { router } = renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  const views = screen.getByRole("navigation", { name: "Views" });
  expect(within(views).getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe(
    "true",
  );

  // Needs review: an open flag or Conflict, worked out from the list the server gave.
  fireEvent.click(within(views).getByRole("link", { name: "Needs review" }));
  await waitFor(() => expect(screen.queryByText("Reading nook")).toBeNull());
  expect(router.state.location.search).toBe("?view=review");
  expect(groups().flatMap(([, rows]) => rows.map((row) => row.split(" | ")[0]))).toEqual([
    "Earthy palette",
    "Calm and low",
  ]);

  // Leaning is the Leaning state filter.
  fireEvent.click(within(views).getByRole("link", { name: "Leaning" }));
  expect(await screen.findByText("No Decisions match.")).toBeDefined();
  expect(router.state.location.search).toBe("?state=leaning");

  fireEvent.click(within(views).getByRole("link", { name: "All" }));
  await screen.findByText("Reading nook");
  expect(router.state.location.search).toBe("");

  // The title search keeps its words in the query string.
  fireEvent.change(screen.getByRole("searchbox", { name: "Search titles" }), {
    target: { value: "CALM low" },
  });
  await waitFor(() => expect(screen.queryByText("Reading nook")).toBeNull());
  expect(router.state.location.search).toBe("?q=CALM+low");
  expect(groups()).toHaveLength(1);
  expect(inputsTo(fetch, "list_decisions")).toContainEqual({
    home: "flat",
    state: "leaning",
    archived: true,
  });
});

it("shows a Palette's colors as small swatches in its row, and a Fulfilled note", async () => {
  stubList(() => [
    summary("palette", "Earthy palette", "palette", "settled", {
      colors: [
        { name: "Setting Plaster", hex: "#e3c9b6", provenance: "estimated", role: "base" },
        { name: "Olive", provenance: "estimated", role: "accent" },
      ],
    }),
    summary("rug", "Wool rug", "purchase", "settled", { fulfilledAt: raised }),
  ]);
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Earthy palette");
  expect(screen.getByTitle("Approximately #e3c9b6")).toBeDefined();
  expect(screen.getByTitle("No screen color recorded")).toBeDefined();
  expect(groups()[0]?.[1][1]).toBe("Wool rug | Purchase | ●Settled✓ Fulfilled | ");
});
