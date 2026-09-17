import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Home } from "./api";
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
  ).toEqual(["Overview", "Rooms", "Decisions", "Shopping", "Items", "Change log", "About"]);
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
  expect(document.title).toBe("Decisions · House · Interior Design Harness");
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
  expect(screen.getByText("Connecting")).toBeTruthy();
  act(() => source.emit("open"));
  expect(screen.getByText("Live")).toBeTruthy();
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
