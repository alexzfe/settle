import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Home, ShoppingEntry } from "./api";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const livingRoom = { slug: "living-room", name: "Living room" };

function entry(slug: string, title: string, rest: Partial<ShoppingEntry> = {}): ShoppingEntry {
  return {
    slug,
    title,
    statement: `${title}.`,
    state: "locked",
    requirements: { must: 0, prefer: 0 },
    hasGuides: false,
    fullGuideOutOfDate: false,
    listings: 0,
    measureFirst: [],
    openFlags: 0,
    ...rest,
  };
}

/** A Locked rug with everything so far, and a Home-wide lamp with nothing yet. */
const rug = entry("wool-rug", "Wool rug", {
  statement: "A large wool rug under the sofa.",
  room: livingRoom,
  requirements: { must: 2, prefer: 1 },
  hasGuides: true,
  fullGuideOutOfDate: true,
  listings: 2,
  measureFirst: [
    "Measure first: living-room/wall-2 length (~3.60 m)",
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
 * Each row of the checklist under `heading`: its title, statement, and what it has so far, then
 * its Room, Measure first, flag, Listings, and Quick Guide link.
 */
function entriesAfter(heading: string): string[][] {
  const list = sectionOf(heading).querySelector("ul");
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) =>
    [...li.children]
      .slice(1)
      .flatMap((cell, index) =>
        index === 0
          ? [...cell.querySelectorAll("p")].map((line) => line.textContent ?? "")
          : [cell.textContent ?? ""],
      ),
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
      "Wool rug",
      "A large wool rug under the sofa.",
      "2 musts, 1 prefer; Guides written, Full Guide out of date",
      "Living room",
      // Several things to measure: a count, opening to the list.
      "Measure first: 2 things" +
        "living-room/wall-2 length (~3.60 m)" +
        "the Home's narrowest access width (not recorded)",
      "⚑ Flagged",
      "2 Listings",
      "Quick Guide",
    ],
    [
      "Reading lamp",
      "Reading lamp.",
      "1 must, 0 prefers; no Guides yet",
      "Home-wide",
      // One thing to measure: the phrase itself.
      "Measure first: the desk height (not recorded)",
      "",
      "No Listings yet",
      "",
    ],
  ]);
  // Considering names each one's state.
  expect(entriesAfter("Considering")).toEqual([
    [
      "Low sofa◐Leaning",
      "Low sofa.",
      "1 must, 2 prefers; Guides written",
      "Living room",
      "",
      "",
      "1 Listing",
      "Quick Guide",
    ],
    [
      "Desk chair○Candidate",
      "Desk chair.",
      "No Requirements yet; no Guides yet",
      "Home-wide",
      "",
      "",
      "No Listings yet",
      "",
    ],
  ]);

  const wool = entryOf("Wool rug");
  expect(within(wool).getByRole("link", { name: "Wool rug" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/wool-rug",
  );
  expect(within(wool).getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );
  expect(within(wool).getByText(/^living-room\/wall-2/).tagName).toBe("STRONG");
  expect(within(wool).getByText("Full Guide out of date").tagName).toBe("STRONG");
  expect(within(wool).getByRole("link", { name: "Quick Guide" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/wool-rug#quick-guide",
  );
  expect(screen.getByRole("link", { name: "Desk chair" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/desk-chair",
  );
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
    "Nothing to buy: no Locked Purchase is waiting to be Fulfilled.",
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

  // The Agent Locks the sofa.
  shopping = { shoppingList: [rug, { ...sofa, state: "locked" }], considering: [] };
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "low-sofa",
    }),
  );
  expect(await screen.findByText("Nothing under consideration.")).toBeDefined();
  expect(entriesAfter("Shopping List").map(([title]) => title)).toEqual(["Wool rug", "Low sofa"]);
});

it("refetches the Measure-first lines when a Wall is measured", async () => {
  let measureFirst = rug.measureFirst;
  stubShopping({
    get_shopping: () => ({ shoppingList: [{ ...rug, measureFirst }], considering: [] }),
  });
  renderRoutes("/homes/flat/shopping");
  await screen.findByText(/^living-room\/wall-2/);

  measureFirst = rug.measureFirst.slice(1);
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "wall",
      recordSlug: "living-room/wall-2",
    }),
  );
  await vi.waitFor(() => expect(screen.queryByText(/^living-room\/wall-2/)).toBeNull());
  expect(screen.getByText(/^the Home's/)).toBeDefined();
});
