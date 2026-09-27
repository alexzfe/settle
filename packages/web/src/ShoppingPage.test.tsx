import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Home, ShoppingEntry } from "./api";
import page from "./ShoppingPage.module.css";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const livingRoom = { slug: "living-room", name: "Living room" };

function entry(slug: string, title: string, rest: Partial<ShoppingEntry> = {}): ShoppingEntry {
  return {
    slug,
    title,
    statement: `${title}.`,
    state: "settled",
    requirements: { must: 0, prefer: 0 },
    hasGuides: false,
    fullGuideOutOfDate: false,
    listings: 0,
    held: 0,
    measureFirst: [],
    openFlags: 0,
    ...rest,
  };
}

/** A Settled rug with everything so far, and a Home-wide lamp with nothing yet. */
const rug = entry("wool-rug", "Wool rug", {
  statement: "A large wool rug under the sofa.",
  room: livingRoom,
  requirements: { must: 2, prefer: 1 },
  hasGuides: true,
  fullGuideOutOfDate: true,
  listings: 2,
  bestRating: 4,
  bestListing: { slug: "hay-plain-rug", name: "Hay Plain rug", photoVersion: "625b0d88aa11bb22" },
  measureFirst: [
    "Measure first: Living room, Wall 2 length (~3.60 m)",
    "Measure first: the Home's narrowest access width (not recorded)",
  ],
  openFlags: 1,
});
const lamp = entry("reading-lamp", "Reading lamp", {
  requirements: { must: 1, prefer: 0 },
  measureFirst: ["Measure first: the desk height (not recorded)"],
});
const sofa = entry("low-sofa", "Low sofa", {
  state: "leaning",
  room: livingRoom,
  requirements: { must: 1, prefer: 2 },
  hasGuides: true,
  listings: 1,
});
const chair = entry("desk-chair", "Desk chair", { state: "candidate" });

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubShopping(handlers: ApiHandlers) {
  return stubApi({ list_homes: () => ({ homes: [flat] }), ...handlers });
}

function sectionOf(heading: string): HTMLElement {
  return screen.getByRole("heading", { name: heading }).closest("section") as HTMLElement;
}

/**
 * Each row under `heading`, cell by cell: the state, the title and statement, the Room, and the
 * line of what it has so far with any Flag and what to measure first.
 */
function entriesAfter(heading: string): string[][] {
  const list = sectionOf(heading).querySelector(`.${page.entries}`);
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) =>
    [...li.children]
      .filter((cell) => cell.tagName !== "IMG" && !cell.querySelector("img"))
      // The state's cell is the mark, so it reads by its name.
      .map((cell) => cell.getAttribute("aria-label") ?? cell.textContent ?? ""),
  );
}

/** The text of a section after its title. */
function after(heading: string): string {
  return [...sectionOf(heading).children]
    .slice(1)
    .map((child) => child.textContent)
    .join("");
}

function entryOf(title: string): HTMLElement {
  return screen.getByRole("link", { name: title }).closest("li") as HTMLElement;
}

it("shows the Shopping List and Considering, each entry linking to its Decision page", async () => {
  const fetch = stubShopping({
    get_shopping: () => ({ shoppingList: [rug, lamp], considering: [sofa, chair] }),
  });
  renderRoutes("/homes/flat/shopping");
  await screen.findByRole("heading", { name: "Shopping List" });
  expect(inputsTo(fetch, "get_shopping")).toEqual([{ home: "flat" }]);

  expect(entriesAfter("Shopping List")).toEqual([
    [
      "Settled",
      "Wool rugA large wool rug under the sofa.",
      "Living room",
      "2 musts, 1 prefer · Guides written · Full Guide out of date · " +
        "2 Listings, best is 4 stars: Hay Plain rug" +
        "Flagged" +
        "Measure first" +
        "Living room, Wall 2 length (~3.60 m)" +
        "the Home's narrowest access width (not recorded)",
    ],
    [
      "Settled",
      "Reading lampReading lamp.",
      "Whole home",
      "1 must, 0 prefers · No Guides yet · No Listings yet" +
        "Measure first" +
        "the desk height (not recorded)",
    ],
  ]);
  // Considering shows each one's state on the mark, like every other list.
  expect(entriesAfter("Considering")).toEqual([
    [
      "Leaning",
      "Low sofaLow sofa.",
      "Living room",
      "1 must, 2 prefers · Guides written · 1 Listing",
    ],
    [
      "Candidate",
      "Desk chairDesk chair.",
      "Whole home",
      "No Requirements yet · No Guides yet · No Listings yet",
    ],
  ]);

  const wool = entryOf("Wool rug");
  expect(within(wool).getByRole("link", { name: "Wool rug" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/wool-rug",
  );
  // The title is the row's one link: its page puts the Quick Guide first once it is Settled.
  expect(within(wool).getAllByRole("link")).toHaveLength(1);
  expect(within(wool).getByText(/^Living room, Wall 2/).tagName).toBe("LI");
  expect(within(wool).getByText("Full Guide out of date").tagName).toBe("STRONG");
  expect(within(wool).getByRole("img", { name: "Settled" })).toBeDefined();
  // The sofa has a Listing but no Rating the user could act on — every one of them fails a must
  // or is Held — so its line says the count alone rather than headline one it cannot buy.
  expect(within(entryOf("Low sofa")).getByText(/1 Listing$/)).toBeDefined();
  expect(screen.getByRole("link", { name: "Desk chair" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/desk-chair",
  );
});

it("shows the best Listing's picture beside the entry, stored copy first, then its link, else nothing", async () => {
  const best = (name: string, rest: Partial<NonNullable<ShoppingEntry["bestListing"]>> = {}) => ({
    listings: 1,
    bestRating: 5,
    bestListing: { slug: name.toLowerCase().replaceAll(" ", "-"), name, ...rest },
  });
  stubShopping({
    get_shopping: () => ({
      shoppingList: [
        rug,
        // A stored copy wins over the link it came from.
        entry("floor-lamp", "Floor lamp", {
          ...best("Arc lamp", { photoUrl: "https://shop.example/arc.jpg", photoVersion: "abc" }),
        }),
        entry(
          "door-mat",
          "Door mat",
          best("Coir mat", { photoUrl: "https://shop.example/mat.jpg" }),
        ),
        // A link that is not http(s) is never put in an <img>.
        entry("side-table", "Side table", best("Oak table", { photoUrl: "javascript:alert(1)" })),
        entry("blind", "Blind", best("Linen blind")),
      ],
      considering: [],
    }),
  });
  renderRoutes("/homes/flat/shopping");
  await screen.findByRole("heading", { name: "Shopping List" });

  const picture = (title: string) => entryOf(title).querySelector("img");
  const hay = within(entryOf("Wool rug")).getByRole("img", { name: "Hay Plain rug" });
  expect(hay.getAttribute("src")).toBe(
    "/api/get_listing_photo?home=flat&listing=hay-plain-rug&v=625b0d88aa11bb22",
  );
  expect(picture("Floor lamp")?.getAttribute("src")).toBe(
    "/api/get_listing_photo?home=flat&listing=arc-lamp&v=abc",
  );
  expect(picture("Door mat")?.getAttribute("src")).toBe("https://shop.example/mat.jpg");
  expect(picture("Door mat")?.getAttribute("alt")).toBe("Coir mat");
  // No picture to show: no empty slot either, just the line naming it.
  expect(picture("Side table")).toBeNull();
  expect(picture("Blind")).toBeNull();
  expect(
    within(entryOf("Blind")).getByText(/1 Listing, best is 5 stars: Linen blind/),
  ).toBeDefined();
  // The mark is drawn inline, so the picture is the row's only <img>.
  expect(entryOf("Wool rug").querySelectorAll("img")).toHaveLength(1);

  // A hotlink that will not load goes quietly, rather than leave a broken image.
  const mat = picture("Door mat") as HTMLImageElement;
  act(() => {
    mat.dispatchEvent(new Event("error"));
  });
  expect(picture("Door mat")).toBeNull();
});

it("shows no picture for an entry with no best Listing", async () => {
  stubShopping({ get_shopping: () => ({ shoppingList: [lamp], considering: [sofa] }) });
  renderRoutes("/homes/flat/shopping");
  await screen.findByRole("heading", { name: "Shopping List" });
  expect(document.querySelectorAll("main img, li img")).toHaveLength(0);
});

it("reads as stacked rows on a phone, with no cell of its own for a missing picture", async () => {
  stubShopping({ get_shopping: () => ({ shoppingList: [rug, lamp], considering: [] }) });
  renderRoutes("/homes/flat/shopping");
  await screen.findByRole("heading", { name: "Shopping List" });
  // Every row's cells are laid out by name, so the grid holds whether or not there is a picture.
  expect(entryOf("Wool rug").children).toHaveLength(5);
  expect(entryOf("Reading lamp").children).toHaveLength(4);
});

it("links to the printable Shopping List, its CSV, and the Shopping Guides", async () => {
  stubShopping({ get_shopping: () => ({ shoppingList: [], considering: [] }) });
  renderRoutes("/homes/flat/shopping");
  await screen.findByRole("heading", { name: "Shopping List" });
  const downloads = screen.getByRole("navigation", { name: "Downloads" });
  const links = [...downloads.querySelectorAll("a")].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
  expect(links).toEqual([
    ["Printable Shopping List", "/api/export_shopping_list?home=flat&format=html"],
    ["Shopping List as CSV", "/api/export_shopping_list?home=flat&format=csv"],
    ["Printable Shopping Guides", "/api/export_guides?home=flat&format=html"],
    ["Shopping Guides as Markdown", "/api/export_guides?home=flat&format=markdown"],
  ]);
  // Files to keep are downloaded; the printable pages open beside the app.
  expect(screen.getByRole("link", { name: "Shopping List as CSV" }).hasAttribute("download")).toBe(
    true,
  );
  expect(screen.getByRole("link", { name: "Printable Shopping List" }).getAttribute("target")).toBe(
    "_blank",
  );
});

it("says when there is nothing to buy or consider, and is linked from every page of the Home", async () => {
  stubShopping({ get_shopping: () => ({ shoppingList: [], considering: [] }) });
  renderRoutes("/homes/flat/shopping");
  await screen.findByRole("heading", { name: "Shopping List" });
  expect(after("Shopping List")).toBe(
    "Nothing to buy: no Settled Purchase is waiting to be Fulfilled.",
  );
  expect(after("Considering")).toBe("Nothing under consideration.");
  expect(screen.getByRole("link", { name: "Shopping" }).getAttribute("href")).toBe(
    "/homes/flat/shopping",
  );
});

it("moves an entry to the Shopping List when a Decision change event arrives", async () => {
  let shopping = { shoppingList: [rug], considering: [sofa] };
  stubShopping({ get_shopping: () => shopping });
  renderRoutes("/homes/flat/shopping");
  await screen.findByRole("link", { name: "Low sofa" });
  expect(entriesAfter("Considering")).toHaveLength(1);

  // The Agent Settles the sofa.
  shopping = { shoppingList: [rug, { ...sofa, state: "settled" }], considering: [] };
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "low-sofa",
    }),
  );
  expect(await screen.findByText("Nothing under consideration.")).toBeDefined();
  expect(entriesAfter("Shopping List").map(([, head]) => head)).toEqual([
    "Wool rugA large wool rug under the sofa.",
    "Low sofaLow sofa.",
  ]);
});

it("refetches the Measure-first lines when a Wall is measured", async () => {
  let measureFirst = rug.measureFirst;
  stubShopping({
    get_shopping: () => ({ shoppingList: [{ ...rug, measureFirst }], considering: [] }),
  });
  renderRoutes("/homes/flat/shopping");
  await screen.findByText(/^Living room, Wall 2/);

  measureFirst = rug.measureFirst.slice(1);
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "wall",
      recordSlug: "living-room/wall-2",
    }),
  );
  await vi.waitFor(() => expect(screen.queryByText(/^Living room, Wall 2/)).toBeNull());
  expect(screen.getByText(/^the Home's/)).toBeDefined();
});
