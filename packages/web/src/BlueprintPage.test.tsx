import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Blueprint, Home, Level, RoomDetail } from "./api";
import { printedValues } from "./BlueprintPage";
import { FakeEventSource, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };

const agentPlan: Blueprint = {
  slug: "estate-agent-plan",
  label: "Estate agent plan",
  fileName: "plan.pdf",
  fileType: "pdf",
  pageCount: 3,
  uploadedAt: "2026-09-14T09:00:00Z",
  pages: [
    { page: 1, level: ground, width: 2000, height: 1414, hasText: true },
    { page: 2, width: 2000, height: 1250, hasText: true },
    { page: 3, width: 1414, height: 2000, hasText: false },
  ],
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubViewer(blueprints: () => Blueprint[] = () => [agentPlan]) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms: [], unplacedItems: 0 }),
    list_blueprints: () => ({ blueprints: blueprints() }),
  });
}

function link(name: string): string | null | undefined {
  return screen.queryByRole("link", { name })?.getAttribute("href");
}

it("shows the rendered page fitted to the width, with links to the pages either side", async () => {
  stubViewer();
  renderRoutes("/homes/flat/blueprints/estate-agent-plan/2");
  const image = await screen.findByRole("img", { name: "Page 2 of Estate agent plan" });
  expect(image.getAttribute("src")).toBe(
    "/api/get_blueprint_page?home=flat&blueprint=estate-agent-plan&page=2",
  );
  expect([image.getAttribute("width"), image.getAttribute("height")]).toEqual(["2000", "1250"]);
  expect(screen.getByRole("button", { name: "Fit to width" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Estate agent plan, page 2 of 3",
  );
  expect(link("Previous page (1)")).toBe("/homes/flat/blueprints/estate-agent-plan/1");
  expect(link("Next page (3)")).toBe("/homes/flat/blueprints/estate-agent-plan/3");
});

it("names the page's Level and says whether it has a text layer", async () => {
  stubViewer();
  renderRoutes("/homes/flat/blueprints/estate-agent-plan/1");
  await screen.findByRole("img");
  expect(document.querySelector("dl")?.textContent).toBe(
    "LevelGround (Level 0)" + "Size2000 × 1414 px" + "Text layerYes",
  );
  expect(link("Previous page (0)")).toBeUndefined();
});

it("moves to the next page, and has no next link on the last", async () => {
  stubViewer();
  renderRoutes("/homes/flat/blueprints/estate-agent-plan/2");
  await screen.findByRole("img", { name: "Page 2 of Estate agent plan" });

  fireEvent.click(screen.getByRole("link", { name: "Next page (3)" }));

  expect(await screen.findByRole("img", { name: "Page 3 of Estate agent plan" })).toBeDefined();
  expect(document.querySelector("dl")?.textContent).toBe(
    "Size1414 × 2000 px" + "Text layerNone, so it is read from the image",
  );
  expect(screen.queryByRole("link", { name: /^Next page/ })).toBeNull();
});

it("says when the Blueprint or the page does not exist", async () => {
  stubViewer();
  const { unmount } = renderRoutes("/homes/flat/blueprints/estate-agent-plan/4");
  expect(await screen.findByText("Estate agent plan has no page 4: it has 3 pages.")).toBeDefined();
  unmount();

  renderRoutes("/homes/flat/blueprints/old-plan/1");
  expect(await screen.findByText('This Home has no Blueprint "old-plan".')).toBeDefined();
});

it("shows a newly mapped Level when a Blueprint change event arrives", async () => {
  let plan = agentPlan;
  stubViewer(() => [plan]);
  renderRoutes("/homes/flat/blueprints/estate-agent-plan/2");
  await screen.findByRole("img");
  expect(screen.queryByText("Level")).toBeNull();

  plan = {
    ...plan,
    pages: plan.pages.map((page) => (page.page === 2 ? { ...page, level: ground } : page)),
  };
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "blueprint",
      recordSlug: "estate-agent-plan",
    }),
  );

  expect(await screen.findByText("Ground (Level 0)")).toBeDefined();
});

it("zooms to actual size and steps in and out", async () => {
  stubViewer();
  renderRoutes("/homes/flat/blueprints/estate-agent-plan/2");
  const image = await screen.findByRole("img", { name: "Page 2 of Estate agent plan" });

  fireEvent.click(screen.getByRole("button", { name: "Actual size" }));
  expect(image.style.width).toBe("2000px");
  expect(screen.getByText("100%")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(image.style.width).toBe("3000px");
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(image.style.width).toBe("1500px");
  fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
  expect(image.style.width).toBe("");
});

const onPage = (page: number, mm: number, printed: string) => ({
  mm,
  provenance: "blueprint" as const,
  source: { blueprint: "estate-agent-plan", page, printed },
});

function kitchen(): RoomDetail {
  return {
    slug: "kitchen",
    name: "Kitchen",
    level: ground,
    functions: [],
    outdoor: false,
    ceilingHeight: onPage(2, 2500, "2.50"),
    timesOfUse: [],
    windowless: false,
    walls: [
      {
        slug: "kitchen/wall-1",
        position: 1,
        length: onPage(2, 3620, "3.62"),
        beyond: { kind: "outside" },
      },
      {
        slug: "kitchen/wall-2",
        position: 2,
        length: onPage(1, 2000, "2.00"),
        beyond: { kind: "outside" },
      },
    ],
    windows: [],
    doors: [
      {
        slug: "kitchen-door",
        wall: "kitchen/wall-2",
        to: "room",
        clearWidth: onPage(2, 800, "80"),
        offset: onPage(2, 300, "30"),
        sideA: false,
      },
    ],
    surfaces: [],
    features: [],
    items: [],
    lights: [],
    gaps: [],
  };
}

it("lists beside the page the values recorded from it, read from every Room", async () => {
  stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({
      home: flat,
      levels: [ground],
      rooms: [{ slug: "kitchen", name: "Kitchen", level: "ground" }],
      unplacedItems: 0,
    }),
    list_blueprints: () => ({ blueprints: [agentPlan] }),
    get_room: () => ({ room: kitchen(), decisions: [] }),
  });
  renderRoutes("/homes/flat/blueprints/estate-agent-plan/2");
  await screen.findByText(/Wall 1 length/);
  const aside = screen.getByRole("complementary", { name: "Recorded from this page" });
  expect([...aside.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "Kitchen · Ceiling height2.50 → 2.50 m",
    "Kitchen · Wall 1 length3.62 → 3.62 m",
    "Kitchen · Door in Wall 2 clear width80 → 0.80 m",
  ]);
});

it("finds nothing on a page no value was recorded from", () => {
  expect(printedValues(kitchen(), "estate-agent-plan", 3)).toEqual([]);
  expect(printedValues(kitchen(), "other-plan", 2)).toEqual([]);
});
