import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Home, Level, Room, Session } from "./api";
import { FakeEventSource, renderRoutes, stubApi } from "./testSupport";

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

it("re-renders the Room list when a Room change event arrives", async () => {
  let rooms: Room[] = [{ slug: "kitchen", name: "Kitchen", level: "ground" }];
  stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms }),
    list_sessions: () => ({ sessions: [] }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText("Kitchen");
  expect(screen.queryByText("Living room")).toBeNull();

  const events = FakeEventSource.open();
  expect(events.url).toBe("/events?home=flat");
  rooms = [...rooms, { slug: "living-room", name: "Living room", level: "ground" }];
  act(() => events.emit("change", { home: "flat", recordKind: "room", recordSlug: "living-room" }));

  expect(await screen.findByText("Living room")).toBeDefined();
});

it("refetches only the Sessions list when a Session change event arrives", async () => {
  const opened: Session = { slug: "s1", skills: ["home-intake"], openedAt: "2026-09-13T10:00:00Z" };
  let sessions: Session[] = [opened];
  const fetch = stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms: [] }),
    list_sessions: () => ({ sessions }),
  });
  renderRoutes("/homes/flat");
  await screen.findByText(/unsummarised/);
  const homeFetches = fetch.mock.calls.filter(([url]) => url === "/api/get_home").length;

  sessions = [
    {
      ...opened,
      closedAt: "2026-09-13T10:30:00Z",
      summary: { changed: "Added the Kitchen.", open: "Its size.", next: "home-intake" },
    },
  ];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "session",
      recordSlug: "s1",
    }),
  );

  expect(await screen.findByText("Added the Kitchen.")).toBeDefined();
  expect(fetch.mock.calls.filter(([url]) => url === "/api/get_home")).toHaveLength(homeFetches);
});
