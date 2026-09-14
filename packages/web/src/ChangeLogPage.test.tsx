import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangeEntry, Home } from "./api";
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

it("shows each change as the server orders it: time, origin, record, field, old, new", async () => {
  // The server answers newest first.
  let changes = [overridden, created];
  const fetch = stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_change_log: () => ({ changes }),
  });
  renderRoutes("/homes/flat/log");
  await screen.findByRole("table");

  expect(inputsTo(fetch, "get_change_log")).toEqual([{ home: "flat" }]);
  expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
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
  expect(await screen.findByText("text: The cat scratches fabric furniture.")).toBeDefined();
  expect(rows()[0]?.[2]).toBe("Note cat");
});

it("says so when nothing has changed yet", async () => {
  stubApi({ list_homes: () => ({ homes: [flat] }), get_change_log: () => ({ changes: [] }) });
  renderRoutes("/homes/flat/log");
  expect(await screen.findByText("No changes yet.")).toBeDefined();
});
