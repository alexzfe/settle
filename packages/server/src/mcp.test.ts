import {
  addAccount,
  type CallContext,
  type Core,
  createCore,
  TEST_PASSWORD_COST,
} from "@settle/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentActivity } from "./agent-activity.js";
import { handleAccountMcpRequest, handleMcpRequest, mcpTools } from "./mcp.js";

// The MCP endpoints answered directly: the Account's, which track A's /mcp route opens with a
// Connection's token, and a Home Folder's.

const PORT = 4391;
let core: Core;
let kim: CallContext;
let sam: CallContext;
let activity: AgentActivity;
const accountOf = (web: CallContext) => (web.caller as { account: number }).account;

interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
}

function request(method: string, params: unknown): Request {
  return new Request(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${PORT}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function call(web: CallContext, name: string, args: unknown): Promise<ToolResult> {
  const response = await handleAccountMcpRequest(request("tools/call", { name, arguments: args }), {
    core,
    tools: mcpTools(core),
    account: accountOf(web),
    activity,
    port: PORT,
  });
  return ((await response.json()) as { result: ToolResult }).result;
}

const textOf = (result: ToolResult) => result.content[0]?.text ?? "";
const sessionOf = (result: ToolResult) => /^Session: (\S+)$/m.exec(textOf(result))?.[1] ?? "";

async function createHome(web: CallContext, name: string): Promise<string> {
  const { home } = await core.run("create_home", web, { name, country: "GB", city: "London" });
  return home.slug;
}

beforeEach(async () => {
  core = createCore({ passwordCost: TEST_PASSWORD_COST });
  kim = await addAccount(core);
  sam = await addAccount(core);
  activity = new AgentActivity();
});
afterEach(() => core.close());

describe("the Account endpoint", () => {
  it("lists the same tools as a Home Folder's", async () => {
    const tools = mcpTools(core);
    const account = await handleAccountMcpRequest(request("tools/list", {}), {
      core,
      tools,
      account: accountOf(kim),
      activity,
      port: PORT,
    });
    const home = await handleMcpRequest(request("tools/list", {}), {
      core,
      tools,
      home: "any",
      activity,
      port: PORT,
    });
    expect(await account.json()).toEqual(await home.json());
  });

  it("opens the only Home with the protocol and the Skills, then serves a Skill", async () => {
    await createHome(kim, "Lisbon flat");

    const opened = await call(kim, "open_session", { skill: "purchase" });
    const session = sessionOf(opened);
    const skill = await call(kim, "read_skill", { session, name: "purchase" });

    const text = textOf(opened);
    expect(text).toContain(`Pass session "${session}" on every call`);
    expect(text).toContain("## Session protocol");
    expect(text).toContain("- design-direction: ");
    expect(text).toContain(`read_skill with name "purchase" and session "${session}"`);
    expect(text.indexOf("## Skills")).toBeLessThan(text.indexOf("Lisbon flat"));
    expect(textOf(skill)).toContain("# Purchase");
  });

  it("asks which Home when the Account has several", async () => {
    await createHome(kim, "Lisbon flat");
    await createHome(kim, "Beach house");

    const listed = await call(kim, "list_homes", {});
    const refused = await call(kim, "open_session", { skill: "color" });

    expect(textOf(listed)).toBe(
      "- Beach house (slug beach-house)\n- Lisbon flat (slug lisbon-flat)",
    );
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("ask them which one");
  });

  it("refuses another Account's Session as an unknown one, and records no activity for it", async () => {
    const theirs = await createHome(sam, "Sams place");
    const session = sessionOf(await call(sam, "open_session", { skill: "home-intake" }));
    const seen = activity.last(theirs);

    const refused = await call(kim, "find_items", { session });

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain(`has no Session "${session}"`);
    expect(activity.last(theirs)).toEqual(seen);
  });

  it("records each call for its Session's Home", async () => {
    const home = await createHome(kim, "Lisbon flat");

    const session = sessionOf(await call(kim, "open_session", { skill: "home-intake" }));
    expect(activity.last(home)?.tool).toBe("open_session");
    await call(kim, "find_items", { session });

    expect(activity.last(home)?.tool).toBe("find_items");
  });
});

describe("refusals of a tool's input", () => {
  async function opened(): Promise<string> {
    await createHome(kim, "Lisbon flat");
    return sessionOf(await call(kim, "open_session", { skill: "home-intake" }));
  }

  it("come from Core, saying what is wrong with each field and what to do", async () => {
    const session = await opened();

    const refused = await call(kim, "set_decision_state", {
      session,
      decision: "linen-curtains",
      to: "Settled",
    });

    expect(refused.isError).toBe(true);
    const text = textOf(refused);
    expect(text).not.toContain("MCP error");
    expect(text).toContain("`to`");
    expect(text).toContain("Call set_decision_state again");
  });

  it("say a length is { mm, provenance } when one is given wrong", async () => {
    const session = await opened();

    const refused = await call(kim, "save_room", {
      session,
      name: "Living room",
      ceilingHeight: { provenance: "measured" },
    });

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("`ceilingHeight.mm`");
    expect(textOf(refused)).toContain("whole millimetres");
  });

  it("refuse a tool that doesn't exist, as a tool result", async () => {
    const refused = await call(kim, "delete_everything", {});

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('There is no tool "delete_everything"');
  });
});

describe("tools/list", () => {
  async function listed(): Promise<
    { name: string; description: string; annotations: { openWorldHint?: boolean } }[]
  > {
    const response = await handleMcpRequest(request("tools/list", {}), {
      core,
      tools: mcpTools(core),
      home: "any",
      activity,
      port: PORT,
    });
    return ((await response.json()) as { result: { tools: never[] } }).result.tools;
  }

  it("marks record_listing open-world, since it fetches the Listing's picture from the web", async () => {
    const tools = await listed();

    const open = tools.filter((tool) => tool.annotations.openWorldHint).map((tool) => tool.name);
    expect(open).toEqual(["record_listing"]);
  });

  it("lists keeping a flagged Decision among set_decision_state's moves", async () => {
    const tool = (await listed()).find((each) => each.name === "set_decision_state");

    expect(tool?.description).toContain(
      "Only these moves: a Decision with an open flag or Conflict to its current state (a " +
        "keep, which clears them; quote the user in `reason`);",
    );
  });

  it("says find_items's text leaves out the Items with none of its words", async () => {
    const tool = (await listed()).find((each) => each.name === "find_items") as unknown as {
      inputSchema: { properties: { text: { description: string } } };
    };

    const described = tool.inputSchema.properties.text.description;
    expect(described).toContain("Only Items with at least one of these words");
    expect(described).not.toContain("come first");
  });
});
