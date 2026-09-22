import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../api";
import { useLiveUpdates } from "../liveUpdates";
import { FakeEventSource, renderRoutes, stubApi } from "../testSupport";
import { AgentStatus } from "./AgentStatus";

const now = new Date("2026-09-21T12:00:00Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE).toISOString();

const closed: Session = {
  slug: "walkthrough",
  skills: ["home-intake"],
  openedAt: "2026-09-19T10:00:00Z",
  closedAt: "2026-09-19T11:00:00Z",
};
const open: Session = { slug: "paint", skills: ["color"], openedAt: ago(90) };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers({ now, shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The footer line as the shell mounts it, kept live by the Home's event stream. */
function Footer() {
  const live = useLiveUpdates("flat");
  return (
    <footer>
      <AgentStatus home="flat" live={live} />
    </footer>
  );
}

function showFooter(sessions: Session[]) {
  stubApi({ list_sessions: () => ({ sessions }) });
  const view = renderRoutes("/homes/flat", [
    { path: "/homes/flat", element: <Footer /> },
    { path: "/homes/flat/sessions/:session", element: <p>Session page</p> },
  ]);
  const source = FakeEventSource.open();
  act(() => source.emit("open"));
  const footer = () => view.container.querySelector("footer")?.textContent ?? "";
  // The query cache tells its observers in a zero-delay timeout, so the act runs it.
  const agentCall = (at: string) =>
    act(async () => {
      source.emit("agent", { home: "flat", at });
      await vi.advanceTimersByTimeAsync(0);
    });
  const minutesPass = (minutes: number) => act(() => vi.advanceTimersByTime(minutes * MINUTE));
  return { ...view, source, footer, agentCall, minutesPass };
}

it("shows the connection's failures first, with Reload once updates stop", async () => {
  const { source, footer, agentCall } = showFooter([closed, open]);
  await agentCall(ago(1));
  expect(await screen.findByText(/Agent working/)).toBeTruthy();
  act(() => source.emit("error"));
  expect(footer()).toBe("Reconnecting");
  source.readyState = 2;
  act(() => source.emit("error"));
  expect(footer()).toBe("Updates stoppedReload");
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});

it("says the Agent is working while a Session is open and it called a tool in the last 5 minutes", async () => {
  const { footer, agentCall, minutesPass } = showFooter([closed, open]);
  await agentCall(ago(1));
  expect(await screen.findByText(/Agent working/)).toBeTruthy();
  expect(footer()).toBe("Agent working · Color Session");
  // The state expires on the minute timer, with no new event.
  minutesPass(4);
  expect(footer()).toBe("Last Session 21 Sep");
  await agentCall(new Date().toISOString());
  expect(footer()).toBe("Agent working · Color Session");
});

it("nudges to wrap up a Session left open with no call for 30 minutes, copying a prompt", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { footer, agentCall, minutesPass } = showFooter([closed, open]);
  await agentCall(ago(20));
  expect(await screen.findByText(/Last Session/)).toBeTruthy();
  minutesPass(9);
  expect(footer()).toMatch(/^Last Session/);
  minutesPass(1);
  expect(footer()).toBe("Color Session still open · ↗ Wrap up");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Wrap up/ }));
  });
  expect(writeText).toHaveBeenCalledWith(
    `claude "wrap up the open Color Session with a summary of what changed and what is still ` +
      `open (slug: paint)"`,
  );
});

it("goes by the Session's opening when no call is known, as after a server restart", async () => {
  const opening = showFooter([{ ...open, openedAt: ago(2) }]);
  expect(await screen.findByText(/Agent working/)).toBeTruthy();
  expect(opening.footer()).toBe("Agent working · Color Session");
  cleanup();
  const later = showFooter([{ ...open, skills: [] }]);
  expect(await screen.findByText(/still open/)).toBeTruthy();
  expect(later.footer()).toBe("Session still open · ↗ Wrap up");
});

it("otherwise links to the last Session by its date, and says nothing for a Home with none", async () => {
  const { router } = showFooter([closed]);
  const link = await screen.findByRole("link", { name: "Last Session 19 Sep" });
  fireEvent.click(link);
  expect(router.state.location.pathname).toBe("/homes/flat/sessions/walkthrough");
  cleanup();
  const none = showFooter([]);
  await act(async () => {});
  expect(none.footer()).toBe("");
});

it("no longer shows the steady Live state", async () => {
  const { footer } = showFooter([]);
  await act(async () => {});
  expect(footer()).not.toMatch(/Live|Connecting/);
});
