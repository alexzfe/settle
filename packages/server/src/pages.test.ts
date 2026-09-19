// The routes that serve core's rendered files as they are, on the loopback listener: the Quick
// Guide's phone page at /guide/<slug>?home=<home>, and both exports by GET, besides their JSON
// operations on the web API.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureHome, type FixtureHome, type GetShoppingResult } from "@settle/core";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const PORT = 4380;

let fixture: FixtureHome;
let app: Hono;
beforeAll(async () => {
  fixture = await createFixtureHome();
  app = createApp({ core: fixture.core, port: PORT });
});
afterAll(() => fixture.core.close());

function post(operation: string, body: unknown) {
  return app.request(`/api/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the Quick Guide's phone page", () => {
  it("is served at /guide/<slug>?home=<home> as HTML with nothing on it allowed to run", async () => {
    const response = await app.request("/guide/wool-rug?home=fixture-home");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const page = await response.text();
    expect(page).toContain("<h1>Wool rug</h1>");
    expect(page).toContain("Measure first");
    expect(page).not.toContain("<script");
  });

  it("answers a refusal as a page: 400 without the Home or for a Decision that is no Purchase, 404 for one the Home lacks", async () => {
    const cases = [
      ["/guide/wool-rug", 400, "Pass `home`"],
      ["/guide/calm-evenings?home=fixture-home", 400, "Purchase Decisions only"],
      ["/guide/nothing?home=fixture-home", 404, "nothing"],
    ] as const;
    for (const [path, status, message] of cases) {
      const response = await app.request(path);
      expect(response.status, path).toBe(status);
      expect(response.headers.get("content-type"), path).toMatch(/^text\/html/);
      expect(await response.text(), path).toContain(message);
    }
  });

  it("is refused to a Host that is not this machine, like every loopback route", async () => {
    const response = await app.request("/guide/wool-rug?home=fixture-home", {
      headers: { host: "192.168.1.20:4380" },
    });
    expect(response.status).toBe(403);
  });

  it("leaves /guide to the server when the web UI is built", async () => {
    const dist = mkdtempSync(join(tmpdir(), "settle-pages-"));
    try {
      writeFileSync(join(dist, "index.html"), "<!doctype html><title>The UI</title>");
      const withUi = createApp({ core: fixture.core, port: PORT, webDist: dist });
      const guide = await withUi.request("/guide/wool-rug?home=fixture-home");
      expect(await guide.text()).toContain("<h1>Wool rug</h1>");
      const bare = await withUi.request("/guide/");
      expect(bare.status).toBe(404);
      expect(await bare.text()).not.toContain("The UI");
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe("the exports", () => {
  it("serves the Shopping List by GET: the printable page inline, the CSV as a download", async () => {
    const page = await app.request("/api/export_shopping_list?home=fixture-home&format=html");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-disposition")).toBe(
      'inline; filename="fixture-home-shopping-list.html"',
    );
    expect(await page.text()).toContain("<h1>Shopping List</h1>");

    const csv = await app.request("/api/export_shopping_list?home=fixture-home&format=csv");
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toBe(
      'attachment; filename="fixture-home-shopping-list.csv"',
    );
    expect(await csv.text()).toMatch(/^Purchase,Slug,Room,/);
  });

  it("serves the Shopping Guides by GET, every Purchase's as Markdown or one Purchase's as a page", async () => {
    const markdown = await app.request("/api/export_guides?home=fixture-home&format=markdown");
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(markdown.headers.get("content-disposition")).toBe(
      'attachment; filename="fixture-home-shopping-guides.md"',
    );
    expect(await markdown.text()).toContain("## Wool rug");

    const one = await app.request(
      "/api/export_guides?home=fixture-home&decision=wool-rug&format=html",
    );
    expect(one.headers.get("content-disposition")).toBe(
      'inline; filename="wool-rug-shopping-guides.html"',
    );
    expect(await one.text()).toContain("<h4>Size</h4>");
  });

  it("answers a refused export with { error: { code, message } } and its status", async () => {
    const format = await app.request("/api/export_guides?home=fixture-home&format=pdf");
    expect(format.status).toBe(400);
    expect(await format.json()).toMatchObject({ error: { code: "validation" } });
    const other = await app.request(
      "/api/export_guides?home=fixture-home&decision=calm-evenings&format=markdown",
    );
    expect(other.status).toBe(400);
    const missing = await app.request("/api/export_shopping_list?home=nowhere&format=csv");
    expect(missing.status).toBe(404);
  });

  it("offers get_shopping and both exports as JSON over POST, and points get_guide_page at its route", async () => {
    const shopping = (await (
      await post("get_shopping", { home: "fixture-home" })
    ).json()) as GetShoppingResult;
    expect(shopping.shoppingList).toEqual([]);
    expect(shopping.considering.map((each) => each.slug)).toEqual(["wool-rug"]);

    const csv = await post("export_shopping_list", { home: "fixture-home", format: "csv" });
    expect(await csv.json()).toMatchObject({
      mimeType: "text/csv; charset=utf-8",
      fileName: "fixture-home-shopping-list.csv",
    });

    const guidePage = await post("get_guide_page", { home: "fixture-home", decision: "wool-rug" });
    expect(guidePage.status).toBe(405);
    expect(await guidePage.text()).toContain("GET /guide/<decision slug>?home=<home slug>");
  });
});
