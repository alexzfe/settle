import { type Core, CoreError, type ExportResult } from "@idh/core";
import type { Context } from "hono";
import { answer, statusOf } from "./api.js";

// The pages and files the server serves as they are, rendered by core from stored data: the
// Quick Guide's phone page and the Shopping section's exports.

const web = { caller: { kind: "web" } } as const;

/**
 * Nothing on these pages may run or load (no JavaScript, no outside resources, no forms), and
 * the address they came from, which holds a LAN page's token, is never sent on.
 */
export const FILE_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

/** A rendered file as it is; with a disposition, under its file name. */
export function fileResponse(
  c: Context,
  result: ExportResult,
  disposition?: "inline" | "attachment",
): Response {
  const headers: Record<string, string> = { ...FILE_HEADERS, "content-type": result.mimeType };
  if (disposition) {
    headers["content-disposition"] = `${disposition}; filename="${result.fileName}"`;
  }
  return c.body(result.text, 200, headers);
}

/** A page with one message on it: a refused guide page, or the LAN listener's 404. */
export function messagePage(message: string): string {
  const text = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Quick Guide</title>",
    "</head>",
    "<body>",
    `<p>${text}</p>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * GET /guide/<decision slug>?home=<home slug>: the Quick Guide's phone page, HTML with no
 * JavaScript. A refusal is a page with core's message, under its status.
 */
export async function handleGuidePage(core: Core, c: Context): Promise<Response> {
  const home = c.req.query("home");
  const input = { ...(home === undefined ? {} : { home }), decision: c.req.param("slug") ?? "" };
  try {
    return fileResponse(c, await core.run("get_guide_page", web, input));
  } catch (error) {
    if (!(error instanceof CoreError)) throw error;
    return c.html(messagePage(error.message), statusOf(error.code), FILE_HEADERS);
  }
}

/**
 * GET /api/export_shopping_list?home=<slug>&format=html|csv and
 * GET /api/export_guides?home=<slug>&format=html|markdown[&decision=<slug>]: the file itself, so
 * a link can open it. A page to print opens in the browser; CSV and Markdown download. A refusal
 * answers { error: { code, message } }, as on the rest of the web API.
 */
export async function handleExport(
  core: Core,
  c: Context,
  name: "export_shopping_list" | "export_guides",
): Promise<Response> {
  const { home, format, decision } = c.req.query();
  // Core validates the query: a missing or unknown field is refused with 400.
  const input = { home, format, ...(decision === undefined ? {} : { decision }) };
  return answer(c, async () => {
    const result = (await core.run(name, web, input)) as ExportResult;
    const inline = result.mimeType.startsWith("text/html");
    return fileResponse(c, result, inline ? "inline" : "attachment");
  });
}
