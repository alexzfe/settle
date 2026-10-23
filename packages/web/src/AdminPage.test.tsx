import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const admin = { email: "sam@example.com", admin: true, createdAt: "2026-10-01T10:00:00.000Z" };

function stubAdminPage(handlers: ApiHandlers = {}) {
  return stubApi({
    get_account: () => ({ account: admin }),
    list_invites: () => ({ invites: [] }),
    list_accounts: () => ({
      accounts: [
        { id: 1, email: "sam@example.com", admin: true, createdAt: admin.createdAt, homes: 2 },
        {
          id: 2,
          email: "kim@example.com",
          admin: false,
          createdAt: "2026-10-22T10:00:00.000Z",
          homes: 1,
        },
      ],
    }),
    ...handlers,
  });
}

it("makes an invite and shows its link once, to copy, with when it stops working", async () => {
  const url = "https://settle.example.com/invite/abc";
  const fetch = stubAdminPage({
    create_invite: () => ({ invite: { url, expiresAt: "2026-10-29T10:00:00.000Z" } }),
  });
  renderRoutes("/admin");
  fireEvent.click(await screen.findByRole("button", { name: "Make an invite" }));
  const made = await screen.findByText(url);
  const shown = made.closest("[role=status]") as HTMLElement;
  expect(shown.textContent).toMatch(/It works once, until .+, and is shown only now\./);
  expect(within(shown).getByRole("button", { name: "Copy the link" })).toBeTruthy();
  expect(inputsTo(fetch, "create_invite")).toEqual([{}]);
});

it("lists waiting invites, each to cancel", async () => {
  const fetch = stubAdminPage({
    list_invites: () => ({
      invites: [
        { id: 7, createdAt: "2026-10-20T10:00:00.000Z", expiresAt: "2026-10-27T10:00:00.000Z" },
      ],
    }),
    cancel_invite: () => ({}),
  });
  renderRoutes("/admin");
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(inputsTo(fetch, "cancel_invite")).toEqual([{ invite: 7 }]));
});

it("lists the Accounts by email, date, and Home count, acting on others but never itself", async () => {
  const fetch = stubAdminPage({
    create_reset_link: () => ({
      reset: { url: "https://settle.example.com/reset/xyz", expiresAt: "2026-10-23T10:00:00Z" },
    }),
    disable_account: () => ({}),
  });
  renderRoutes("/admin");
  const kim = (await screen.findByText("kim@example.com")).closest("tr") as HTMLElement;
  const sam = screen.getByText("sam@example.com").closest("tr") as HTMLElement;
  expect(within(sam).queryAllByRole("button")).toEqual([]);
  expect(within(sam).getByText("You")).toBeTruthy();

  fireEvent.click(within(kim).getByRole("button", { name: "Reset link" }));
  const shown = await screen.findByText("https://settle.example.com/reset/xyz");
  expect(shown.closest("[role=status]")?.textContent).toContain("reset link for kim@example.com");
  fireEvent.click(within(kim).getByRole("button", { name: "Disable" }));
  await waitFor(() => expect(inputsTo(fetch, "disable_account")).toEqual([{ account: 2 }]));
  expect(inputsTo(fetch, "create_reset_link")).toEqual([{ account: 2 }]);
});

it("deletes an Account only once its email is typed", async () => {
  const fetch = stubAdminPage({ admin_delete_account: () => ({}) });
  renderRoutes("/admin");
  const kim = (await screen.findByText("kim@example.com")).closest("tr") as HTMLElement;
  fireEvent.click(within(kim).getByRole("button", { name: "Delete…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete kim@example.com" });
  expect(dialog.textContent).toContain("disable the account instead");
  fireEvent.change(within(dialog).getByLabelText(/Type their email/), {
    target: { value: "kim@example.com" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete the account" }));
  await waitFor(() =>
    expect(inputsTo(fetch, "admin_delete_account")).toEqual([
      { account: 2, email: "kim@example.com" },
    ]),
  );
});

it("is shown to the Admin alone", async () => {
  stubAdminPage({ get_account: () => ({ account: { ...admin, admin: false } }) });
  renderRoutes("/admin");
  await screen.findByText(/Only the Admin, who runs this server, sees this page\./);
  expect(screen.queryByRole("button", { name: "Make an invite" })).toBeNull();
});
