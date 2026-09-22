import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionSummary, Home } from "./api";
import { FakeEventSource, renderRoutes, stubApi } from "./testSupport";

const house: Home = {
  slug: "house",
  name: "House",
  country: "Spain",
  city: "Madrid",
  latitude: 40.4,
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  stubApi({ list_homes: () => ({ homes: [house] }) });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("names the Home's sections in the nav and marks the current one", async () => {
  renderRoutes("/homes/house/decisions");
  const nav = screen.getByRole("navigation", { name: "Home" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Overview", "Rooms", "Decisions", "Shopping", "Inventory", "Change log", "About"]);
  expect(within(nav).getByRole("link", { name: "Rooms" }).getAttribute("href")).toBe(
    "/homes/house/rooms",
  );
  expect(within(nav).getByRole("link", { name: "Decisions" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(within(nav).getByRole("link", { name: "Overview" }).hasAttribute("aria-current")).toBe(
    false,
  );
  await screen.findByRole("option", { name: "House" });
  expect(document.title).toBe("Decisions · House · Settle");
});

it("marks Rooms as current on a Room's page", () => {
  renderRoutes("/homes/house/rooms/kitchen");
  const nav = screen.getByRole("navigation", { name: "Home" });
  expect(within(nav).getByRole("link", { name: "Rooms" }).getAttribute("aria-current")).toBe(
    "page",
  );
});

it("shows how the live connection stands", async () => {
  renderRoutes("/homes/house/about");
  expect(screen.getByRole("heading", { name: "About this Home" })).toBeTruthy();
  const source = FakeEventSource.open();
  act(() => source.emit("open"));
  expect(screen.queryByText("Live")).toBeNull();
  act(() => source.emit("error"));
  expect(screen.getByText("Reconnecting")).toBeTruthy();
  source.readyState = 2;
  act(() => source.emit("error"));
  expect(screen.getByText("Updates stopped")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});

it("has a page for a Session", () => {
  renderRoutes("/homes/house/sessions/first-walkthrough");
  expect(screen.getByRole("heading", { name: "Session" })).toBeTruthy();
});

it("counts what wants the user beside Decisions, Shopping and Inventory", async () => {
  const states = ["candidate", "leaning", "leaning", "settled", "rejected"] as const;
  stubApi({
    list_homes: () => ({ homes: [house] }),
    list_decisions: () => ({
      decisions: [
        ...states.map((state) => ({ state }) as DecisionSummary),
        { state: "leaning", archivedAt: "2026-09-01" } as DecisionSummary,
      ],
    }),
    get_shopping: () => ({ shoppingList: [{}, {}] as never, considering: [] }),
    list_items: () => ({ items: [{}, {}, {}, {}] as never }),
  });
  renderRoutes("/homes/house/items");
  const nav = screen.getByRole("navigation", { name: "Home" });
  await within(nav).findByText("4");
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Overview", "Rooms", "Decisions3", "Shopping2", "Inventory4", "Change log", "About"]);
  expect(document.title).toBe("Inventory · House · Settle");
});

it("keys the four states with their marks", () => {
  renderRoutes("/homes/house/about");
  expect(screen.getByText("States").nextElementSibling?.textContent).toBe(
    "CandidateLeaningSettledRejected",
  );
});

it("opens the sidebar as a sheet from the menu button, and closes it on a link", () => {
  expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  renderRoutes("/homes/house/about");
  const menu = screen.getByRole("button", { name: "Menu" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(menu);
  expect(menu.getAttribute("aria-expanded")).toBe("true");
  const sheet = document.getElementById(menu.getAttribute("aria-controls") ?? "");
  expect(sheet?.hasAttribute("data-open")).toBe(true);
  fireEvent.click(within(sheet as HTMLElement).getByRole("link", { name: "Rooms" }));
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(menu);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
});

it("shows only the mark and the theme switch outside a Home", async () => {
  renderRoutes("/");
  await screen.findAllByText("House");
  expect(screen.queryByRole("navigation", { name: "Home" })).toBeNull();
  expect(screen.queryByText("States")).toBeNull();
  expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "settle" }).getAttribute("href")).toBe("/");
});
