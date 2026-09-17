import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Blueprint, Home, Level } from "./api";
import { type ApiHandlers, FakeEventSource, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };
const first: Level = { slug: "first", name: "First", storey: 1 };

const agentPlan: Blueprint = {
  slug: "estate-agent-plan",
  label: "Estate agent plan",
  fileName: "plan.pdf",
  fileType: "pdf",
  pageCount: 3,
  uploadedAt: "2026-09-14T09:00:00Z",
  pages: [
    { page: 1, level: ground, width: 2000, height: 1414, hasText: true },
    { page: 2, level: first, width: 2000, height: 1414, hasText: true },
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

/** The About page's operations, answering with a Home without Blueprints unless told otherwise. */
function stubHomePage(handlers: ApiHandlers) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground, first], rooms: [], unplacedItems: 0 }),
    list_sessions: () => ({ sessions: [] }),
    list_constraints: () => ({ constraints: [] }),
    list_notes: () => ({ notes: [] }),
    list_blueprints: () => ({ blueprints: [] }),
    ...handlers,
  });
}

/** The text of the Blueprint list, or of what shows in its place, below the section's heading. */
function blueprintList(): string {
  const section = screen.getByRole("heading", { name: "Blueprints" }).closest("section");
  return section?.querySelector(":scope > ul, :scope > p")?.textContent ?? "";
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText("Blueprint file (PDF, PNG, or JPEG)"), {
    target: { files: [file] },
  });
}

it("lists each Blueprint with its page count, and names each page's Level when mapped", async () => {
  stubHomePage({ list_blueprints: () => ({ blueprints: [agentPlan] }) });
  renderRoutes("/homes/flat/about");
  await screen.findByText("Estate agent plan");
  expect(blueprintList()).toBe(
    "Estate agent plan, 3 pages" +
      "Page 1: Ground (Level 0)" +
      "Page 2: First (Level 1)" +
      "Page 3",
  );
  expect(screen.getByRole("link", { name: "Page 3" }).getAttribute("href")).toBe(
    "/homes/flat/blueprints/estate-agent-plan/3",
  );
});

it("says when the Home has no Blueprints yet", async () => {
  stubHomePage({});
  renderRoutes("/homes/flat/about");
  expect(await screen.findByText("No Blueprints yet.")).toBeDefined();
});

it.each([
  [
    "an empty PDF",
    "empty.pdf",
    "application/pdf",
    "no_pages",
    "empty.pdf is empty, so it has no pages to show.",
  ],
  [
    "a file of another type",
    "notes.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "unsupported_file",
    "notes.docx is not a PDF, PNG, or JPEG, so it can't be a Blueprint. Save the plan as one of " +
      "those, then upload it.",
  ],
])("shows the server's refusal of %s inline", async (_, name, type, code, message) => {
  stubHomePage({
    upload_blueprint: () => Response.json({ error: { code, message } }, { status: 400 }),
  });
  renderRoutes("/homes/flat/about");
  await screen.findByText("No Blueprints yet.");

  choose(new File(["…"], name, { type }));
  fireEvent.click(screen.getByRole("button", { name: "Upload Blueprint" }));

  expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
  expect(blueprintList()).toBe("No Blueprints yet.");
});

it("posts the file, the Home, and the label as a form, then lists the new Blueprint", async () => {
  let blueprints: Blueprint[] = [];
  const fetch = stubHomePage({
    list_blueprints: () => ({ blueprints }),
    upload_blueprint: () => {
      blueprints = [agentPlan];
      return { blueprint: agentPlan };
    },
  });
  renderRoutes("/homes/flat/about");
  await screen.findByText("No Blueprints yet.");
  const button = screen.getByRole("button", { name: "Upload Blueprint" });
  expect(button).toHaveProperty("disabled", true);

  choose(new File(["%PDF-1.7"], "plan.pdf", { type: "application/pdf" }));
  fireEvent.change(screen.getByLabelText("Label (optional)"), {
    target: { value: " Estate agent plan " },
  });
  fireEvent.click(button);

  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "Uploaded Estate agent plan, 3 pages. Ask the Agent in this Home's Home Folder to read it.",
  );
  await waitFor(() => expect(blueprintList()).toContain("Estate agent plan, 3 pages"));
  const [url, init] = fetch.mock.calls.find(([url]) => url === "/api/upload_blueprint") ?? [];
  expect(url).toBe("/api/upload_blueprint");
  const form = init?.body as FormData;
  expect(form.get("home")).toBe("flat");
  expect((form.get("file") as File).name).toBe("plan.pdf");
  expect(form.get("label")).toBe("Estate agent plan");
  // The form starts afresh for the next Blueprint.
  expect(screen.getByLabelText("Label (optional)")).toHaveProperty("value", "");
  expect(button).toHaveProperty("disabled", true);
});

it("leaves the label out when none is given, so the server names the Blueprint", async () => {
  const fetch = stubHomePage({ upload_blueprint: () => ({ blueprint: agentPlan }) });
  renderRoutes("/homes/flat/about");
  await screen.findByText("No Blueprints yet.");
  choose(new File(["%PDF-1.7"], "plan.pdf", { type: "application/pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Upload Blueprint" }));
  await screen.findByRole("status");
  const [, init] = fetch.mock.calls.find(([url]) => url === "/api/upload_blueprint") ?? [];
  const form = init?.body as FormData;
  expect(form.has("label")).toBe(false);
});

it("re-renders the Blueprint list when a Blueprint change event arrives", async () => {
  let blueprints: Blueprint[] = [];
  stubHomePage({ list_blueprints: () => ({ blueprints }) });
  renderRoutes("/homes/flat/about");
  await screen.findByText("No Blueprints yet.");

  // The Agent maps the third page to the ground Level.
  blueprints = [
    {
      ...agentPlan,
      pages: agentPlan.pages.map((page) => (page.page === 3 ? { ...page, level: ground } : page)),
    },
  ];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "blueprint",
      recordSlug: "estate-agent-plan",
    }),
  );

  expect(await screen.findByText("Estate agent plan")).toBeDefined();
  expect(blueprintList()).toContain("Page 3: Ground (Level 0)");
});
