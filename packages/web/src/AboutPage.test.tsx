import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Constraint, Home, Level, Note } from "./api";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The About page's operations, answering with an empty Home unless `handlers` says otherwise. */
function stubAboutPage(handlers: ApiHandlers) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms: [], unplacedItems: 0 }),
    list_constraints: () => ({ constraints: [] }),
    list_notes: () => ({ notes: [] }),
    list_blueprints: () => ({ blueprints: [] }),
    ...handlers,
  });
}

/** The list in the section titled `title`. */
function listIn(title: string): Element | null | undefined {
  return screen.getByRole("heading", { name: title }).closest("section")?.querySelector("ul");
}

it("shows only the Home facts that are recorded, marking what is not Measured", async () => {
  const described: Home = {
    ...flat,
    tenure: "rented",
    plannedStay: "1-3-years",
    buildingType: "apartment",
    buildingEra: "1960s block",
    lift: true,
    liftDoorWidth: { mm: 800, provenance: "measured" },
    liftCarDepth: { mm: 1400, provenance: "estimated" },
    accessWidth: { mm: 760, provenance: "measured" },
    accessNote: "turn in the communal stair",
  };
  stubAboutPage({
    get_home: () => ({ home: described, levels: [ground], rooms: [], unplacedItems: 0 }),
  });
  renderRoutes("/homes/flat/about");
  await screen.findByText("Rented");
  const facts = [...(document.querySelector("dl")?.children ?? [])].map((each) => each.textContent);
  expect(facts).toEqual([
    "City",
    "Madrid",
    "Country",
    "Spain",
    "Latitude",
    "40.4°",
    "Tenure",
    "Rented",
    "Planned stay",
    "1–3 years",
    "Building type",
    "Apartment",
    "Building era",
    "1960s block",
    "Lift",
    "Yes",
    "Lift door width",
    "0.80 m",
    "Lift car depth",
    "~1.40 m estimate",
    "Narrowest access point",
    "0.76 m, turn in the communal stair",
  ]);
});

it("leaves out the Home facts that are not recorded, and says when there is no lift", async () => {
  stubAboutPage({
    get_home: () => ({
      home: { ...flat, lift: false },
      levels: [ground],
      rooms: [],
      unplacedItems: 0,
    }),
  });
  renderRoutes("/homes/flat/about");
  await screen.findByText("Madrid");
  expect(screen.queryByText("Tenure")).toBeNull();
  expect(screen.queryByText("Lift door width")).toBeNull();
  expect(screen.getByText("Lift").nextElementSibling?.textContent).toBe("None");
});

it("links the Unplaced Item count to the Items list", async () => {
  stubAboutPage({
    get_home: () => ({ home: flat, levels: [ground], rooms: [], unplacedItems: 2 }),
  });
  renderRoutes("/homes/flat/about");
  const link = await screen.findByRole("link", { name: "2 Unplaced Items" });
  expect(link.getAttribute("href")).toBe("/homes/flat/items");
});

it("shows the Constraints in force, and the Archived ones on request", async () => {
  const drilling: Constraint = { slug: "no-drilling", text: "Rented: no drilling." };
  const painting: Constraint = {
    slug: "no-painting",
    text: "Rented: no painting.",
    archivedAt: "2026-09-10T09:00:00Z",
    archivedReason: "the landlord agreed to paint",
  };
  const fetch = stubAboutPage({
    list_constraints: (input) => ({
      constraints: input.archived ? [drilling, painting] : [drilling],
    }),
  });
  renderRoutes("/homes/flat/about");
  await screen.findByText("Rented: no drilling.");
  expect(screen.queryByText(/Rented: no painting\./)).toBeNull();

  fireEvent.click(screen.getByLabelText("Show archived Constraints"));

  const archived = await screen.findByText(/Rented: no painting\./);
  expect(archived.textContent).toContain("the landlord agreed to paint");
  expect(fetch.mock.calls.filter(([url]) => url === "/api/list_constraints")).toHaveLength(2);
});

it("refetches the Constraints when a Constraint change event arrives", async () => {
  let constraints: Constraint[] = [];
  stubAboutPage({ list_constraints: () => ({ constraints }) });
  renderRoutes("/homes/flat/about");
  await screen.findByText("No Constraints in force.");

  constraints = [{ slug: "two-cats", text: "Two cats." }];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "constraint",
      recordSlug: "two-cats",
    }),
  );
  expect(await screen.findByText("Two cats.")).toBeDefined();
});

it("shows the Notes, newest first", async () => {
  const notes: Note[] = [
    { slug: "dog", text: "We might get a dog.", createdAt: "2026-09-01T10:00:00Z" },
    { slug: "cat", text: "The cat scratches fabric.", createdAt: "2026-09-12T10:00:00Z" },
  ];
  stubAboutPage({ list_notes: () => ({ notes }) });
  renderRoutes("/homes/flat/about");
  await screen.findByText(/We might get a dog/);
  expect(
    [...(listIn("Notes")?.querySelectorAll("li") ?? [])].map((li) => li.firstChild?.textContent),
  ).toEqual(["The cat scratches fabric.", "We might get a dog."]);
});

it("sets up the Home Folder and says which files it wrote", async () => {
  let home = flat;
  const fetch = stubAboutPage({
    get_home: () => ({ home, levels: [ground], rooms: [], unplacedItems: 0 }),
    set_up_home_folder: (input) => {
      home = { ...flat, homeFolderPath: input.path };
      return { path: input.path, files: ["CLAUDE.md", ".mcp.json"] };
    },
  });
  renderRoutes("/homes/flat/about");
  expect(await screen.findByText("Not set up yet.")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Path"), { target: { value: " ~/Homes/our-flat " } });
  fireEvent.click(screen.getByRole("button", { name: "Set up Home Folder" }));

  expect(await screen.findByText("CLAUDE.md")).toBeDefined();
  expect(inputsTo(fetch, "set_up_home_folder")).toEqual([
    { home: "flat", path: "~/Homes/our-flat" },
  ]);
  await waitFor(() => expect(screen.getByText(/Set up at/).textContent).toContain("our-flat"));
});
