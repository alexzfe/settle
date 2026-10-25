import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserName } from "./AccountPage";
import { login } from "./api";
import { clientName, dayWords } from "./ConnectToClaude";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sam = {
  email: "sam@example.com",
  admin: false,
  createdAt: "2026-10-01T10:00:00.000Z",
  password: true,
  google: false,
};

function stubAccountPage(handlers: ApiHandlers = {}) {
  return stubApi({
    get_account: () => ({ account: sam }),
    list_logins: () => ({
      logins: [
        {
          id: 2,
          createdAt: "2026-10-20T10:00:00.000Z",
          lastSeenAt: "2026-10-22T09:00:00.000Z",
          expiresAt: "2026-11-19T10:00:00.000Z",
          userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
          current: true,
        },
        {
          id: 1,
          createdAt: "2026-10-02T10:00:00.000Z",
          lastSeenAt: "2026-10-03T09:00:00.000Z",
          expiresAt: "2026-11-01T10:00:00.000Z",
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
          current: false,
        },
      ],
    }),
    list_connections: () => ({ connections: [] }),
    claude_connect: () => ({
      mcpUrl: "https://settle.example.com/mcp",
      addConnectorUrl:
        "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Settle" +
        "&connectorUrl=https%3A%2F%2Fsettle.example.com%2Fmcp",
      claudeCodeCommand:
        "claude mcp add --transport http --scope user settle https://settle.example.com/mcp",
    }),
    ...handlers,
  });
}

it("shows the Account, its Logins by browser, and the download of everything", async () => {
  stubAccountPage();
  renderRoutes("/account");
  await screen.findByRole("heading", { name: "Your account" });
  expect(screen.getByText(/sam@example\.com/)).toBeTruthy();
  const logins = await screen.findByText("Firefox on Linux");
  expect(logins.closest("li")?.textContent).toContain("This browser");
  expect(screen.getByText("Safari on iPhone")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Download everything" }).getAttribute("href")).toBe(
    "/api/export_account",
  );
});

it("changes the password given the current one, and checks the new one was typed twice", async () => {
  const fetch = stubAccountPage({ change_password: () => ({}) });
  renderRoutes("/account");
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  await screen.findByRole("heading", { name: "Password" });
  fireEvent.change(field("Current password"), { target: { value: "the old password" } });
  fireEvent.change(field("New password"), { target: { value: "a brand new password" } });
  fireEvent.change(field("The same again"), { target: { value: "a brand new passwort" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  await screen.findByText(/The two new passwords are different/);
  expect(inputsTo(fetch, "change_password")).toEqual([]);

  fireEvent.change(field("The same again"), { target: { value: "a brand new password" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  await screen.findByText(/Password changed\. Other browsers are logged out\./);
  expect(inputsTo(fetch, "change_password")).toEqual([
    { current: "the old password", password: "a brand new password" },
  ]);
});

it("lets an Account made with Google set its first password, with no current one", async () => {
  const fetch = stubAccountPage({
    get_account: () => ({ account: { ...sam, password: false, google: true } }),
    change_password: () => ({}),
  });
  renderRoutes("/account");
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  await screen.findByText(/You log in with Google, so your account has no password/);
  expect(screen.getByText(/You can log in with Google\./)).toBeTruthy();
  expect(screen.queryByLabelText("Current password")).toBeNull();
  // Changing the email asks for a password it doesn't have yet.
  expect(screen.queryByRole("button", { name: "Change email" })).toBeNull();
  expect(screen.getByText(/To change it, set a password first/)).toBeTruthy();

  fireEvent.change(field("New password"), { target: { value: "a brand new password" } });
  fireEvent.change(field("The same again"), { target: { value: "a brand new password" } });
  fireEvent.click(screen.getByRole("button", { name: "Set a password" }));
  await screen.findByText(/Password set\. Other browsers are logged out\./);
  expect(inputsTo(fetch, "change_password")).toEqual([{ password: "a brand new password" }]);
});

it("logs out everywhere, this browser included", async () => {
  const go = vi.spyOn(login, "go").mockImplementation(() => {});
  const fetch = stubAccountPage({ end_logins: () => ({}) });
  renderRoutes("/account");
  fireEvent.click(await screen.findByRole("button", { name: "Log out everywhere" }));
  await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  expect(inputsTo(fetch, "end_logins")).toEqual([{}]);
});

it("deletes the Account only once its email is typed, pointing to the download first", async () => {
  const go = vi.spyOn(login, "go").mockImplementation(() => {});
  const fetch = stubAccountPage({ delete_account: () => ({}) });
  renderRoutes("/account");
  fireEvent.click(await screen.findByRole("button", { name: "Delete my account…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete your account" });
  expect(within(dialog).getByRole("link", { name: "download everything" })).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText(/Type your email/), {
    target: { value: "sam@example.com" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));
  await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  expect(inputsTo(fetch, "delete_account")).toEqual([{ email: "sam@example.com" }]);
});

it("offers the Admin no way to delete their own account", async () => {
  stubAccountPage({ get_account: () => ({ account: { ...sam, admin: true } }) });
  renderRoutes("/account");
  await screen.findByText(/the Admin of this server/);
  expect(screen.queryByRole("button", { name: "Delete my account…" })).toBeNull();
});

it("names a browser in a few words", () => {
  expect(browserName(undefined)).toBe("A browser");
  expect(
    browserName(
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0",
    ),
  ).toBe("Edge on Windows");
  expect(browserName("curl/8.10.1")).toBe("curl");
});

it("lists each Connection with when it was made and last used, and Disconnect ends it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T15:00:00"));
  let connections = [
    {
      id: 7,
      client: "claude.ai",
      createdAt: "2026-10-24T10:00:00.000Z",
      lastUsedAt: "2026-10-24T14:00:00.000Z",
    },
  ];
  const fetch = stubAccountPage({
    list_connections: () => ({ connections }),
    end_connection: () => {
      connections = [];
      return {};
    },
  });
  renderRoutes("/account");
  const row = (await screen.findByText("Claude (claude.ai)")).closest("li") as HTMLElement;
  expect(row.textContent).toContain("Connected 24 Oct, last used today");
  expect(
    screen.getByRole("link", { name: "Connect Settle to Claude" }).getAttribute("href"),
  ).toContain("connectorUrl=https%3A%2F%2Fsettle.example.com%2Fmcp");
  fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
  await screen.findByText("Claude isn't connected to your account yet.");
  expect(inputsTo(fetch, "end_connection")).toEqual([{ connection: 7 }]);
  vi.useRealTimers();
});

it("names a Connection's client and its last use in words", () => {
  expect(clientName("claude.ai")).toBe("Claude (claude.ai)");
  expect(clientName("localhost")).toBe("A program on a computer (localhost)");
  const now = new Date("2026-10-24T15:00:00");
  expect(dayWords("2026-10-24T01:00:00", now)).toBe("today");
  expect(dayWords("2026-10-23T23:00:00", now)).toBe("yesterday");
  expect(dayWords("2026-09-02T12:00:00", now)).toBe("2 Sep");
});
