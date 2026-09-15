// The Shopping section's reads and the exports of slice 6, written before their implementation:
// get_shopping's two groups, the Shopping List as a printable page and CSV, the Shopping Guides
// as a printable page and Markdown, the phone page of the Quick Guide by slug and by its LAN
// token, and the LAN URLs of LAN mode (docs/poc-design.md#web-ui, docs/build-plan.md "The server
// process").
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore } from "./core.js";
import { CoreError } from "./errors.js";
import type { Measurement } from "./operations/schemas.js";

const web: CallContext = { caller: { kind: "web" } };
const measured = (mm: number): Measurement => ({ mm, provenance: "measured" });
const estimated = (mm: number): Measurement => ({ mm, provenance: "estimated" });
const LAN_URL = "http://192.168.1.20:4380";

const FULL_GUIDE = [
  "## Size",
  "",
  "- **At least 2.0 × 1.4 m** (must). The sofa's front legs stand on it,",
  "  or it floats.",
  "",
  "## Material",
  "",
  "Wool, *low pile*: see [the care guide](https://example.com/care).",
].join("\n");

let core: Core;
let home: string;
let session: string;
const agent = (id?: string): CallContext => ({ caller: { kind: "session", session: id }, home });
const call = (name: string, input: Record<string, unknown>) =>
  core.run(name, agent(session), { session, ...input });

beforeEach(async () => {
  core = createCore({ lanUrl: LAN_URL });
  home = (await core.run("create_home", web, { name: "My flat", country: "GB", city: "London" }))
    .home.slug;
  session = (
    await core.run("open_session", { caller: { kind: "session" }, home }, { skill: "purchase" })
  ).session;
  await call("save_room", {
    name: "Living room",
    walls: [
      { position: 1, length: measured(4000) },
      { position: 2, length: estimated(3000) },
    ],
  });
  await call("save_items", {
    items: [{ name: "Old lamp", category: "lighting", room: "living-room" }],
  });

  // The Shopping List: a Locked rug with both Guides and a Listing.
  await call("save_decision", {
    kind: "purchase",
    room: "living-room",
    title: "Wool rug",
    statement: "A large wool rug, <b>under</b> the sofa.",
    requirements: [
      {
        text: "At least 2.0 × 1.4 m",
        strength: "must",
        reason: { kind: "wall", id: "living-room/wall-2", field: "length" },
      },
      {
        text: 'Wool, "low" pile, no loops',
        strength: "must",
        reason: { kind: "room", id: "living-room" },
      },
      { text: "Terracotta", strength: "prefer", reason: { kind: "room", id: "living-room" } },
    ],
  });
  await call("save_guides", {
    decision: "wool-rug",
    quickLines: ["Rub the pile hard: fluff means shedding"],
    fullGuide: FULL_GUIDE,
  });
  await call("record_listing", {
    decision: "wool-rug",
    name: "Hay Plain rug",
    price: "£450",
    checks: [
      { requirement: 1, result: "pass" },
      { requirement: 2, result: "fail" },
      { requirement: 3, result: "unknown" },
    ],
  });
  await call("set_decision_state", { decision: "wool-rug", to: "locked", reason: "The user: yes" });

  // Considering: a Leaning lamp in the living room, and a Home-wide Candidate without Guides.
  await call("save_decision", {
    kind: "purchase",
    room: "living-room",
    title: "Floor lamp",
    statement: "A warm floor lamp by the sofa.",
    requirements: [
      { text: "Dimmable", strength: "prefer", reason: { kind: "room", id: "living-room" } },
    ],
  });
  await call("save_guides", { decision: "floor-lamp", quickLines: ["Try the dimmer"] });
  await call("set_decision_state", { decision: "floor-lamp", to: "leaning", reason: "The user" });
  await call("save_decision", {
    kind: "purchase",
    title: "Door mat",
    statement: "=A coir mat for the front door.",
  });

  // Never listed: a Rejected Purchase with Guides, a Fulfilled one, and a Locked non-Purchase.
  await call("save_decision", {
    kind: "purchase",
    room: "living-room",
    title: "Velvet sofa",
    statement: "A green velvet sofa.",
    requirements: [
      { text: "Green", strength: "must", reason: { kind: "room", id: "living-room" } },
    ],
  });
  await call("save_guides", { decision: "velvet-sofa", fullGuide: "## Color\n\nGreen." });
  await call("set_decision_state", { decision: "velvet-sofa", to: "rejected", reason: "The user" });
  await call("save_decision", {
    kind: "purchase",
    room: "living-room",
    title: "Table lamp",
    statement: "A small lamp.",
  });
  await call("set_decision_state", { decision: "table-lamp", to: "locked", reason: "The user" });
  await call("record_fulfilment", {
    decision: "table-lamp",
    bought: "A brass table lamp",
    item: { name: "Brass lamp", category: "lighting" },
    replacesItem: "old-lamp",
  });
  await call("save_decision", {
    kind: "other",
    title: "Books by color",
    statement: "Books by the color of their spines.",
  });
  await call("set_decision_state", { decision: "books-by-color", to: "locked", reason: "Yes" });
});
afterEach(() => core.close());

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

async function exportText(
  name: "export_shopping_list" | "export_guides",
  input: Record<string, unknown>,
): Promise<string> {
  return (await core.run(name, web, { home, ...input } as never)).text;
}

/** The Wool rug's LAN token, from its Guides' LAN URL. */
async function rugToken(): Promise<string> {
  const { decision } = await core.run("get_decision", web, { home, decision: "wool-rug" });
  const url = decision.guides?.lanUrl ?? "";
  expect(url).toMatch(/^http:\/\/192\.168\.1\.20:4380\/guide\/[A-Za-z0-9]{24}$/);
  return url.slice(url.lastIndexOf("/") + 1);
}

describe("get_shopping", () => {
  it("lists Locked Purchases not Fulfilled on the Shopping List, and Candidate and Leaning ones under Considering, Home-wide first", async () => {
    const { shoppingList, considering } = await core.run("get_shopping", web, { home });
    expect(shoppingList.map((each) => each.slug)).toEqual(["wool-rug"]);
    expect(considering.map((each) => each.slug)).toEqual(["door-mat", "floor-lamp"]);
  });

  it("gives each entry its Room, Requirement counts, Guides, Listings, Measure-first lines, and open flags", async () => {
    const { shoppingList, considering } = await core.run("get_shopping", web, { home });
    expect(shoppingList[0]).toEqual({
      slug: "wool-rug",
      title: "Wool rug",
      statement: "A large wool rug, <b>under</b> the sofa.",
      state: "locked",
      room: { slug: "living-room", name: "Living room" },
      requirements: { must: 2, prefer: 1 },
      hasGuides: true,
      fullGuideOutOfDate: false,
      listings: 1,
      measureFirst: ["Measure first: living-room/wall-2 length (~3.00 m)"],
      openFlags: 0,
    });
    expect(considering[0]).toMatchObject({
      slug: "door-mat",
      requirements: { must: 0, prefer: 0 },
      hasGuides: false,
      listings: 0,
      measureFirst: [],
    });
    expect(considering[0]?.room).toBeUndefined();
  });

  it("marks an entry whose Full Guide went out of date after a Requirement changed", async () => {
    await call("set_decision_state", { decision: "wool-rug", to: "leaning", reason: "The user" });
    await call("save_decision", {
      decision: "wool-rug",
      kind: "purchase",
      title: "Wool rug",
      statement: "A large wool rug, <b>under</b> the sofa.",
      requirements: [
        { text: "Undyed", strength: "prefer", reason: { kind: "room", id: "living-room" } },
      ],
    });
    const { considering } = await core.run("get_shopping", web, { home });
    const rug = considering.find((each) => each.slug === "wool-rug");
    expect(rug?.fullGuideOutOfDate).toBe(true);
    expect(considering.find((each) => each.slug === "floor-lamp")?.fullGuideOutOfDate).toBe(false);
  });
});

describe("export_shopping_list", () => {
  it("writes the Shopping List as CSV: a header, then one row per Purchase, quoted where needed", async () => {
    const result = await core.run("export_shopping_list", web, { home, format: "csv" });
    expect(result.mimeType).toBe("text/csv; charset=utf-8");
    expect(result.fileName).toBe("my-flat-shopping-list.csv");
    const rows = result.text.split("\r\n");
    expect(rows[0]).toBe(
      "Purchase,Slug,Room,Statement,Must,Prefer,Measure first,Listings,Guides,Open flags",
    );
    expect(rows[1]).toBe(
      'Wool rug,wool-rug,Living room,"A large wool rug, <b>under</b> the sofa.",' +
        '"At least 2.0 × 1.4 m; Wool, ""low"" pile, no loops",Terracotta,' +
        "living-room/wall-2 length (~3.00 m),1,yes,0",
    );
    expect(rows.slice(2)).toEqual([""]);
  });

  it("keeps a spreadsheet from reading a cell as a formula", async () => {
    await call("set_decision_state", { decision: "door-mat", to: "locked", reason: "The user" });
    const text = await exportText("export_shopping_list", { format: "csv" });
    expect(text).toContain("Door mat,door-mat,Home-wide,'=A coir mat for the front door.,");
  });

  it("writes the Shopping List as a printable page: each Purchase's Room, Measure-first lines, and Requirements, escaped", async () => {
    const result = await core.run("export_shopping_list", web, { home, format: "html" });
    expect(result.mimeType).toBe("text/html; charset=utf-8");
    expect(result.fileName).toBe("my-flat-shopping-list.html");
    const page = result.text;
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain("<title>Shopping List: My flat</title>");
    expect(page).toContain("@media print");
    expect(page).toContain("A large wool rug, &lt;b&gt;under&lt;/b&gt; the sofa.");
    expect(page).toContain("living-room/wall-2 length (~3.00 m)");
    expect(page).toContain("Wool, &quot;low&quot; pile, no loops");
    expect(page).toContain("Hay Plain rug, £450: 1 pass, 1 fail, 1 unknown");
    expect(page).not.toContain("<b>under");
    expect(page).not.toContain("<script");
    // Considering and every Purchase not to buy stay off it.
    for (const title of ["Floor lamp", "Door mat", "Velvet sofa", "Table lamp", "Books by"]) {
      expect(page).not.toContain(title);
    }
  });

  it("says so when nothing is on the Shopping List", async () => {
    await call("set_decision_state", { decision: "wool-rug", to: "leaning", reason: "The user" });
    expect(await exportText("export_shopping_list", { format: "html" })).toContain(
      "Nothing is on the Shopping List",
    );
    expect(await exportText("export_shopping_list", { format: "csv" })).toBe(
      "Purchase,Slug,Room,Statement,Must,Prefer,Measure first,Listings,Guides,Open flags\r\n",
    );
  });
});

describe("export_guides", () => {
  it("writes every Purchase with Guides as Markdown: the Shopping List's first, the Quick Guide in order, then the Full Guide under demoted headings", async () => {
    const result = await core.run("export_guides", web, { home, format: "markdown" });
    expect(result.mimeType).toBe("text/markdown; charset=utf-8");
    expect(result.fileName).toBe("my-flat-shopping-guides.md");
    const text = result.text;
    expect(text.startsWith("# Shopping Guides: My flat\n")).toBe(true);
    const order = [
      "## Wool rug",
      "- **Measure first:** living-room/wall-2 length (~3.00 m)",
      "- At least 2.0 × 1.4 m",
      '- Wool, "low" pile, no loops',
      "- Terracotta",
      "- Rub the pile hard: fluff means shedding",
      "### Full Guide",
      "#### Size",
      "#### Material",
      "## Floor lamp",
      "- Try the dimmer",
      "No Full Guide written yet.",
    ].map((line) => text.indexOf(line));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Without Guides, Rejected, or Fulfilled: not exported.
    for (const title of ["Door mat", "Velvet sofa", "Table lamp"]) {
      expect(text).not.toContain(title);
    }
  });

  it("writes one Purchase's Guides, and says when its Full Guide is out of date", async () => {
    await call("set_decision_state", { decision: "wool-rug", to: "leaning", reason: "The user" });
    await call("save_decision", {
      decision: "wool-rug",
      kind: "purchase",
      title: "Wool rug",
      statement: "A large wool rug, <b>under</b> the sofa.",
      requirements: [
        { text: "Undyed", strength: "prefer", reason: { kind: "room", id: "living-room" } },
      ],
    });
    const result = await core.run("export_guides", web, {
      home,
      decision: "wool-rug",
      format: "markdown",
    });
    expect(result.fileName).toBe("wool-rug-shopping-guides.md");
    expect(result.text).toContain("## Wool rug");
    expect(result.text).toContain("Out of date: a Requirement changed after it was written");
    expect(result.text).not.toContain("Floor lamp");
  });

  it("writes the Guides as a printable page, the Full Guide's Markdown as HTML and its raw HTML escaped", async () => {
    await call("save_guides", {
      decision: "floor-lamp",
      fullGuide: "# Light\n\n<script>alert(1)</script> and [a link](javascript:alert(1)).",
    });
    const result = await core.run("export_guides", web, { home, format: "html" });
    expect(result.mimeType).toBe("text/html; charset=utf-8");
    expect(result.fileName).toBe("my-flat-shopping-guides.html");
    const page = result.text;
    expect(page).toContain("<h4>Size</h4>");
    expect(page).toContain("<strong>At least 2.0 × 1.4 m</strong> (must).");
    expect(page).toContain("<em>low pile</em>");
    expect(page).toContain('<a href="https://example.com/care">the care guide</a>');
    expect(page).toContain("<h4>Light</h4>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain("a link");
    expect(page).not.toContain("javascript:");
    expect(page).not.toContain("<script");
  });

  it("refuses a Decision that is no Purchase, a Rejected Purchase, and one the Home lacks", async () => {
    const guides = (decision: string) =>
      core.run("export_guides", web, { home, decision, format: "markdown" });
    expect((await refusal(guides("books-by-color"))).code).toBe("validation");
    const rejected = await refusal(guides("velvet-sofa"));
    expect(rejected.code).toBe("illegal_transition");
    expect(rejected.message).toContain("Rejected");
    expect((await refusal(guides("nothing"))).code).toBe("not_found");
  });
});

describe("the phone page of a Quick Guide", () => {
  it("is a phone-readable page with no JavaScript: Measure first, the musts, the prefers, the AI's lines, then the Full Guide one tap away", async () => {
    const result = await core.run("get_guide_page", web, { home, decision: "wool-rug" });
    expect(result.mimeType).toBe("text/html; charset=utf-8");
    const page = result.text;
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(page).toContain("<title>Wool rug: Quick Guide</title>");
    expect(page).not.toContain("<script");
    expect(page).not.toMatch(/ on[a-z]+=/);
    const order = [
      "Measure first",
      "living-room/wall-2 length (~3.00 m)",
      "Must",
      "At least 2.0 × 1.4 m",
      "Prefer",
      "Terracotta",
      "In the shop",
      "Rub the pile hard",
      "<details>",
      "<summary>Full Guide</summary>",
      "<h3>Size</h3>",
    ].map((part) => page.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is the same page by its LAN token alone", async () => {
    const bySlug = await core.run("get_guide_page", web, { home, decision: "wool-rug" });
    const byToken = await core.run("get_guide_page", web, { token: await rugToken() });
    expect(byToken.text).toBe(bySlug.text);
  });

  it("is assembled from the Requirements for a Purchase with no Guides saved", async () => {
    const { text } = await core.run("get_guide_page", web, { home, decision: "door-mat" });
    expect(text).toContain("<title>Door mat: Quick Guide</title>");
    expect(text).not.toContain("<details>");
  });

  it("refuses an unknown token, a Rejected Purchase, a Decision that is no Purchase, and a call naming both or neither", async () => {
    const page = (input: Record<string, unknown>) => core.run("get_guide_page", web, input);
    expect((await refusal(page({ token: "AAAAAAAAAAAAAAAAAAAAAAAA" }))).code).toBe("not_found");
    expect((await refusal(page({ home, decision: "velvet-sofa" }))).code).toBe("not_found");
    expect((await refusal(page({ home, decision: "books-by-color" }))).code).toBe("validation");
    expect((await refusal(page({ home, decision: "nothing" }))).code).toBe("not_found");
    const token = await rugToken();
    expect((await refusal(page({ home, decision: "wool-rug", token }))).code).toBe("validation");
    expect((await refusal(page({}))).code).toBe("validation");
    expect((await refusal(page({ home }))).code).toBe("validation");
  });

  it("refuses the token of a Purchase Rejected after its Guides were saved", async () => {
    const token = await rugToken();
    await call("set_decision_state", { decision: "wool-rug", to: "rejected", reason: "The user" });
    expect((await refusal(core.run("get_guide_page", web, { token }))).code).toBe("not_found");
  });
});

describe("LAN mode", () => {
  it("puts the LAN address on get_home, and each Quick Guide's LAN URL on its Guides", async () => {
    expect((await core.run("get_home", web, { home })).lanUrl).toBe(LAN_URL);
    await rugToken();
    const { decision } = await core.run("get_decision", web, { home, decision: "door-mat" });
    // No Guides saved, so no token yet.
    expect(decision.guides).toBeUndefined();
  });

  it("gives no LAN URL when LAN mode is off", async () => {
    const off = createCore();
    try {
      const flat = (
        await off.run("create_home", web, { name: "Flat", country: "GB", city: "London" })
      ).home.slug;
      expect((await off.run("get_home", web, { home: flat })).lanUrl).toBeUndefined();
    } finally {
      off.close();
    }
  });
});
