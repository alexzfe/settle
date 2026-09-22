import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FindRow, Home } from "../api";
import { FakeEventSource, inputsTo, renderRoutes, stubApi } from "../testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Peru", city: "Lima", latitude: -12 };

function row(kind: FindRow["kind"], name: string, extra: Partial<FindRow> = {}): FindRow {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  const tier2 = kind === "listing" || kind === "feature";
  return {
    kind,
    slug,
    name,
    where: "",
    path: `/homes/flat/${kind}s/${slug}`,
    tier: tier2 ? 2 : 1,
    label: kind.charAt(0).toUpperCase() + kind.slice(1),
    retired: false,
    changedAt: "2026-09-10T10:00:00Z",
    ...extra,
  };
}

const bedFrame = row("decision", "Main bedroom bed frame", {
  where: "Main bedroom",
  path: "/homes/flat/decisions/main-bedroom-bed-frame",
  also: { label: "Quick Guide", path: "/homes/flat/decisions/main-bedroom-bed-frame#quick-guide" },
});

const index: FindRow[] = [
  row("room", "Main bedroom"),
  row("room", "Baño"),
  row("room", "Living room"),
  row("item", "Bedside lamp", { where: "Main bedroom", path: "/homes/flat/items" }),
  bedFrame,
  row("listing", "Oak bed frame 160", { where: "Main bedroom › Main bedroom bed frame" }),
  row("decision", "Keep the old bed", {
    where: "Main bedroom",
    state: "Rejected",
    retired: true,
    changedAt: "2026-09-20T10:00:00Z",
  }),
];

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(rows: FindRow[] = index) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [], rooms: [], unplacedItems: 0 }),
    find_index: () => rows,
  });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Find in this Home" });
}

function field(): HTMLInputElement {
  return within(dialog()).getByRole("combobox", { name: "Find" });
}

function type(text: string) {
  fireEvent.change(field(), { target: { value: text } });
}

function press(key: string) {
  fireEvent.keyDown(field(), { key });
}

/** The results' own names, top to bottom. */
function names(): string[] {
  return [...dialog().querySelectorAll("li")].map(
    (li) => li.querySelector("a span")?.textContent ?? "",
  );
}

/** The row for `name`. */
function result(name: string): HTMLElement {
  const li = [...dialog().querySelectorAll("li")].find(
    (each) => each.querySelector("a span")?.textContent === name,
  );
  if (!li) throw new Error(`No result named ${name}.`);
  return li as HTMLElement;
}

/** The element the keyboard is on, as the field names it. */
function active(): HTMLElement | null {
  const id = field().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

async function openFromHomePage() {
  const view = renderRoutes("/homes/flat");
  // The Overview's own box went with Q20; the sidebar's Find row is the way in.
  fireEvent.click(await screen.findByRole("button", { name: "Find in this Home" }));
  await waitFor(() => expect(within(dialog()).queryByText("Loading…")).toBeNull());
  return view;
}

it("opens from the sidebar's Find row and lists the Rooms before anything is typed", async () => {
  const fetch = stub();
  await openFromHomePage();
  expect(names()).toEqual(["Main bedroom", "Baño", "Living room"]);
  expect(document.activeElement).toBe(field());
  // The index is fetched once, not per keystroke.
  type("b");
  type("be");
  type("bed");
  expect(inputsTo(fetch, "find_index")).toEqual([{ home: "flat" }]);
});

it("ranks the bed frame first for 'bed fra', with its Quick Guide beside it", async () => {
  stub();
  await openFromHomePage();
  type("bed fra");
  expect(names()).toEqual(["Main bedroom bed frame", "Oak bed frame 160"]);
  const top = result("Main bedroom bed frame");
  expect(within(top).getByText("Decision")).toBeTruthy();
  expect(within(top).getByText("Main bedroom")).toBeTruthy();
  const guide = within(top).getByRole("link", { name: "Quick Guide: Main bedroom bed frame" });
  expect(guide.getAttribute("href")).toBe(
    "/homes/flat/decisions/main-bedroom-bed-frame#quick-guide",
  );
  // The row's own link is a separate target from the side link.
  const own = within(top).getAllByRole("link")[0] as HTMLElement;
  expect(own.getAttribute("href")).toBe("/homes/flat/decisions/main-bedroom-bed-frame");
  expect(own.contains(guide)).toBe(false);
});

it("ignores word order and folds accents", async () => {
  stub();
  await openFromHomePage();
  type("fra bed");
  expect(names()[0]).toBe("Main bedroom bed frame");
  type("bano");
  expect(names()).toEqual(["Baño"]);
});

it("sorts a Rejected Decision last and greys it with its state", async () => {
  stub();
  await openFromHomePage();
  type("bed");
  expect(names().at(-1)).toBe("Keep the old bed");
  const rejected = result("Keep the old bed");
  expect(rejected.className).toMatch(/retired/);
  expect(within(rejected).getByText("Rejected")).toBeTruthy();
  expect(result("Bedside lamp").className).not.toMatch(/retired/);
});

it("shows eight results, then a line that expands to the rest", async () => {
  stub(Array.from({ length: 12 }, (_, at) => row("item", `Lamp ${at + 1}`)));
  await openFromHomePage();
  type("lamp");
  expect(names()).toHaveLength(8);
  fireEvent.click(within(dialog()).getByRole("button", { name: "4 more" }));
  expect(names()).toHaveLength(12);
  expect(within(dialog()).queryByRole("button", { name: /more/ })).toBeNull();
  // A new query starts capped again.
  type("lam");
  expect(names()).toHaveLength(8);
});

it("walks past the eighth row with the arrow keys, expanding the list", async () => {
  stub(Array.from({ length: 10 }, (_, at) => row("item", `Lamp ${at + 1}`)));
  await openFromHomePage();
  type("lamp");
  for (let at = 0; at < 8; at++) press("ArrowDown");
  expect(names()).toHaveLength(10);
  expect(active()?.textContent).toMatch(/^Lamp/);
});

it("closes on Escape, staying on the page", async () => {
  stub();
  const { router } = await openFromHomePage();
  press("Escape");
  await act(async () => {});
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(router.state.location.pathname).toBe("/homes/flat");
});

it("closes on the browser's back button without leaving the page", async () => {
  stub();
  const { router } = await openFromHomePage();
  await act(() => router.navigate(-1));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(router.state.location.pathname).toBe("/homes/flat");
  expect(screen.getByRole("heading", { name: "Flat" })).toBeTruthy();
});

it("opens with Enter the row the arrows are on, and back returns to the page before", async () => {
  stub();
  const { router } = await openFromHomePage();
  type("bed fra");
  press("ArrowDown");
  expect(active()?.textContent).toMatch(/^Oak bed frame 160/);
  press("ArrowUp");
  press("Enter");
  await act(async () => {});
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(router.state.location.pathname).toBe("/homes/flat/decisions/main-bedroom-bed-frame");
  await act(() => router.navigate(-1));
  expect(router.state.location.pathname).toBe("/homes/flat");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("moves to the side link with Right, and Enter there opens the Quick Guide", async () => {
  stub();
  const { router } = await openFromHomePage();
  type("bed fra");
  press("ArrowRight");
  expect(active()?.getAttribute("aria-label")).toBe("Quick Guide: Main bedroom bed frame");
  press("ArrowLeft");
  expect(active()?.getAttribute("href")).toBe("/homes/flat/decisions/main-bedroom-bed-frame");
  press("ArrowRight");
  press("Enter");
  await act(async () => {});
  expect(router.state.location.pathname).toBe("/homes/flat/decisions/main-bedroom-bed-frame");
  expect(router.state.location.hash).toBe("#quick-guide");
});

it("does nothing on Right for a row without a side link", async () => {
  stub();
  await openFromHomePage();
  type("oak");
  press("ArrowRight");
  expect(active()?.getAttribute("href")).toBe("/homes/flat/listings/oak-bed-frame-160");
});

it("opens with / and Ctrl-K on any page of the Home, and from the Find row", async () => {
  stub();
  const { router } = renderRoutes("/homes/flat/decisions/main-bedroom-bed-frame");
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  expect(dialog()).toBeTruthy();
  press("Escape");
  await act(async () => {});
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(document.body, { key: "/" });
  expect(dialog()).toBeTruthy();
  press("Escape");
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button", { name: "Find in this Home" })[0] as HTMLElement);
  expect(dialog()).toBeTruthy();
  expect(router.state.location.pathname).toBe("/homes/flat/decisions/main-bedroom-bed-frame");
});

it("ignores / while the user types in a field", () => {
  stub();
  renderRoutes("/homes/flat/about");
  const other = document.createElement("input");
  document.body.append(other);
  fireEvent.keyDown(other, { key: "/" });
  expect(screen.queryByRole("dialog")).toBeNull();
  other.remove();
});

it("is not offered outside a Home", async () => {
  stub();
  renderRoutes("/");
  await screen.findAllByText("Flat");
  expect(screen.queryByRole("button", { name: "Find in this Home" })).toBeNull();
  fireEvent.keyDown(document.body, { key: "/" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
