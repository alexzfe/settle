import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangeEntry, Home, Session } from "./api";
import { FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };

const created: ChangeEntry = {
  at: "2026-09-13T10:00:00Z",
  origin: "web",
  recordKind: "home",
  record: "flat",
  new: { name: "Flat", city: "Madrid" },
};
const overridden: ChangeEntry = {
  at: "2026-09-13T11:00:00Z",
  origin: "home-intake-k3pz",
  recordKind: "wall",
  record: "living-room/wall-2",
  field: "length",
  old: { mm: 3620, provenance: "measured" },
  new: { mm: 3500, provenance: "estimated" },
  reason: '"The old measurement was wrong, use 3.5"',
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function rows(): string[][] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? ""));
}

const intake: Session = {
  slug: "home-intake-k3pz",
  skills: ["home-intake"],
  openedAt: "2026-09-13T10:30:00Z",
  closedAt: "2026-09-13T11:30:00Z",
  summary: { changed: "Measured the living room.", open: "Nothing", next: "Color" },
};

function stubLog(changes: () => ChangeEntry[]) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({
      home: flat,
      levels: [{ slug: "ground", name: "Ground", storey: 0 }],
      rooms: [{ slug: "living-room", name: "Living room", level: "ground" }],
      unplacedItems: 0,
    }),
    list_decisions: () => ({ decisions: [] }),
    list_sessions: () => ({ sessions: [intake] }),
    get_change_log: () => ({ changes: changes() }),
  });
}

/** The timeline's groups: each heading, then its sentences. */
function timeline(): string[][] {
  const list = screen.getByRole("list", { name: "Changes by Session" }) as HTMLElement;
  return [...list.querySelectorAll(":scope > li")].map((group) => [
    group.querySelector("h2")?.textContent ?? "",
    ...[...group.querySelectorAll("ul > li")].map((li) => li.textContent ?? ""),
  ]);
}

it("reads the log as sentences grouped by Session, newest first, with a link to each Session", async () => {
  let changes = [overridden, created];
  const fetch = stubLog(() => changes);
  renderRoutes("/homes/flat/log");
  await screen.findByText(/length/);

  expect(inputsTo(fetch, "get_change_log")).toEqual([{ home: "flat" }]);
  expect(screen.getByText("Only the newest 200 changes are loaded.")).toBeDefined();
  expect(timeline()).toEqual([
    [
      "Home Intake Session",
      `Living room · Wall 2 length 3.62 → ~3.50 m (Estimated) · "The old measurement was wrong, use 3.5"`,
    ],
    ["Web UI", "Flat added"],
  ]);
  expect(screen.getByRole("link", { name: "Home Intake Session" }).getAttribute("href")).toBe(
    "/homes/flat/sessions/home-intake-k3pz",
  );
  expect(screen.getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );

  // Every write adds to the log, so any change event refetches it.
  changes = [
    {
      at: "2026-09-13T12:00:00Z",
      origin: "home-intake-k3pz",
      recordKind: "note",
      record: "cat",
      new: { text: "The cat scratches fabric furniture." },
    },
    ...changes,
  ];
  act(() =>
    FakeEventSource.open().emit("change", { home: "flat", recordKind: "note", recordSlug: "cat" }),
  );
  expect(await screen.findByText("Cat")).toBeDefined();
  expect(timeline()[0]?.[1]).toBe("Cat added");
});

it("shows a Session's first few changes and links the rest, and a Decision's state as pills", async () => {
  const measured = (record: string, at: string): ChangeEntry => ({
    at,
    origin: "home-intake-k3pz",
    recordKind: "wall",
    record,
    field: "length",
    new: { mm: 3000, provenance: "measured" },
  });
  stubLog(() => [
    {
      at: "2026-09-13T11:10:00Z",
      origin: "home-intake-k3pz",
      recordKind: "decision",
      record: "low-sofa",
      field: "state",
      old: "candidate",
      new: "leaning",
      reason: "User: I like the low one.",
    },
    measured("living-room/wall-1", "2026-09-13T11:03:00Z"),
    measured("living-room/wall-2", "2026-09-13T11:02:00Z"),
    measured("living-room/wall-3", "2026-09-13T11:01:00Z"),
  ]);
  renderRoutes("/homes/flat/log");
  await screen.findByText("+1 more");
  const group = timeline()[0];
  expect(group?.[1]).toBe("Low sofa ○Candidate → ◐LeaningUser: I like the low one.");
  expect(screen.getByRole("blockquote")).toBeDefined();
  expect(group?.slice(2)).toEqual([
    "Living room · Wall 1 length set to 3.00 m (Measured)",
    "Living room · Wall 2 length set to 3.00 m (Measured)",
  ]);
  expect(screen.getByRole("link", { name: "+1 more" }).getAttribute("href")).toBe(
    "/homes/flat/sessions/home-intake-k3pz",
  );
});

it("keeps every field of every change behind a toggle", async () => {
  stubLog(() => [overridden, created]);
  renderRoutes("/homes/flat/log");
  await screen.findByText(/length/);
  expect(screen.queryByRole("table")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Show every field" }));
  const table = within(screen.getByRole("table"));
  expect(table.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
    "Time",
    "Origin",
    "Record",
    "Field",
    "Old",
    "New",
    "Reason",
  ]);
  expect(rows()).toEqual([
    [
      new Date(overridden.at).toLocaleString(),
      "home-intake-k3pz",
      "Wall living-room/wall-2",
      "length",
      "3.62 m (Measured)",
      "~3.50 m (Estimated)",
      '"The old measurement was wrong, use 3.5"',
    ],
    [
      new Date(created.at).toLocaleString(),
      "Web UI",
      "Home flat",
      "created",
      "",
      "name: Flat; city: Madrid",
      "",
    ],
  ]);
});

it("says so when nothing has changed yet", async () => {
  stubApi({ list_homes: () => ({ homes: [flat] }), get_change_log: () => ({ changes: [] }) });
  renderRoutes("/homes/flat/log");
  expect(await screen.findByText("No changes yet.")).toBeDefined();
});
