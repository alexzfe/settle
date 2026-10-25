import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Home } from "./api";
import { inputsTo, renderRoutes, stubApi } from "./testSupport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const connect = {
  mcpUrl: "https://settle.example.com/mcp",
  addConnectorUrl:
    "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Settle" +
    "&connectorUrl=https%3A%2F%2Fsettle.example.com%2Fmcp",
  claudeCodeCommand:
    "claude mcp add --transport http --scope user settle https://settle.example.com/mcp",
};

it("runs the first run: name the Home, then connect Claude, then the Home", async () => {
  let homes: Home[] = [];
  const fetch = stubApi({
    list_homes: () => ({ homes }),
    create_home: (input) => {
      homes = [{ ...flat, name: input.name }];
      return { home: homes[0] as Home };
    },
    get_home: () => ({ home: flat, levels: [], rooms: [], unplacedItems: 0 }),
    claude_connect: () => connect,
  });
  const { router } = renderRoutes("/");
  await screen.findByRole("heading", { name: "Name your Home" });
  expect(screen.getByText("Step 1 of 2")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Flat" } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "Spain" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Madrid" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Home" }));

  await screen.findByRole("heading", { name: "Connect Settle to Claude" });
  expect(router.state.location.pathname).toBe("/welcome/connect/flat");
  expect(inputsTo(fetch, "create_home")).toEqual([
    { name: "Flat", country: "Spain", city: "Madrid" },
  ]);
  const button = await screen.findByRole("link", { name: "Connect Settle to Claude" });
  expect(button.getAttribute("href")).toBe(connect.addConnectorUrl);
  expect(button.getAttribute("target")).toBe("_blank");
  expect(screen.getByText(/Click/).textContent).toContain("Add, then Connect, then Allow");
  expect(screen.getByText(connect.claudeCodeCommand)).toBeDefined();

  fireEvent.click(await screen.findByRole("link", { name: "Go to Flat" }));
  expect(router.state.location.pathname).toBe("/homes/flat");
});

it("never shows the first run to an Account that has a Home", async () => {
  stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [], rooms: [], unplacedItems: 0 }),
  });
  const { router } = renderRoutes("/welcome");
  await screen.findByRole("link", { name: "Flat" });
  expect(router.state.location.pathname).toBe("/");
});
