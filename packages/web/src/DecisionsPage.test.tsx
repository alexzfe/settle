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
  summary("living-room-direction", "Calm and low", "room-direction", "locked", {
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
  summary("design-direction", "Warm minimalism", "design-direction", "locked"),
  summary("palette", "Earthy palette", "palette", "locked", {
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
];

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubList(listed: () => DecisionSummary[] = () => decisions) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms, unplacedItems: 0 }),
    list_decisions: (input) => ({
      decisions: listed().filter(
        (each) =>
          (!input.state || each.state === input.state) && (!input.kind || each.kind === input.kind),
      ),
    }),
  });
}

/** Each group's heading and its lines. */
function groups(): [string | null | undefined, (string | null)[]][] {
  return [...document.querySelectorAll("main section")].map((section) => [
    section.querySelector("h2")?.textContent,
    [...section.querySelectorAll("li")].map((li) => li.textContent),
  ]);
}

function filters(name: string): HTMLElement {
  return screen.getByRole("navigation", { name });
}

it("lists every Decision by scope: Home-wide first, then each Room in the Home's order", async () => {
  const fetch = stubList();
  renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(inputsTo(fetch, "list_decisions")).toEqual([{ home: "flat" }]);
  expect(groups()).toEqual([
    [
      "Home-wide",
      ["Warm minimalism, Design Direction, Locked", "Earthy palette, Palette, Locked, Conflict"],
    ],
    [
      "Living room",
      ["Calm and low, Room Direction, Locked, Flagged", "Keep the old sofa, Purchase, Rejected"],
    ],
    ["Hallway", ["Reading nook, Room use, Candidate"]],
  ]);
  expect(screen.getByRole("link", { name: "Calm and low" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/living-room-direction",
  );
  expect(screen.getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );
});

it("filters by state and by kind with plain links, each keeping the other", async () => {
  const fetch = stubList();
  const { router } = renderRoutes("/homes/flat/decisions");
  await screen.findByText("Reading nook");
  expect(within(filters("State")).queryByRole("link", { name: "All" })).toBeNull();

  fireEvent.click(within(filters("State")).getByRole("link", { name: "Locked" }));
  await waitFor(() => expect(screen.queryByText("Reading nook")).toBeNull());
  expect(router.state.location.search).toBe("?state=locked");

  fireEvent.click(within(filters("Kind")).getByRole("link", { name: "Palette" }));
  await waitFor(() => expect(screen.queryByText("Warm minimalism")).toBeNull());
  expect(router.state.location.search).toBe("?state=locked&kind=palette");
  expect(groups()).toEqual([["Home-wide", ["Earthy palette, Palette, Locked, Conflict"]]]);
  // The filters in force read as plain text, and All clears one.
  expect(within(filters("State")).queryByRole("link", { name: "Locked" })).toBeNull();
  expect(within(filters("Kind")).queryByRole("link", { name: "Palette" })).toBeNull();

  fireEvent.click(within(filters("State")).getByRole("link", { name: "All" }));
  await waitFor(() => expect(router.state.location.search).toBe("?kind=palette"));
  expect(inputsTo(fetch, "list_decisions")).toEqual([
    { home: "flat" },
    { home: "flat", state: "locked" },
    { home: "flat", state: "locked", kind: "palette" },
    { home: "flat", kind: "palette" },
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
