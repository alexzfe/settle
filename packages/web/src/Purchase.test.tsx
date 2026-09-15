import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  DecisionDetail,
  DecisionSummary,
  Flag,
  Guides,
  Home,
  Level,
  Listing,
  QuickGuide,
  Room,
} from "./api";
import { formatDate } from "./format";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

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
const fulfilled = "2026-09-14T15:00:00Z";

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

type Parts = Partial<
  Pick<
    DecisionDetail,
    | "quickGuide"
    | "guides"
    | "listings"
    | "deviations"
    | "fulfilledAt"
    | "fulfilment"
    | "flags"
    | "openFlags"
  >
>;

/**
 * A Locked Purchase with Requirements listed by position, a prefer first, and each reason a
 * different kind of record; with its Guides, Listings, Fulfilment, and flags when given.
 */
function rug(parts: Parts = {}): DecisionDetail {
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

/** The rug's line, as a resolution answers it. */
function rugSummary(): DecisionSummary {
  const { slug, kind, title, statement, state, room, createdAt } = rug();
  return { slug, kind, title, statement, state, room, createdAt, openFlags: [], openConflicts: [] };
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
function showRug(parts: Parts = {}, handlers: ApiHandlers = {}) {
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
    ...handlers,
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

it("says so when the Agent has written no Guides and checked no Listing yet", async () => {
  showRug();
  await screen.findByRole("heading", { name: "Quick Guide" });
  expect(after("Quick Guide")?.textContent).toBe(
    "None yet: the Agent writes the Guides in a Purchase Session.",
  );
  expect(after("Full Guide")?.textContent).toBe("None yet.");
  expect(screen.queryByRole("button", { name: "Show the Full Guide" })).toBeNull();
  expect(after("Listings")?.textContent).toBe(
    "None yet: the Agent checks a product you bring it against the Requirements.",
  );
  // Not Fulfilled, so no Fulfilment and no Deviations.
  expect(screen.queryByRole("heading", { name: "Fulfilment" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Deviations" })).toBeNull();
});

/** One Listing that passes every must, and one that fails a must and a prefer. */
const listings: Listing[] = [
  {
    slug: "hay-plain-rug",
    name: "Hay Plain rug",
    url: "https://example.com/hay-plain",
    price: "£450",
    dimensions: { width: 2000, depth: 3000 },
    photo: "https://example.com/hay-plain.jpg",
    recordedAt: written,
    checks: [
      { requirement: 1, text: "Wool, low pile", strength: "prefer", result: "pass", note: "wool" },
      {
        requirement: 2,
        text: "At least 2.0 × 1.4 m",
        strength: "must",
        result: "pass",
        note: "200 × 300 cm",
      },
      {
        requirement: 3,
        text: "Rolls to fit through the hallway door",
        strength: "must",
        result: "pass",
      },
      {
        requirement: 4,
        text: "In the Palette's clay",
        strength: "prefer",
        result: "unknown",
        note: "only a photo",
      },
      // Added after the Listing was checked.
      {
        requirement: 5,
        text: "No wider than the sofa",
        strength: "prefer",
        result: "unknown",
        unchecked: true,
      },
    ],
    counts: { pass: 3, fail: 0, unknown: 2 },
    failedMusts: [],
  },
  {
    slug: "viscose-runner",
    name: "Viscose runner",
    price: "£89",
    recordedAt: written,
    checks: [
      {
        requirement: 1,
        text: "Wool, low pile",
        strength: "prefer",
        result: "fail",
        note: "viscose",
      },
      {
        requirement: 2,
        text: "At least 2.0 × 1.4 m",
        strength: "must",
        result: "fail",
        note: "80 × 250 cm",
      },
      {
        requirement: 3,
        text: "Rolls to fit through the hallway door",
        strength: "must",
        result: "pass",
      },
      { requirement: 4, text: "In the Palette's clay", strength: "prefer", result: "pass" },
      { requirement: 5, text: "No wider than the sofa", strength: "prefer", result: "unknown" },
    ],
    counts: { pass: 2, fail: 2, unknown: 1 },
    failedMusts: [2],
  },
];

function section(name: string): HTMLElement {
  return screen.getByRole("heading", { name, level: 3 }).closest("section") as HTMLElement;
}

function paragraphs(within: HTMLElement): (string | null)[] {
  return [...within.querySelectorAll("p")].map((p) => p.textContent);
}

/** Each check's row: the Requirement, the result, the note. */
function rows(within: HTMLElement): (string | null)[][] {
  return [...within.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  );
}

it("shows each Listing with its counts and checks, musts first, a failed must marked", async () => {
  showRug({ quickGuide, guides, listings });
  await screen.findByRole("heading", { name: "Hay Plain rug", level: 3 });
  const date = formatDate(written);

  const hay = section("Hay Plain rug");
  expect(within(hay).getByRole("link", { name: "Hay Plain rug" }).getAttribute("href")).toBe(
    "https://example.com/hay-plain",
  );
  expect(within(hay).getByRole("link", { name: "photo" }).getAttribute("href")).toBe(
    "https://example.com/hay-plain.jpg",
  );
  expect(paragraphs(hay)).toEqual([
    `£450, W 2.00 m × D 3.00 m, photo, recorded ${date}`,
    "3 pass, 0 fail, 2 unknown.",
  ]);
  expect(rows(hay)).toEqual([
    ["Must: At least 2.0 × 1.4 m", "Pass", "200 × 300 cm"],
    ["Must: Rolls to fit through the hallway door", "Pass", ""],
    ["Prefer: Wool, low pile", "Pass", "wool"],
    ["Prefer: In the Palette's clay", "Unknown", "only a photo"],
    ["Prefer: No wider than the sofa", "Unknown: added after it was checked", ""],
  ]);
  expect(hay.querySelectorAll("strong")).toHaveLength(0);

  const runner = section("Viscose runner");
  // Without a web address, the name is not a link.
  expect(within(runner).queryByRole("link")).toBeNull();
  expect(paragraphs(runner)).toEqual([
    `£89, recorded ${date}`,
    "2 pass, 2 fail, 1 unknown. Fails a must: At least 2.0 × 1.4 m.",
  ]);
  expect(within(runner).getByText("Fails a must: At least 2.0 × 1.4 m.").tagName).toBe("STRONG");
  expect(rows(runner)).toEqual([
    ["Must: At least 2.0 × 1.4 m", "Fail", "80 × 250 cm"],
    ["Must: Rolls to fit through the hallway door", "Pass", ""],
    ["Prefer: Wool, low pile", "Fail", "viscose"],
    ["Prefer: In the Palette's clay", "Pass", ""],
    ["Prefer: No wider than the sofa", "Unknown", ""],
  ]);
  // Only the failed must is marked, not the failed prefer.
  expect([...runner.querySelectorAll("tbody strong")].map((each) => each.textContent)).toEqual([
    "Fail",
  ]);
});

it("shows what a Fulfilled Purchase bought, the Home changes, and its Deviations", async () => {
  showRug({
    quickGuide,
    guides,
    listings,
    fulfilledAt: fulfilled,
    fulfilment: {
      bought: "Hay Plain rug, 190 × 290 cm, rust, £450",
      item: "hay-plain-rug",
      replacedItem: "old-jute-rug",
    },
    deviations: [
      {
        slug: "wool-rug/deviation-2",
        requirement: 4,
        requirementText: "In the Palette's clay",
        strength: "prefer",
        text: "rust, not clay",
        recordedAt: fulfilled,
      },
      {
        slug: "wool-rug/deviation-1",
        requirement: 2,
        requirementText: "At least 2.0 × 1.4 m",
        strength: "must",
        text: "1.9 × 2.9 m, a little narrow",
        recordedAt: fulfilled,
      },
    ],
  });
  await screen.findByRole("heading", { name: "Fulfilment" });
  expect(after("Fulfilment")?.textContent).toBe(
    "BoughtHay Plain rug, 190 × 290 cm, rust, £450" +
      "Item addedhay-plain-rug" +
      "Item replaced (Archived)old-jute-rug",
  );
  expect(href("hay-plain-rug")).toBe("/homes/flat/items");
  expect(href("old-jute-rug")).toBe("/homes/flat/items");
  // The must's first, and marked as the one that flags the Decisions resting on this one.
  expect(listAfter("Deviations")).toEqual([
    "Must: At least 2.0 × 1.4 m. Deviation: 1.9 × 2.9 m, a little narrow " +
      "(from a must, so every Decision resting on this one is flagged)",
    "Prefer: In the Palette's clay. Deviation: rust, not clay",
  ]);
});

it("names the changed record and field of a value_changed flag, and clears it with Keep", async () => {
  const raised = "2026-09-14T09:00:00Z";
  const cleared = "2026-09-14T11:00:00Z";
  const flag: Flag = {
    slug: "wool-rug/flag-1",
    decision: { slug: "wool-rug", title: "Wool rug" },
    cause: "value_changed",
    source: {
      kind: "wall",
      slug: "living-room/wall-2",
      name: "Living room, Wall 2",
      field: "length",
    },
    raisedAt: raised,
  };
  let flags = [flag];
  const fetch = stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms, unplacedItems: 0 }),
    get_decision: () => ({
      decision: rug({ flags, openFlags: flags.filter((each) => !each.clearedAt) }),
    }),
    resolve_flag: () => {
      flags = [{ ...flag, clearedAt: cleared, resolution: "keep" }];
      return { receipt: "Kept Wool rug.", decision: rugSummary() };
    },
  });
  renderRoutes("/homes/flat/decisions/wool-rug");
  await screen.findByRole("heading", { name: "Flags" });

  const list = after("Flags") as HTMLElement;
  const lines = () =>
    [...list.querySelectorAll(":scope > li")].map((li) => ({
      text: [...li.childNodes]
        .filter((node) => node.nodeName !== "FORM")
        .map((node) => node.textContent)
        .join(""),
      buttons: [...li.querySelectorAll("button")].map((button) => button.textContent),
    }));
  expect(lines()).toEqual([
    {
      text: `Living room, Wall 2's length changed, raised ${formatDate(raised)}: open`,
      buttons: ["Keep", "Reopen", "Reject"],
    },
  ]);
  expect(within(list).getByRole("link", { name: "Living room, Wall 2" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );

  fireEvent.click(within(list).getByRole("button", { name: "Keep" }));

  await waitFor(() =>
    expect(lines()).toEqual([
      {
        text:
          `Living room, Wall 2's length changed, raised ${formatDate(raised)}: ` +
          `cleared ${formatDate(cleared)}, kept`,
        buttons: [],
      },
    ]),
  );
  expect(inputsTo(fetch, "resolve_flag")).toEqual([
    { home: "flat", flag: "wool-rug/flag-1", resolution: "keep" },
  ]);
});

it("links to the phone page and the Guides' exports, with a QR code only in LAN mode", async () => {
  showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Quick Guide" });
  const elsewhere = screen.getByRole("navigation", { name: "The Guides elsewhere" });
  expect(
    [...elsewhere.querySelectorAll("a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]),
  ).toEqual([
    ["Phone page", "/guide/wool-rug?home=flat"],
    ["Printable Guides", "/api/export_guides?home=flat&format=html&decision=wool-rug"],
    ["Guides as Markdown", "/api/export_guides?home=flat&format=markdown&decision=wool-rug"],
  ]);
  // Not in LAN mode: no address a phone could reach, so no QR code.
  expect(screen.queryByRole("img", { name: /^QR code/ })).toBeNull();
  cleanup();

  const lanUrl = "http://192.168.1.20:4380/guide/k3Jx9QaZ7pLm";
  showRug({ quickGuide, guides: { ...guides, lanUrl } });
  const qr = await screen.findByRole("img", { name: `QR code for ${lanUrl}` });
  expect(qr.querySelector("path")?.getAttribute("d")).toMatch(/^M4 4h1v1h-1z/);
  expect(screen.getByRole("link", { name: lanUrl }).getAttribute("href")).toBe(lanUrl);
});

it("shows a Listing the Agent records without a reload", async () => {
  const parts: Parts = { quickGuide, guides };
  showRug(parts);
  await screen.findByText(
    "None yet: the Agent checks a product you bring it against the Requirements.",
  );

  parts.listings = listings;
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "wool-rug",
    }),
  );
  expect(await screen.findByRole("heading", { name: "Hay Plain rug", level: 3 })).toBeDefined();
});
