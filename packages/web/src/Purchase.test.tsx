import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionDetail, Guides, Home, Level, QuickGuide, Room } from "./api";
import { formatDate } from "./format";
import { FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };
/** "living" starts "living-room" too, so a part's Room must be the longest slug that starts it. */
const rooms: Room[] = [
  { slug: "living", name: "Living", level: "ground" },
  { slug: "living-room", name: "Living room", level: "ground" },
  { slug: "hallway", name: "Hallway", level: "ground" },
];
const createdAt = "2026-09-10T10:00:00Z";
const written = "2026-09-12T09:00:00Z";
const changed = "2026-09-13T18:00:00Z";

/** The rug's Quick Guide as core assembles it: Measure first, the musts, the prefers, the AI's. */
const quickGuide: QuickGuide = {
  lines: [
    { kind: "measure-first", text: "Measure first: living-room/wall-2 length (~3.60 m)" },
    { kind: "must", text: "At least 2.0 × 1.4 m", requirement: 2 },
    { kind: "must", text: "Rolls to fit through the hallway door", requirement: 3 },
    { kind: "prefer", text: "Wool, low pile", requirement: 1 },
    { kind: "prefer", text: "In the Palette's clay", requirement: 4 },
    { kind: "prefer", text: "No wider than the sofa", requirement: 5 },
    { kind: "line", text: "Avoid viscose: it sheds" },
    { kind: "line", text: "In the shop: drag a key across it; loops that snag catch claws" },
  ],
  path: "/guide/wool-rug?home=flat",
};

const guides: Guides = {
  quickLines: [
    "Avoid viscose: it sheds",
    "In the shop: drag a key across it; loops that snag catch claws",
  ],
  fullGuide: { writtenAt: written, outOfDate: false },
};

const markdown = [
  "# Size",
  "It must reach under the sofa's front legs, so **at least 2.0 × 1.4 m**.",
  "",
  "## Fibre",
  "- Wool: stands up to *claws*",
  "- Avoid viscose",
  "",
  "See [the care notes](https://example.com/care).",
].join("\n");

/**
 * A Locked Purchase with Requirements listed by position, a prefer first, and each reason a
 * different kind of record; with its Quick Guide and Guides when given.
 */
function rug(parts: { quickGuide?: QuickGuide; guides?: Guides } = {}): DecisionDetail {
  return {
    slug: "wool-rug",
    title: "Wool rug",
    kind: "purchase",
    state: "locked",
    room: { slug: "living-room", name: "Living room" },
    statement: "A large wool rug under the sofa.",
    createdAt,
    content: {},
    basis: [],
    evidence: [],
    requirements: [
      {
        position: 1,
        text: "Wool, low pile",
        strength: "prefer",
        reason: { kind: "constraint", id: "two-cats", name: "Two cats" },
      },
      {
        position: 2,
        text: "At least 2.0 × 1.4 m",
        strength: "must",
        reason: { kind: "wall", id: "living-room/wall-2", name: "Wall 2", field: "length" },
      },
      {
        position: 3,
        text: "Rolls to fit through the hallway door",
        strength: "must",
        reason: {
          kind: "door",
          id: "living-room-hallway-door",
          name: "Door to the Hallway",
          field: "clearWidth",
        },
      },
      {
        position: 4,
        text: "In the Palette's clay",
        strength: "prefer",
        reason: { kind: "decision", id: "warm-clay", name: "Warm clay" },
      },
      {
        position: 5,
        text: "No wider than the sofa",
        strength: "prefer",
        reason: { kind: "item", id: "grey-sofa", name: "Grey sofa" },
      },
    ],
    listings: [],
    deviations: [],
    flags: [],
    conflicts: [],
    openFlags: [],
    openConflicts: [],
    stateChanges: [],
    ...parts,
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

/** The rug's page from the fake API, which gives the Full Guide's text only when asked for it. */
function showRug(parts: { quickGuide?: QuickGuide; guides?: Guides } = {}) {
  const fetch = stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms, unplacedItems: 0 }),
    get_decision: (input) => {
      const decision = rug(parts);
      const fullGuide = decision.guides?.fullGuide;
      if (input.includeFullGuide && decision.guides && fullGuide) {
        decision.guides = { ...decision.guides, fullGuide: { ...fullGuide, markdown } };
      }
      return { decision };
    },
  });
  renderRoutes("/homes/flat/decisions/wool-rug");
  return fetch;
}

function after(heading: string): Element | null | undefined {
  return screen.getByRole("heading", { name: heading }).nextElementSibling;
}

function listAfter(heading: string): (string | null)[] {
  return [...(after(heading)?.querySelectorAll(":scope > li") ?? [])].map((li) => li.textContent);
}

function href(name: string): string | null {
  return screen.getByRole("link", { name }).getAttribute("href");
}

it("lists the musts before the prefers, each reason linking to the record it points at", async () => {
  showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Requirements" });
  expect(listAfter("Requirements")).toEqual([
    "Must: At least 2.0 × 1.4 m (Wall 2, length)",
    "Must: Rolls to fit through the hallway door (Door to the Hallway, clear width)",
    "Prefer: Wool, low pile (Two cats)",
    "Prefer: In the Palette's clay (Warm clay)",
    "Prefer: No wider than the sofa (Grey sofa)",
  ]);
  // A Door is found in its Room once the Home's Rooms arrive.
  await screen.findByRole("link", { name: "Door to the Hallway" });
  expect(href("Door to the Hallway")).toBe("/homes/flat/rooms/living-room");
  expect(href("Wall 2")).toBe("/homes/flat/rooms/living-room");
  expect(href("Two cats")).toBe("/homes/flat");
  expect(href("Warm clay")).toBe("/homes/flat/decisions/warm-clay");
  expect(href("Grey sofa")).toBe("/homes/flat/items");
});

it("shows the Quick Guide in one block and the Full Guide on a tap", async () => {
  const fetch = showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Quick Guide" });
  const quick = after("Quick Guide");
  expect(quick?.tagName).toBe("UL");
  expect(listAfter("Quick Guide")).toEqual([
    "Measure first: living-room/wall-2 length (~3.60 m)",
    "Must: At least 2.0 × 1.4 m",
    "Must: Rolls to fit through the hallway door",
    "Prefer: Wool, low pile",
    "Prefer: In the Palette's clay",
    "Prefer: No wider than the sofa",
    "Avoid viscose: it sheds",
    "In the shop: drag a key across it; loops that snag catch claws",
  ]);
  expect(quick?.querySelector("strong")?.textContent).toBe(
    "Measure first: living-room/wall-2 length (~3.60 m)",
  );
  expect(after("Full Guide")?.textContent).toBe(`Written ${formatDate(written)}.`);
  // The Full Guide's text is not fetched until it is asked for.
  expect(inputsTo(fetch, "get_decision")).toEqual([{ home: "flat", decision: "wool-rug" }]);

  fireEvent.click(screen.getByRole("button", { name: "Show the Full Guide" }));

  expect(await screen.findByRole("heading", { name: "Size", level: 3 })).toBeDefined();
  expect(screen.getByRole("heading", { name: "Fibre", level: 4 })).toBeDefined();
  expect(screen.getByText("at least 2.0 × 1.4 m").tagName).toBe("STRONG");
  expect(screen.getByText("Avoid viscose").tagName).toBe("LI");
  expect(href("the care notes")).toBe("https://example.com/care");
  expect(inputsTo(fetch, "get_decision")).toEqual([
    { home: "flat", decision: "wool-rug" },
    { home: "flat", decision: "wool-rug", includeFullGuide: true },
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Hide the Full Guide" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Size" })).toBeNull());
});

it("marks the Full Guide out of date when a Requirement changed after it was written", async () => {
  showRug({
    quickGuide,
    guides: {
      ...guides,
      fullGuide: { writtenAt: written, requirementsChangedAt: changed, outOfDate: true },
    },
  });
  await screen.findByRole("heading", { name: "Full Guide" });
  expect(after("Full Guide")?.textContent).toBe(
    `Written ${formatDate(written)}. ` +
      `Out of date: a Requirement changed on ${formatDate(changed)} after it was written.`,
  );
  expect(screen.getByText("Out of date").tagName).toBe("STRONG");
});

it("says so when the Agent has not written the Guides yet", async () => {
  showRug();
  await screen.findByRole("heading", { name: "Quick Guide" });
  expect(after("Quick Guide")?.textContent).toBe(
    "None yet: the Agent writes the Guides in a Purchase Session.",
  );
  expect(after("Full Guide")?.textContent).toBe("None yet.");
  expect(screen.queryByRole("button", { name: "Show the Full Guide" })).toBeNull();
});
