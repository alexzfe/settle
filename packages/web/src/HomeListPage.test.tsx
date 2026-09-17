import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Home } from "./api";
import { renderRoutes, stubApi } from "./testSupport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };

it("shows each Home as a card with its city and Room count", async () => {
  stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({
      home: flat,
      levels: [{ slug: "ground", name: "Ground", storey: 0 }],
      rooms: [
        { slug: "kitchen", name: "Kitchen", level: "ground" },
        { slug: "hallway", name: "Hallway", level: "ground" },
      ],
      unplacedItems: 0,
    }),
  });
  renderRoutes("/");
  const card = (await screen.findByRole("link", { name: "Flat" })).closest("li") as HTMLElement;
  expect(card.querySelector("a")?.getAttribute("href")).toBe("/homes/flat");
  expect(within(card).getByText("Madrid, Spain")).toBeDefined();
  await waitFor(() => expect(within(card).getByText("2 Rooms")).toBeDefined());
});

it("says when there are no Homes yet", async () => {
  stubApi({ list_homes: () => ({ homes: [] }) });
  renderRoutes("/");
  expect(await screen.findByText("No Homes yet.")).toBeDefined();
  expect(screen.getByRole("button", { name: "Create Home" })).toBeDefined();
});
