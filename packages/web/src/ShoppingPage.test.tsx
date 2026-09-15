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
const lamp = entry("reading-lamp", "Reading lamp", { requirements: { must: 1, prefer: 0 } });
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

/** Each entry of the list after `heading`, as the text of its lines. */
function entriesAfter(heading: string): string[][] {
  const list = screen.getByRole("heading", { name: heading }).nextElementSibling;
  return [...(list?.querySelectorAll(":scope > li") ?? [])].map((li) =>
    [...li.querySelectorAll("p, li")].map((line) => line.textContent ?? ""),
  );
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
      "Wool rug, Living room, Flagged",
      "A large wool rug under the sofa.",
      "2 musts, 1 prefer; Guides written, Full Guide out of date; 2 Listings",
      "Measure first: living-room/wall-2 length (~3.60 m)",
      "Measure first: the Home's narrowest access width (not recorded)",
    ],
    [
      "Reading lamp, Home-wide",
      "Reading lamp.",
      "1 must, 0 prefers; no Guides yet; no Listings yet",
    ],
  ]);
  // Considering names each one's state.
  expect(entriesAfter("Considering")).toEqual([
    ["Low sofa, Living room, Leaning", "Low sofa.", "1 must, 2 prefers; Guides written; 1 Listing"],
    [
      "Desk chair, Home-wide, Candidate",
      "Desk chair.",
      "No Requirements yet; no Guides yet; no Listings yet",
    ],
  ]);

  const wool = entryOf("Wool rug");
  expect(within(wool).getByRole("link", { name: "Wool rug" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/wool-rug",
  );
  expect(within(wool).getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );
  expect(within(wool).getByText(/^Measure first: living-room/).tagName).toBe("STRONG");
  expect(within(wool).getByText("Full Guide out of date").tagName).toBe("STRONG");
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
  expect(
    screen.getByRole("heading", { name: "Shopping List" }).nextElementSibling?.textContent,
  ).toBe("Nothing to buy: no Locked Purchase is waiting to be Fulfilled.");
  expect(screen.getByRole("heading", { name: "Considering" }).nextElementSibling?.textContent).toBe(
    "Nothing under consideration.",
  );
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
  expect(entriesAfter("Shopping List").map(([title]) => title)).toEqual([
    "Wool rug, Living room, Flagged",
    "Low sofa, Living room",
  ]);
});

it("refetches the Measure-first lines when a Wall is measured", async () => {
  let measureFirst = rug.measureFirst;
  stubShopping({
    get_shopping: () => ({ shoppingList: [{ ...rug, measureFirst }], considering: [] }),
  });
  renderRoutes("/homes/flat/shopping");
  await screen.findByText(/^Measure first: living-room/);

  measureFirst = rug.measureFirst.slice(1);
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "wall",
      recordSlug: "living-room/wall-2",
    }),
  );
  await vi.waitFor(() => expect(screen.queryByText(/^Measure first: living-room/)).toBeNull());
  expect(screen.getByText(/^Measure first: the Home's/)).toBeDefined();
});
