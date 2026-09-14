import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Blueprint, Home, Level } from "./api";
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

it("shows the rendered page at its natural size, with links to the pages either side", async () => {
  stubViewer();
  renderRoutes("/homes/flat/blueprints/estate-agent-plan/2");
  const image = await screen.findByRole("img", { name: "Page 2 of Estate agent plan" });
  expect(image.getAttribute("src")).toBe(
    "/api/get_blueprint_page?home=flat&blueprint=estate-agent-plan&page=2",
  );
  expect([image.getAttribute("width"), image.getAttribute("height")]).toEqual(["2000", "1250"]);
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
