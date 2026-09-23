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
import { shopLines } from "./Purchase";
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
    | "requirements"
    | "listings"
    | "deviations"
    | "fulfilledAt"
    | "fulfilment"
    | "flags"
    | "openFlags"
  >
>;

/**
 * A Settled Purchase with Requirements listed by position, a prefer first, and each reason a
 * different kind of record; with its Guides, Listings, Fulfilment, and flags when given.
 */
function rug(parts: Parts = {}): DecisionDetail {
  return {
    slug: "wool-rug",
    title: "Wool rug",
    kind: "purchase",
    state: "settled",
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

/** The items of the list under a title in a section: a shop-line group's, or a strength's. */
function block(title: string, section = "Taking it shopping"): (string | null)[] {
  const heading = within(sectionOf(section)).getByRole("heading", { name: title, level: 3 });
  const list = heading.nextElementSibling;
  return [...(list?.querySelectorAll("li") ?? [])].map((li) => li.textContent);
}

/** The Full Guide's block, which lives inside Taking it shopping rather than in a section. */
function fullGuideBlock(): HTMLElement {
  return within(sectionOf("Taking it shopping")).getByRole("heading", {
    name: "Full Guide",
    level: 3,
  }).parentElement as HTMLElement;
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

it("takes the Agent's own kinds out of the Quick Guide, in core's order, and nothing else", () => {
  // Core splices each Requirement into the guide verbatim as a must or a prefer, and the Decision
  // page prints the Requirements itself a few hundred pixels above (handoff Q12).
  expect(shopLines(quickGuide.lines)).toEqual([
    { kind: "avoid", text: "Viscose — sheds" },
    { kind: "test", text: "Drag a key across it: loops that snag catch claws" },
    { kind: "ask", text: "Backing latex or felt?" },
  ]);
  expect(shopLines([])).toEqual([]);
});

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
  expect(href("Grey sofa")).toBe("/homes/flat/items/grey-sofa");
});

it("names a reason on a long Note by what comes before its colon, the whole text on hover", async () => {
  const note =
    "Living room window cover: it must cut the afternoon glare and heat through the west-facing glass door";
  const long =
    "Window covers will be made to measure by a service that measures, cuts and fits them";
  showRug({
    requirements: [
      {
        position: 1,
        text: "Cuts the glare",
        strength: "must",
        reason: { kind: "note", id: "n1", name: note },
      },
      {
        position: 2,
        text: "Made to measure",
        strength: "must",
        reason: { kind: "note", id: "n2", name: long },
      },
    ],
  });
  await screen.findByRole("heading", { name: "Requirements" });
  expect(requirementsUnder("Must")).toEqual([
    "Cuts the glare | Living room window cover",
    `Made to measure | ${long}`,
  ]);
  expect(screen.getByText("Living room window cover").getAttribute("title")).toBe(note);
});

it("takes only the Agent's own lines shopping, with the Full Guide on a tap", async () => {
  const fetch = showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Taking it shopping" });
  // The looking-for line leads, then the Agent's lines in core's order, then the long version and
  // where to read it. The musts and prefers are the Requirements, printed once, above.
  const shopping = sectionOf("Taking it shopping");
  expect(shopping.querySelector("p")?.textContent).toBe(
    "Wool · low pile · warm clay · at least 2.0 × 1.4 m",
  );
  expect([...shopping.querySelectorAll("h3")].map((title) => title.textContent)).toEqual([
    "Avoid",
    "In the shop",
    "Ask the seller",
    "Full Guide",
    "Where to read it",
  ]);
  // The numbers of the looking-for line stand out, as they do in a shop.
  expect(
    within(shopping)
      .getAllByText("2.0 × 1.4 m")
      .map((number) => number.tagName),
  ).toEqual(["STRONG"]);
  expect(block("Avoid")).toEqual(["Viscose — sheds"]);
  expect(block("In the shop")).toEqual(["Drag a key across it: loops that snag catch claws"]);
  expect(block("Ask the seller")).toEqual(["Backing latex or felt?"]);
  // Measure first is hoisted under the statement, and is on the page exactly once.
  const measure = screen.getByText("Measure first").closest("aside") as HTMLElement;
  expect([...measure.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "living-room/wall-2 length (~3.60 m)",
  ]);
  expect(measure.querySelector("li strong")?.textContent).toBe(
    "living-room/wall-2 length (~3.60 m)",
  );
  expect(within(shopping).queryByText("Measure first")).toBeNull();
  expect(fullGuideBlock().querySelector("p")?.textContent).toBe(`Written ${formatDate(written)}.`);
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

it("does not reprint the statement as a looking-for line, which is a few pixels above", async () => {
  // The phone page keeps that fallback, so it is never headless; here the statement is already on
  // the page, and reprinting it is the duplication this work removes.
  const { lookingFor: _, ...unwritten } = quickGuide;
  showRug({ quickGuide: unwritten, guides: { ...guides, lookingFor: undefined } });
  await screen.findByRole("heading", { name: "Taking it shopping" });
  expect(screen.getAllByText("A large wool rug under the sofa.")).toHaveLength(1);
  expect(
    within(sectionOf("Taking it shopping")).getByRole("heading", { name: "Avoid" }),
  ).toBeDefined();
});

it("still offers the phone page and the exports when the Agent has written no shop lines", async () => {
  // A Purchase from before the Skill pushed on these lines has Guides but nothing to show here.
  const musts = quickGuide.lines.filter(
    (line) => line.kind !== "avoid" && line.kind !== "test" && line.kind !== "ask",
  );
  showRug({ quickGuide: { ...quickGuide, lines: musts }, guides: { ...guides, quickLines: [] } });
  await screen.findByRole("heading", { name: "Taking it shopping" });
  const shopping = sectionOf("Taking it shopping");
  expect(
    within(shopping).getByText(
      "No shop notes yet: nothing recorded to avoid on sight, try in the shop, or ask the seller.",
    ),
  ).toBeDefined();
  // The empty state is where the app says what to ask the Agent for.
  expect(within(shopping).getByRole("button", { name: /Ask the Agent/ })).toBeDefined();
  expect(within(shopping).getByRole("link", { name: "Phone page" })).toBeDefined();
});

it("says the phone page is live when taking it shopping", async () => {
  showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Where to read it" });
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
  expect(fullGuideBlock().querySelector("p")?.textContent).toBe(
    `Written ${formatDate(written)}. ` +
      `Out of date: a Requirement changed on ${formatDate(changed)} after it was written.`,
  );
  expect(screen.getByText("Out of date").tagName).toBe("STRONG");
});

it("says so when the Agent has written no Guides and checked no Listing yet", async () => {
  showRug();
  await screen.findByRole("heading", { name: "Taking it shopping" });
  const shopping = sectionOf("Taking it shopping");
  expect(
    within(shopping).getByText("None yet: the Agent writes the Guides in a Purchase Session."),
  ).toBeDefined();
  expect(fullGuideBlock().textContent).toBe("Full GuideNone yet.");
  expect(screen.queryByRole("button", { name: "Show the Full Guide" })).toBeNull();
  // No Guides at all, so no phone page and no exports to offer.
  expect(screen.queryByRole("navigation", { name: "The Guides elsewhere" })).toBeNull();
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
  expect(href("hay-plain-rug")).toBe("/homes/flat/items/hay-plain-rug");
  expect(href("old-jute-rug")).toBe("/homes/flat/items/old-jute-rug");
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
  // Core keeps a Rejected Purchase's Guides and phone address but serves none of them.
  const phoneUrl = "http://192.168.1.20:4380/guide/k3Jx9QaZ7pLm";
  showRug({ state: "rejected", quickGuide, guides: { ...guides, phoneUrl } });
  await screen.findByRole("heading", { name: "Taking it shopping" });

  expect(
    within(sectionOf("Taking it shopping")).getByText(
      "Rejected, so it has no Guides to open, print, or take shopping.",
    ),
  ).toBeDefined();
  expect(screen.queryByRole("navigation", { name: "The Guides elsewhere" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Phone page" })).toBeNull();
  expect(screen.queryByRole("img", { name: /^QR code/ })).toBeNull();
  expect(screen.queryByRole("link", { name: phoneUrl })).toBeNull();
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
      text: ` Living room, Wall 2's length changed, raised ${formatDate(raised)}: open`,
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

it("links to the phone page and the Guides' exports, with a QR code only given a phone address", async () => {
  showRug({ quickGuide, guides });
  await screen.findByRole("heading", { name: "Taking it shopping" });
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
  // No address a phone could reach: no QR code, and the local hint for LAN mode.
  expect(screen.queryByRole("img", { name: /^QR code/ })).toBeNull();
  expect(elsewhere.textContent).toContain("Start the app with SETTLE_LAN=1");
  cleanup();

  // LAN mode's address and a public origin's read the same; neither mentions a network.
  for (const phoneUrl of [
    "http://192.168.1.20:4380/guide/k3Jx9QaZ7pLm",
    "https://settle.example.com/guide/wool-rug",
  ]) {
    showRug({ quickGuide, guides: { ...guides, phoneUrl } });
    const qr = await screen.findByRole("img", { name: `QR code for ${phoneUrl}` });
    expect(qr.querySelector("path")).not.toBeNull();
    expect(screen.getByRole("link", { name: phoneUrl }).getAttribute("href")).toBe(phoneUrl);
    expect(qr.closest("figure")?.querySelector("figcaption")?.textContent).toBe(
      `Scan it with your phone to take the Quick Guide shopping: ${phoneUrl}`,
    );
    expect(
      screen.getByRole("navigation", { name: "The Guides elsewhere" }).textContent,
    ).not.toMatch(/SETTLE_LAN|this network/);
    cleanup();
  }
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
