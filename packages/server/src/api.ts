import { type Core, CoreError, type CoreErrorCode } from "@idh/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Every other refusal is a rule refusal: 409.
const STATUS: Partial<Record<CoreErrorCode, ContentfulStatusCode>> = {
  validation: 400,
  city_not_found: 400,
  not_found: 404,
  unknown_session: 404,
};

/**
 * POST /api/<operation>: the web API. JSON in and out, called as the web UI, so no Session is
 * needed and the change log records the origin as "web". A refusal answers
 * { error: { code, message } }.
 */
export async function handleApi(core: Core, c: Context): Promise<Response> {
  const name = c.req.param("operation") ?? "";
  const operation = core.operations.find((each) => each.name === name);
  if (!operation || operation.surface === "agent") {
    const message = operation
      ? `${name} is a tool for the Agent, called over MCP; the web API does not offer it.`
      : `There is no operation "${name}".`;
    return c.json({ error: { code: "not_found", message } }, 404);
  }
  // A cross-site form can't send this content type without a CORS preflight, which never passes.
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    const message = "Send the input as JSON, with Content-Type: application/json.";
    return c.json({ error: { code: "validation", message } }, 415);
  }
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json({ error: { code: "validation", message: "The body is not valid JSON." } }, 400);
  }
  try {
    return c.json((await core.run(name, { caller: { kind: "web" } }, input)) as object);
  } catch (error) {
    if (!(error instanceof CoreError)) throw error;
    const { code, message } = error;
    return c.json({ error: { code, message } }, STATUS[code] ?? 409);
  }
}
