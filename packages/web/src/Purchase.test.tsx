import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  DecisionDetail,
  DecisionSummary,
  Flag,
  Guides,
  Home,
  Level,
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

/**
 * The rug's Quick Guide as core assembles it: its looking-for line, Measure first, the musts, the
 * prefers, then the AI's avoids, tests, and asks.
 */
const quickGuide: QuickGuide = {
  lookingFor: "Wool · low pile · warm clay · at least 2.0 × 1.4 m",
  lines: [
    { kind: "measure-first", text: "Measure first: living-room/wall-2 length (~3.60 m)" },
    { kind: "must", text: "At least 2.0 × 1.4 m", requirement: 2 },
    { kind: "must", text: "Rolls to fit through the hallway door", requirement: 3 },
    { kind: "prefer", text: "Wool, low pile", requirement: 1 },
    { kind: "prefer", text: "In the Palette's clay", requirement: 4 },
    { kind: "prefer", text: "No wider than the sofa", requirement: 5 },
    { kind: "avoid", text: "Viscose — sheds" },
    { kind: "test", text: "Drag a key across it: loops that snag catch claws" },
    { kind: "ask", text: "Backing latex or felt?" },
  ],
  path: "/guide/wool-rug?home=flat",
};

const guides: Guides = {
  lookingFor: "Wool · low pile · warm clay · at least 2.0 × 1.4 m",
  quickLines: [
    { kind: "avoid", text: "Viscose — sheds" },
    { kind: "test", text: "Drag a key across it: loops that snag catch claws" },
    { kind: "ask", text: "Backing latex or felt?" },
  ],
  fullGuide: { writtenAt: written, outOfDate: false },
};

const shortGuide = [
  "# Size",
  "It must reach under the sofa's front legs, so **at least 2.0 × 1.4 m**.",
  "",
  "## Fibre",
  "- Wool: stands up to *claws*",
  "- Avoid viscose",
  "",
  "See [the care notes](https://example.com/care).",
].join("\n");

/** A longer Full Guide, with enough headings for a table of contents. */
const longGuide = [shortGuide, "## Colour", "Clay or rust.", "# Care", "Vacuum weekly."].join("\n");

/** The Full Guide the fake API gives when asked for it. */
let markdown = shortGuide;

type Parts = Partial<
  Pick<
    DecisionDetail,
    | "state"
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
  markdown = shortGuide;
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

/** The section a heading (h2) titles. */
function sectionOf(heading: string): HTMLElement {
  return screen.getByRole("heading", { name: heading, level: 2 }).closest("section") as HTMLElement;
}

/** The text of a section after its header. */
function after(heading: string): string {
  return [...sectionOf(heading).children]
    .slice(1)
    .map((child) => child.textContent)
    .join("");
}

/** Each item of the first list in a section, its parts joined by " | ". */
function listAfter(heading: string): string[] {
  const list = sectionOf(heading).querySelector("ul");
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) =>
    li.children.length > 1
      ? [...li.children].map((child) => child.textContent).join(" | ")
      : (li.textContent ?? ""),
  );
}

/** The items of the list under a title in a section: a Quick Guide section's, or a strength's. */
function block(title: string, section = "Quick Guide"): (string | null)[] {
  const heading = within(sectionOf(section)).getByRole("heading", { name: title, level: 3 });
  const list = heading.nextElementSibling;
  return [...(list?.querySelectorAll("li") ?? [])].map((li) => li.textContent);
}

function href(name: string): string | null {
  return screen.getByRole("link", { name }).getAttribute("href");
}

/** Each Requirement under a strength's heading, its text and reason chip joined by " | ". */
function requirementsUnder(strength: string): string[] {
  const heading = within(sectionOf("Requirements")).getByRole("heading", {
    name: strength,
    level: 3,
  });
  return [...(heading.nextElementSibling?.querySelectorAll(":scope > li") ?? [])].map((li) =>
    [...li.children].map((child) => child.textContent).join(" | "),
  );
}

it("groups the Requirements under Must and Prefer, each reason linking to its record", async () => {
  showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Requirements" });
  // The heading says the strength, so no row repeats it; each group keeps position order.
  expect(
    within(sectionOf("Requirements"))
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Must", "Prefer"]);
  expect(requirementsUnder("Must")).toEqual([
    "At least 2.0 × 1.4 m | Wall 2, length",
    "Rolls to fit through the hallway door | Door to the Hallway, clear width",
  ]);
  expect(requirementsUnder("Prefer")).toEqual([
    "Wool, low pile | Two cats",
    "In the Palette's clay | Warm clay",
    "No wider than the sofa | Grey sofa",
  ]);
  // A Door is found in its Room once the Home's Rooms arrive.
  await screen.findByRole("link", { name: "Door to the Hallway, clear width" });
  expect(href("Door to the Hallway, clear width")).toBe("/homes/flat/rooms/living-room");
  expect(href("Wall 2, length")).toBe("/homes/flat/rooms/living-room");
  expect(href("Two cats")).toBe("/homes/flat/about");
  expect(href("Warm clay")).toBe("/homes/flat/decisions/warm-clay");
  expect(href("Grey sofa")).toBe("/homes/flat/items");
});

it("shows the Quick Guide in the phone page's order and the Full Guide on a tap", async () => {
  const fetch = showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Quick Guide" });
  // The looking-for line leads, then the sections in the phone page's order, all shown.
  const guide = within(sectionOf("Quick Guide")).getByText("Measure first").closest("aside")
    ?.parentElement as HTMLElement;
  expect(guide.firstElementChild?.textContent).toBe(
    "Wool · low pile · warm clay · at least 2.0 × 1.4 m",
  );
  expect(
    [...guide.querySelectorAll("aside > p:first-child, h3")].map((title) => title.textContent),
  ).toEqual(["Measure first", "Must", "Avoid", "Prefer", "In the shop", "Ask the seller"]);
  // Measure first, set off as important, before anything else.
  const measure = within(sectionOf("Quick Guide")).getByText("Measure first").closest("aside");
  expect([...(measure?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual([
    "living-room/wall-2 length (~3.60 m)",
  ]);
  expect(measure?.querySelector("li strong")?.textContent).toBe(
    "living-room/wall-2 length (~3.60 m)",
  );
  expect(block("Must")).toEqual(["At least 2.0 × 1.4 m", "Rolls to fit through the hallway door"]);
  // The numbers of a must stand out.
  expect(
    within(sectionOf("Quick Guide"))
      .getAllByText("2.0 × 1.4 m")
      .map((number) => number.tagName),
  ).toEqual(["STRONG", "STRONG"]);
  expect(block("Prefer")).toEqual([
    "Wool, low pile",
    "In the Palette's clay",
    "No wider than the sofa",
  ]);
  expect(block("Avoid")).toEqual(["Viscose — sheds"]);
  expect(block("In the shop")).toEqual(["Drag a key across it: loops that snag catch claws"]);
  expect(block("Ask the seller")).toEqual(["Backing latex or felt?"]);
  expect(sectionOf("Full Guide").querySelector("p")?.textContent).toBe(
    `Written ${formatDate(written)}.`,
  );
  // The Full Guide's text is not fetched until it is asked for.
  expect(inputsTo(fetch, "get_decision")).toEqual([{ home: "flat", decision: "wool-rug" }]);

  fireEvent.click(screen.getByRole("button", { name: "Show the Full Guide" }));

  expect(await screen.findByRole("heading", { name: "Size", level: 3 })).toBeDefined();
  expect(screen.getByRole("heading", { name: "Fibre", level: 4 })).toBeDefined();
  expect(screen.getByText("at least 2.0 × 1.4 m").tagName).toBe("STRONG");
  // The Agent wrote it, and a short Guide needs no table of contents.
  expect(screen.getAllByText(/^Written by the Agent/).map((label) => label.textContent)).toEqual([
    "Written by the Agent · Purchase Session · 10 Sep",
    "Written by the Agent · Full Guide · 12 Sep",
  ]);
  expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();
  expect(screen.getByText("Avoid viscose").tagName).toBe("LI");
  expect(href("the care notes")).toBe("https://example.com/care");
  expect(inputsTo(fetch, "get_decision")).toEqual([
    { home: "flat", decision: "wool-rug" },
    { home: "flat", decision: "wool-rug", includeFullGuide: true },
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Hide the Full Guide" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Size" })).toBeNull());
});

it("leads the Quick Guide with the statement until a Session writes a looking-for line", async () => {
  const { lookingFor: _, ...unwritten } = quickGuide;
  showRug({ quickGuide: unwritten, guides: { ...guides, lookingFor: undefined } });
  await screen.findByRole("heading", { name: "Quick Guide" });
  expect(
    within(sectionOf("Quick Guide")).getByText("A large wool rug under the sofa.").tagName,
  ).toBe("P");
});

it("says the phone page is live when taking it shopping", async () => {
  showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Take it shopping" });
  const steps = screen.getByRole("navigation", { name: "The Guides elsewhere" });
  expect(
    [...steps.querySelectorAll("ol > li > span:first-child")].map((s) => s.textContent),
  ).toEqual(["Open it on your phone", "Print it or download it", "It stays current"]);
  expect(steps.textContent).toContain(
    "The phone page is live: it changes when the Agent changes a Requirement.",
  );
  expect(steps.textContent).not.toMatch(/won't update/);
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
  expect(sectionOf("Full Guide").querySelector("p")?.textContent).toBe(
    `Written ${formatDate(written)}. ` +
      `Out of date: a Requirement changed on ${formatDate(changed)} after it was written.`,
  );
  expect(screen.getByText("Out of date").tagName).toBe("STRONG");
});

it("says so when the Agent has written no Guides and checked no Listing yet", async () => {
  showRug();
  await screen.findByRole("heading", { name: "Quick Guide" });
  expect(after("Quick Guide")).toBe("None yet: the Agent writes the Guides in a Purchase Session.");
  expect(after("Full Guide")).toBe("None yet.");
  expect(screen.queryByRole("button", { name: "Show the Full Guide" })).toBeNull();
  expect(after("Listings")).toBe(
    "None yet: the Agent checks a product you bring it against the Requirements.",
  );
  // Not Fulfilled, so no Fulfilment and no Deviations.
  expect(screen.queryByRole("heading", { name: "Fulfilment" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Deviations" })).toBeNull();
});

it("gives a long Full Guide a table of contents linking to its headings", async () => {
  markdown = longGuide;
  showRug({ quickGuide, guides });
  fireEvent.click(await screen.findByRole("button", { name: "Show the Full Guide" }));
  const contents = await screen.findByRole("navigation", { name: "Contents" });
  const links = [...contents.querySelectorAll("a")];
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Size", "#wool-rug-guide-size"],
    ["Fibre", "#wool-rug-guide-fibre"],
    ["Colour", "#wool-rug-guide-colour"],
    ["Care", "#wool-rug-guide-care"],
  ]);
  expect(screen.getByRole("heading", { name: "Care", level: 3 }).id).toBe("wool-rug-guide-care");
});

it("shows what a Fulfilled Purchase bought, the Home changes, and its Deviations", async () => {
  showRug({
    quickGuide,
    guides,
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
        reason: "the only wool one in stock",
        recordedAt: fulfilled,
      },
    ],
  });
  await screen.findByRole("heading", { name: "Fulfilment" });
  expect(after("Fulfilment")).toBe(
    "BoughtHay Plain rug, 190 × 290 cm, rust, £450" +
      "Item addedhay-plain-rug" +
      "Item replaced (Archived)old-jute-rug",
  );
  expect(href("hay-plain-rug")).toBe("/homes/flat/items");
  expect(href("old-jute-rug")).toBe("/homes/flat/items");
  // The must's first, and marked as the one that flags the Decisions resting on this one.
  // The reason in brackets after the difference, as the receipt has it.
  expect(listAfter("Deviations")).toEqual([
    "Must: At least 2.0 × 1.4 m. Deviation: 1.9 × 2.9 m, a little narrow " +
      "(the only wool one in stock) " +
      "(from a must, so every Decision resting on this one is flagged)",
    "Prefer: In the Palette's clay. Deviation: rust, not clay",
  ]);
});

it("offers no phone page, exports, or QR code for a Rejected Purchase, and says so", async () => {
  // Core keeps a Rejected Purchase's Guides and LAN address but serves none of them.
  const lanUrl = "http://192.168.1.20:4380/guide/k3Jx9QaZ7pLm";
  showRug({ state: "rejected", quickGuide, guides: { ...guides, lanUrl } });
  await screen.findByRole("heading", { name: "Quick Guide" });

  expect(
    within(sectionOf("Quick Guide")).getByText(
      "Rejected, so it has no Guides to open, print, or take shopping.",
    ),
  ).toBeDefined();
  expect(screen.queryByRole("navigation", { name: "The Guides elsewhere" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Phone page" })).toBeNull();
  expect(screen.queryByRole("img", { name: /^QR code/ })).toBeNull();
  expect(screen.queryByRole("link", { name: lanUrl })).toBeNull();
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

  const list = sectionOf("Flags").querySelector("ul") as HTMLElement;
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
      text: `⚑ Living room, Wall 2's length changed, raised ${formatDate(raised)}: open`,
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

  parts.listings = [
    {
      slug: "hay-plain-rug",
      name: "Hay Plain rug",
      price: "£450",
      recordedAt: written,
      checks: [],
      counts: { pass: 0, fail: 0, unknown: 0 },
      failedMusts: [],
    },
  ];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "wool-rug",
    }),
  );
  expect(await screen.findByText("Hay Plain rug")).toBeDefined();
});
