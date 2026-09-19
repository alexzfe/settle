import {
  type Core,
  CoreError,
  type CoreErrorCode,
  homeFolderScript,
  type OperationInput,
} from "@settle/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Every other refusal is a rule refusal: 409.
const STATUS: Partial<Record<CoreErrorCode, ContentfulStatusCode>> = {
  validation: 400,
  reason_required: 400,
  city_not_found: 400,
  no_pages: 400,
  unsupported_file: 400,
  not_found: 404,
  unknown_session: 404,
};

/** The web operations that are not JSON in and out, and the routes that serve them. */
const OWN_ROUTES: Record<string, string> = {
  upload_blueprint:
    "POST /api/upload_blueprint, as multipart/form-data with the fields home, file, and label",
  get_blueprint_page: "GET /api/get_blueprint_page?home=<slug>&blueprint=<slug>&page=<number>",
  get_guide_page: "GET /guide/<decision slug>?home=<home slug>, as a page",
  set_listing_photo:
    "POST /api/set_listing_photo, as multipart/form-data with the fields home, listing, and " +
    "either file or url",
  get_listing_photo: "GET /api/get_listing_photo?home=<slug>&listing=<slug>&v=<photoVersion>",
};

const web = { caller: { kind: "web" } } as const;

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
  const route = OWN_ROUTES[name];
  if (route) {
    return c.json(
      { error: { code: "validation", message: `${name} is served by ${route}.` } },
      405,
    );
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
  return answer(c, async () => c.json((await core.run(name, web, input)) as object));
}

/**
 * POST /api/upload_blueprint: a Blueprint file as multipart/form-data, with the fields `home`
 * (the Home's slug), `file` (a PDF, PNG, or JPEG), and `label` (optional). Answers
 * { blueprint } as JSON, or a refusal like every other operation: no_pages or unsupported_file
 * with 400. A browser form from another site is refused by its Origin, like every route.
 */
export async function handleUpload(core: Core, c: Context): Promise<Response> {
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) {
    return c.json(
      { error: { code: "validation", message: `Send it by ${OWN_ROUTES.upload_blueprint}.` } },
      415,
    );
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: { code: "validation", message: "The form could not be read." } }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    const message = "Choose a file to upload: a PDF, PNG, or JPEG of the plan.";
    return c.json({ error: { code: "validation", message } }, 400);
  }
  const home = form.get("home");
  const label = form.get("label");
  const input = {
    home: typeof home === "string" ? home : undefined,
    file: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name || "blueprint",
    ...(typeof label === "string" && label.trim() !== "" ? { label } : {}),
  };
  return answer(c, async () =>
    c.json(await core.run("upload_blueprint", web, input as OperationInput<"upload_blueprint">)),
  );
}

/**
 * POST /api/set_listing_photo: the board's paste box, as multipart/form-data with the fields
 * `home`, `listing`, and either `file` (the pasted JPEG, PNG, or WebP) or `url` (an image URL for
 * the platform to fetch). Answers { decision, listing } as JSON. Unlike the fetch record_listing
 * makes, a failure here is reported, since the user is waiting on it.
 */
export async function handleListingPhotoUpload(core: Core, c: Context): Promise<Response> {
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) {
    return c.json(
      { error: { code: "validation", message: `Send it by ${OWN_ROUTES.set_listing_photo}.` } },
      415,
    );
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: { code: "validation", message: "The form could not be read." } }, 400);
  }
  const file = form.get("file");
  const home = form.get("home");
  const listing = form.get("listing");
  const url = form.get("url");
  const input = {
    home: typeof home === "string" ? home : undefined,
    listing: typeof listing === "string" ? listing : undefined,
    ...(file instanceof File ? { file: new Uint8Array(await file.arrayBuffer()) } : {}),
    ...(typeof url === "string" && url.trim() !== "" ? { url } : {}),
  };
  return answer(c, async () =>
    c.json(await core.run("set_listing_photo", web, input as OperationInput<"set_listing_photo">)),
  );
}

/**
 * GET /api/get_listing_photo?home=<slug>&listing=<slug>&v=<photoVersion>: the stored picture with
 * the type sniffed from its own bytes. `v` is ignored here; it exists so the browser cache can
 * hold the bytes for a year and still notice a replacement. A refusal answers JSON, as elsewhere.
 */
export async function handleListingPhoto(core: Core, c: Context): Promise<Response> {
  const { home, listing, v } = c.req.query();
  return answer(c, async () => {
    const { data, mimeType } = await core.run("get_listing_photo", web, {
      home,
      listing,
      v,
    } as OperationInput<"get_listing_photo">);
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      "content-type": mimeType,
      // The bytes at one version never change; a new version is a new URL.
      "cache-control": v ? "private, max-age=31536000, immutable" : "no-cache",
    });
  });
}

/**
 * GET /api/get_blueprint_page?home=<slug>&blueprint=<slug>&page=<number>: one rendered page as
 * image/png, so an <img> can show it. A refusal answers JSON, as elsewhere.
 */
export async function handleBlueprintPage(core: Core, c: Context): Promise<Response> {
  const { home, blueprint, page } = c.req.query();
  // Core validates the query: a missing or malformed field is refused with 400.
  const input = { home, blueprint, page: page === undefined ? undefined : Number(page) };
  return answer(c, async () => {
    const { data, mimeType } = await core.run(
      "get_blueprint_page",
      web,
      input as OperationInput<"get_blueprint_page">,
    );
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      "content-type": mimeType,
      "cache-control": "no-cache",
    });
  });
}

/**
 * GET /api/home_folder_script?home=<slug>: the POSIX sh script the Home Folder command pipes into
 * sh, which writes the folder's two files (core's home-folder.ts). A refusal is plain text under
 * its status, which `curl -f` reports as the failed request.
 */
export async function handleHomeFolderScript(core: Core, c: Context): Promise<Response> {
  const home = c.req.query("home");
  try {
    const { origin } = await core.run("home_folder_setup", web, { home } as { home: string });
    return c.body(homeFolderScript(origin, home as string), 200, {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    });
  } catch (error) {
    if (!(error instanceof CoreError)) throw error;
    return c.text(`${error.message}\n`, statusOf(error.code));
  }
}

/** Runs `respond`, turning core's refusal into { error: { code, message } } with its status. */
export async function answer(c: Context, respond: () => Promise<Response>): Promise<Response> {
  try {
    return await respond();
  } catch (error) {
    if (!(error instanceof CoreError)) throw error;
    const { code, message } = error;
    return c.json({ error: { code, message } }, statusOf(code));
  }
}

/** The HTTP status of core's refusal. */
export function statusOf(code: CoreErrorCode): ContentfulStatusCode {
  return STATUS[code] ?? 409;
}
