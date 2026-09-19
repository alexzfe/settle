import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangeEntry, DecisionSummary, Home, Session } from "./api";
import { groupByRecord } from "./SessionPage";
import { FakeEventSource, renderRoutes, stubApi } from "./testSupport";

const flat: Home = {
  slug: "flat",
  name: "Flat",
  country: "Spain",
  city: "Madrid",
  latitude: 40.4,
};

const color: Session = {
  slug: "color-6d8j",
  skills: ["color"],
  openedAt: "2026-09-15T19:51:29Z",
  closedAt: "2026-09-15T22:08:51Z",
  summary: {
    changed: "Locked the Palette 'Washi and Sumi'.",
    open: "The lamps.",
    next: "Purchase: the sofa.",
  },
};
const unsummarised: Session = {
  slug: "design-direction-r3r6",
  skills: ["design-direction", "home-intake"],
  openedAt: "2026-09-16T04:25:50Z",
};

const palette: DecisionSummary = {
  slug: "washi-and-sumi",
  kind: "palette",
  title: "Washi and Sumi",
  statement: "A tonal palette.",
  state: "locked",
  createdAt: "2026-09-15T20:01:03Z",
  openFlags: [],
  openConflicts: [],
};

const log: ChangeEntry[] = [
  {
    at: "2026-09-16T05:00:00Z",
    origin: "design-direction-r3r6",
    recordKind: "room",
    record: "living-room",
    field: "ceilingHeight",
    old: { mm: 2400, provenance: "estimated" },
    new: { mm: 2500, provenance: "estimated" },
  },
  {
    at: "2026-09-15T22:08:51Z",
    origin: "color-6d8j",
    recordKind: "session",
    record: "color-6d8j",
    field: "closed_at",
    new: "2026-09-15T22:08:51Z",
  },
  {
    at: "2026-09-15T21:49:26Z",
    origin: "color-6d8j",
    recordKind: "decision",
    record: "washi-and-sumi",
    field: "state",
    old: "leaning",
    new: "locked",
    reason: 'User: "lock the palette"',
  },
  {
    at: "2026-09-15T21:30:00Z",
    origin: "color-6d8j",
    recordKind: "wall",
    record: "living-room/wall-5",
    field: "length",
    old: { mm: 3700, provenance: "estimated" },
    new: { mm: 3620, provenance: "measured" },
  },
  {
    at: "2026-09-15T21:19:10Z",
    origin: "color-6d8j",
    recordKind: "decision",
    record: "washi-and-sumi",
    field: "state",
    old: "candidate",
    new: "leaning",
  },
  {
    at: "2026-09-15T19:51:29Z",
    origin: "color-6d8j",
    recordKind: "session",
    record: "color-6d8j",
    new: { skills: ["color"] },
  },
];

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubSession() {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({
      home: flat,
      levels: [{ slug: "ground", name: "Ground", storey: 0 }],
      rooms: [{ slug: "living-room", name: "Living room", level: "ground" }],
      unplacedItems: 0,
    }),
    list_decisions: () => ({ decisions: [palette] }),
    list_sessions: () => ({ sessions: [unsummarised, color] }),
    get_change_log: () => ({ changes: log }),
  });
}

it("shows the Session's Skills, times, and the summary the Agent wrote", async () => {
  stubSession();
  renderRoutes("/homes/flat/sessions/color-6d8j");
  expect(await screen.findByRole("heading", { name: "Color Session", level: 1 })).toBeDefined();
  expect(screen.getByText(/^Skill: Color/).textContent).toBe(
    `Skill: Color · ${new Date(color.openedAt).toLocaleString()} – ${new Date(
      color.closedAt ?? "",
    ).toLocaleString()}`,
  );
  expect(screen.getByText(/Written by the Agent/).textContent).toMatch(
    /^Written by the Agent · Session summary · 1[56] Sep$/,
  );
  const summary = screen.getByText("Changed").closest("dl");
  expect(summary?.textContent).toBe(
    "ChangedLocked the Palette 'Washi and Sumi'." +
      "Still openThe lamps." +
      "NextPurchase: the sofa.",
  );
  expect(screen.getByRole("button", { name: /Start the next Session/ })).toBeDefined();
});

it("reads the Session's changes as sentences grouped by record, oldest first", async () => {
  stubSession();
  renderRoutes("/homes/flat/sessions/color-6d8j");
  const changes = await screen.findByRole("heading", { name: "Changes" });
  const section = within(changes.closest("section") as HTMLElement);
  await section.findByText("Washi and Sumi");
  const records = [...(changes.closest("section")?.querySelectorAll("ul > li") ?? [])]
    .filter((li) => li.parentElement?.parentElement?.tagName === "SECTION")
    .map((li) => li.textContent);
  expect(records).toEqual([
    'Washi and Sumi○Candidate → ◐Leaning◐Leaning → ●LockedUser: "lock the palette"',
    "Living room · Wall 5 length ~3.70 → 3.62 m (Measured)",
  ]);
  expect(section.getByRole("link", { name: "Washi and Sumi" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/washi-and-sumi",
  );
  // Another Session's changes are not here.
  expect(section.queryByText(/ceiling height/)).toBeNull();

  // The raw rows stay behind a toggle.
  expect(section.queryByRole("table")).toBeNull();
  fireEvent.click(section.getByRole("button", { name: "Show every field" }));
  expect(section.getAllByRole("row")).toHaveLength(6);
});

it("says when a Session has no summary", async () => {
  stubSession();
  renderRoutes("/homes/flat/sessions/design-direction-r3r6");
  expect(
    await screen.findByRole("heading", { name: "Design Direction and Home Intake Session" }),
  ).toBeDefined();
  expect(screen.getByText("In progress or left without a summary.")).toBeDefined();
  expect(await screen.findByText("ceiling height ~2.40 → ~2.50 m (Estimated)")).toBeDefined();
});

it("says when the Home has no such Session", async () => {
  stubSession();
  renderRoutes("/homes/flat/sessions/nope");
  expect(await screen.findByText('This Home has no Session "nope".')).toBeDefined();
});

it("groups by record in the order records were first changed, leaving out the Session's own", () => {
  const groups = groupByRecord(log.filter((change) => change.origin === "color-6d8j"));
  expect(groups.map((group) => group.map((change) => change.at))).toEqual([
    ["2026-09-15T21:19:10Z", "2026-09-15T21:49:26Z"],
    ["2026-09-15T21:30:00Z"],
  ]);
});
