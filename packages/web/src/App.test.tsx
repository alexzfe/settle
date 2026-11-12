import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type DecisionSummary, type Home, login } from "./api";
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
  vi.restoreAllMocks();
});

it("names the Home's sections in the nav and marks the current one", async () => {
  renderRoutes("/homes/house/decisions");
  const nav = screen.getByRole("navigation", { name: "Home" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Overview", "Rooms", "Decisions", "Shopping", "Inventory", "Change log", "About"]);
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
  expect(document.title).toBe("Decisions · House · Settle");
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
  act(() => source.emit("open"));
  expect(screen.queryByText("Live")).toBeNull();
  act(() => source.emit("error"));
  expect(screen.getByText("Reconnecting")).toBeTruthy();
  // The browser gives up, and the Home is no longer there to follow (get_home is not stubbed).
  source.readyState = 2;
  act(() => source.emit("error"));
  expect(await screen.findByText("Updates stopped")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});

/** Lets the fake timers run for ms, settling the promises and renders they start. */
async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

it("opens a new connection after the browser gives up on one, and then refetches the Home", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const fetch = stubApi({
      list_homes: () => ({ homes: [house] }),
      get_home: () => ({ home: house, levels: [], rooms: [], unplacedItems: 0 }),
    });
    renderRoutes("/homes/house/about");
    const first = FakeEventSource.open();
    act(() => first.emit("open"));
    await wait(0);
    const homeFetches = () => fetch.mock.calls.filter(([url]) => url === "/api/get_home").length;

    // A deploy: the reconnect is answered 502, so the browser closes the stream for good.
    first.readyState = 2;
    act(() => first.emit("error"));
    await wait(0);
    expect(first.closed).toBe(true);
    expect(screen.getByText("Reconnecting")).toBeTruthy();
    await wait(1999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await wait(1);
    const second = FakeEventSource.open();
    expect(second).not.toBe(first);

    const before = homeFetches();
    act(() => second.emit("open"));
    await wait(0);
    expect(homeFetches()).toBeGreaterThan(before);
    expect(screen.queryByText("Reconnecting")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("waits longer after each refused reconnect, up to 30 seconds", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    stubApi({
      list_homes: () => ({ homes: [house] }),
      get_home: () => new Response("<html>Bad gateway</html>", { status: 502 }),
    });
    renderRoutes("/homes/house/about");
    const gaps: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const source = FakeEventSource.open();
      source.readyState = 2;
      act(() => source.emit("error"));
      const count = FakeEventSource.instances.length;
      let waited = 0;
      while (FakeEventSource.instances.length === count && waited < 60_000) {
        await wait(500);
        waited += 500;
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    expect(screen.getByText("Reconnecting")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

it("stops trying when the Home it follows is not found", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    stubApi({ list_homes: () => ({ homes: [house] }) });
    renderRoutes("/homes/house/about");
    const source = FakeEventSource.open();
    source.readyState = 2;
    act(() => source.emit("error"));
    await wait(0);
    expect(screen.getByText("Updates stopped")).toBeTruthy();
    await wait(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("stops when the Home answers but its live stream keeps being refused", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    // A proxy that does not forward /events, say: the calls work, the stream never opens.
    stubApi({
      list_homes: () => ({ homes: [house] }),
      get_home: () => ({ home: house, levels: [], rooms: [], unplacedItems: 0 }),
    });
    renderRoutes("/homes/house/about");
    for (let attempt = 0; attempt < 5; attempt++) {
      const source = FakeEventSource.open();
      source.readyState = 2;
      act(() => source.emit("error"));
      await wait(30_000);
    }
    expect(screen.getByText("Updates stopped")).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(5);
    await wait(120_000);
    expect(FakeEventSource.instances).toHaveLength(5);
  } finally {
    vi.useRealTimers();
  }
});

it("has a page for a Session", () => {
  renderRoutes("/homes/house/sessions/first-walkthrough");
  expect(screen.getByRole("heading", { name: "Session" })).toBeTruthy();
});

it("counts what wants the user beside Decisions, Shopping and Inventory", async () => {
  const states = ["candidate", "leaning", "leaning", "settled", "rejected"] as const;
  stubApi({
    list_homes: () => ({ homes: [house] }),
    list_decisions: () => ({
      decisions: [
        ...states.map((state) => ({ state }) as DecisionSummary),
        { state: "leaning", archivedAt: "2026-09-01" } as DecisionSummary,
      ],
    }),
    get_shopping: () => ({ shoppingList: [{}, {}] as never, considering: [] }),
    list_items: () => ({ items: [{}, {}, {}, {}] as never }),
  });
  renderRoutes("/homes/house/items");
  const nav = screen.getByRole("navigation", { name: "Home" });
  await within(nav).findByText("4");
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Overview", "Rooms", "Decisions3", "Shopping2", "Inventory4", "Change log", "About"]);
  expect(document.title).toBe("Inventory · House · Settle");
});

it("keys the four states with their marks", () => {
  renderRoutes("/homes/house/about");
  expect(screen.getByText("States").nextElementSibling?.textContent).toBe(
    "CandidateLeaningSettledRejected",
  );
});

it("opens the sidebar as a sheet from the menu button, and closes it on a link", () => {
  expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  renderRoutes("/homes/house/about");
  const menu = screen.getByRole("button", { name: "Menu" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(menu);
  expect(menu.getAttribute("aria-expanded")).toBe("true");
  const sheet = document.getElementById(menu.getAttribute("aria-controls") ?? "");
  expect(sheet?.hasAttribute("data-open")).toBe(true);
  fireEvent.click(within(sheet as HTMLElement).getByRole("link", { name: "Rooms" }));
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(menu);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
});

it("moves focus into the menu sheet, keeps it there, and gives it back to Menu on closing", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  renderRoutes("/homes/house/about");
  const menu = screen.getByRole("button", { name: "Menu" });
  menu.focus();
  fireEvent.click(menu);
  const sheet = document.getElementById(menu.getAttribute("aria-controls") ?? "") as HTMLElement;
  expect(document.activeElement).toBe(within(sheet).getAllByRole("link")[0]);
  // The page behind the scrim, and the top bar's other controls, are out of reach.
  expect(screen.getByRole("main", { hidden: true }).hasAttribute("inert")).toBe(true);
  expect(
    screen.getByRole("link", { name: "All Homes", hidden: true }).closest("[inert]"),
  ).not.toBeNull();
  expect(menu.closest("[inert]")).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(menu);
  expect(screen.getByRole("main").hasAttribute("inert")).toBe(false);
  // The scrim closes it the same way.
  fireEvent.click(menu);
  fireEvent.click(document.querySelector("[data-scrim]") as HTMLElement);
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(menu);
});

it("closes only Find on Escape when Find was opened from the menu sheet, then the sheet", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  stubApi({
    list_homes: () => ({ homes: [house] }),
    get_home: () => ({ home: house, levels: [], rooms: [], unplacedItems: 0 }),
    find_index: () => [],
  });
  renderRoutes("/homes/house/about");
  const menu = screen.getByRole("button", { name: "Menu" });
  fireEvent.click(menu);
  const sheet = document.getElementById(menu.getAttribute("aria-controls") ?? "") as HTMLElement;
  const findRow = within(sheet).getByRole("button", { name: "Find in this Home" });
  findRow.focus();
  fireEvent.click(findRow);
  const find = await screen.findByRole("dialog", { name: "Find in this Home" });
  fireEvent.keyDown(within(find).getByRole("combobox"), { key: "Escape" });
  await act(async () => {});
  expect(screen.queryByRole("dialog", { name: "Find in this Home" })).toBeNull();
  expect(menu.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(findRow);
  fireEvent.keyDown(findRow, { key: "Escape" });
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(menu);
});

it("offers a skip link first, which takes the keyboard to the page", () => {
  renderRoutes("/homes/house/about");
  const skip = screen.getByRole("link", { name: "Skip to content" });
  const focusable = document.querySelectorAll("a[href], button, input, select, textarea");
  expect(focusable[0]).toBe(skip);
  fireEvent.click(skip);
  expect(document.activeElement).toBe(screen.getByRole("main"));
});

it("shows only the mark and the theme switch outside a Home", async () => {
  renderRoutes("/");
  await screen.findAllByText("House");
  expect(screen.queryByRole("navigation", { name: "Home" })).toBeNull();
  expect(screen.queryByText("States")).toBeNull();
  expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "settle" }).getAttribute("href")).toBe("/");
});

/** The stubbed API, answering get_account as the server would for this Account. */
function stubAccount(account: { admin: boolean } | "expired") {
  // A Login that ran out is answered 401 on every call.
  const expired = () =>
    Response.json({ error: { code: "unauthorized", message: "Log in first." } }, { status: 401 });
  return stubApi({
    list_homes: () => ({ homes: [house] }),
    get_home: () =>
      account === "expired" ? expired() : { home: house, levels: [], rooms: [], unplacedItems: 0 },
    get_account: () =>
      account === "expired"
        ? expired()
        : {
            account: {
              email: "sam@example.com",
              admin: account.admin,
              createdAt: "2026-10-22",
              password: true,
              google: false,
              googleSignIn: false,
            },
          },
  });
}

it("offers the Account page and a log-out on every page", async () => {
  stubAccount({ admin: false });
  renderRoutes("/");
  const button = await screen.findByRole("button", { name: "Log out" });
  const form = button.closest("form");
  expect(form?.getAttribute("method")).toBe("post");
  expect(form?.getAttribute("action")).toBe("/logout");
  expect(screen.getByRole("link", { name: "Account" }).getAttribute("href")).toBe("/account");
  expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
});

it("offers the Admin page to the Admin alone", async () => {
  stubAccount({ admin: true });
  renderRoutes("/homes/house/about");
  const admin = await screen.findByRole("link", { name: "Admin" });
  expect(admin.getAttribute("href")).toBe("/admin");
});

it("goes to the login when the live connection is refused for a Login that ran out", async () => {
  const go = vi.spyOn(login, "go").mockImplementation(() => {});
  stubAccount({ admin: false });
  renderRoutes("/homes/house/about");
  await screen.findByRole("link", { name: "Account" });
  expect(go).not.toHaveBeenCalled();
  stubAccount("expired");
  const source = FakeEventSource.open();
  source.readyState = 2;
  act(() => source.emit("error"));
  await vi.waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  go.mockRestore();
});

it("answers a path the app does not have with a not-found page and a way home", () => {
  renderRoutes("/nowhere");
  expect(screen.getByRole("heading", { name: "No such page" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to all Homes" }).getAttribute("href")).toBe("/");
});

it("answers an unknown page inside a Home within the Home's frame", () => {
  renderRoutes("/homes/house/bogus");
  expect(screen.getByRole("heading", { name: "No such page" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Home" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to the Overview" }).getAttribute("href")).toBe(
    "/homes/house",
  );
});

it("names the tab on an unknown page inside a Home after the Home", async () => {
  renderRoutes("/homes/house/bogus");
  await screen.findByRole("option", { name: "House" });
  expect(document.title).toBe("No such page · House · Settle");
});

it("shows a page that failed to draw as a plain message inside the Home's frame", async () => {
  // React logs the caught error; the test expects it.
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubApi({
    list_homes: () => ({ homes: [house] }),
    get_home: () => ({ home: house, levels: [], rooms: [], unplacedItems: 0 }),
    list_notes: () => ({ notes: null }) as never,
  });
  renderRoutes("/homes/house/about");
  expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Home" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to the Overview" })).toBeTruthy();
  expect(screen.queryByText(/TypeError|at /)).toBeNull();
});

it("says a Home the Account does not have is not found, with a way back", async () => {
  renderRoutes("/homes/elsewhere/about");
  expect(await screen.findByRole("heading", { name: "No such Home" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "About this Home" })).toBeNull();
  expect(screen.getByRole("link", { name: "Back to all Homes" }).getAttribute("href")).toBe("/");
  // Nothing to follow, so no live connection is kept open for it.
  expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(0);
});

it("looks again before saying a Home missing from an older list is not found", async () => {
  let homes = [house];
  stubApi({
    list_homes: () => ({ homes }),
    get_home: () => ({ home: house, levels: [], rooms: [], unplacedItems: 0 }),
  });
  const { router } = renderRoutes("/homes/house/about");
  await screen.findByRole("option", { name: "House" });
  // Made elsewhere (the Agent, another tab) after this list was fetched.
  const cabin: Home = { ...house, slug: "cabin", name: "Cabin" };
  homes = [house, cabin];
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    if (screen.queryByRole("heading", { name: "No such Home" })) seen.push(document.title);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await act(() => router.navigate("/homes/cabin/about"));
  expect(await screen.findByRole("option", { name: "Cabin", selected: true })).toBeTruthy();
  await vi.waitFor(() => expect(document.title).toBe("About · Cabin · Settle"));
  observer.disconnect();
  expect(seen).toEqual([]);
});

it("shows an error above the pages as a plain message with a way back", async () => {
  // React logs the caught error; the test expects it.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // A list the frame cannot read throws outside any Home's own error route.
  stubApi({ list_homes: () => ({ homes: null }) as never });
  renderRoutes("/");
  expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to all Homes" }).getAttribute("href")).toBe("/");
  expect(document.title).toBe("Something went wrong · Settle");
});

it("names the tab on a page the app does not have", () => {
  document.title = "Rooms · House · Settle";
  renderRoutes("/nowhere");
  expect(document.title).toBe("No such page · Settle");
});
