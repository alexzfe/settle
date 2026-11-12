import {
  type ClaudeConnect,
  type ConnectionSummary,
  type Core,
  CoreError,
  type CoreErrorCode,
  DOCUMENT_TOO_BIG,
  homeFolderScript,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  type OperationInput,
  PLUGIN_INSTALL,
} from "@settle/core";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { callerOf, keyedHomeOf } from "./caller.js";
import { inWords, type UploadLimiter } from "./limits.js";

/**
 * Every `code` an { error: { code, message } } answer carries: core's refusals, and the server's
 * own. `message` is always for the reader; `code` is for the web to branch on.
 */
export type ErrorCode =
  | CoreErrorCode
  /** Not logged in, or the Login, key or access token is no longer good: 401. */
  | "unauthorized"
  /** A Host or Origin the server doesn't serve: 403. */
  | "forbidden"
  /** Too many uploads, or wrong passwords, in too short a time: 429. */
  | "rate_limited"
  /** The operation is served by its own route under another method; `Allow` names it: 405. */
  | "method_not_allowed"
  /** A body that isn't JSON where JSON is taken: 415. */
  | "unsupported_media_type"
  /** A body over the route's cap: 413. */
  | "too_large"
  /** Something the server didn't expect; its log says what, under the id the message gives: 500. */
  | "internal";

/** The { error: { code, message } } answer, with its status and any headers. */
export function refuse(
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  headers?: Record<string, string>,
): Response {
  return c.json({ error: { code, message } }, status, headers);
}

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
  get_guide_page: "GET /guide/<decision slug>?home=<home slug>, or GET /guide/<token>, as a page",
  set_listing_photo:
    "POST /api/set_listing_photo, as multipart/form-data with the fields home, listing, and " +
    "either file or url",
  get_listing_photo: "GET /api/get_listing_photo?home=<slug>&listing=<slug>&v=<photoVersion>",
  add_photo:
    "POST /api/add_photo, as multipart/form-data with the fields home, item or room, file, " +
    "thumb, and optionally takenOn, caption, and with room a wall (its position)",
  get_photo:
    "GET /api/get_photo?home=<slug>&item=<slug>&photo=<id>&size=full|thumb&v=<version>, or " +
    "with room=<slug> in place of item for a Room's Photo",
  add_document:
    "POST /api/add_document, as multipart/form-data with the fields home, item, kind, file, and " +
    "optionally name",
  get_document: "GET /api/get_document?home=<slug>&item=<slug>&document=<id>&v=<version>",
  export_account: "GET /api/export_account, as a .zip file",
};

const MB = 1024 * 1024;

/**
 * Each upload route's cap on its whole body: what core stores at most, plus room for the rest of
 * the form. A body over it is answered 413, before it is read when its length says so, and as soon
 * as it passes the cap when it doesn't. A Blueprint has no cap in core; it gets a Document's.
 */
export const UPLOAD_CAPS = {
  "/api/upload_blueprint": MAX_DOCUMENT_BYTES + MB,
  "/api/set_listing_photo": MAX_IMAGE_BYTES + MB,
  // The photo and its thumbnail.
  "/api/add_photo": 2 * MAX_IMAGE_BYTES + MB,
  "/api/add_document": MAX_DOCUMENT_BYTES + MB,
} as const;

/**
 * Every file served from an upload (a Listing's picture, a Photo, a Document, a Blueprint page):
 * the browser takes its type as given, never sniffing one, and nothing in it may run or load, even
 * if it is opened on its own. The bytes come from the user and sit on Settle's own origin.
 */
export const SERVED_FILE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox; default-src 'none'",
};

/**
 * A PDF Document's headers: as above but not sandboxed, since Firefox's PDF viewer won't open a
 * sandboxed document. Core stores a PDF only when its bytes start `%PDF-`, and nosniff keeps the
 * browser to that type, so it can't be read as a page of Settle's.
 */
const SERVED_PDF_HEADERS: Record<string, string> = {
  ...SERVED_FILE_HEADERS,
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

/** The JSON API's cap: every web operation's input is a few fields. */
export const JSON_CAP = MB;

/**
 * POST /api/<operation>: the web API. JSON in and out, called as the Account logged in, so no
 * Session is needed and the change log records the origin as "web". A refusal answers
 * { error: { code, message } }.
 */
export async function handleApi(core: Core, c: Context): Promise<Response> {
  const name = c.req.param("operation") ?? "";
  const connections = CONNECTION_CALLS[name];
  const operation = core.operations.find((each) => each.name === name);
  if (!connections && (!operation || operation.surface === "agent")) {
    const message = operation
      ? `${name} is a tool for the Agent, called over MCP; the web API does not offer it.`
      : `There is no operation "${name}".`;
    return c.json({ error: { code: "not_found", message } }, 404);
  }
  const route = OWN_ROUTES[name];
  if (route) {
    const [method = "GET"] = route.split(" ");
    return refuse(c, 405, "method_not_allowed", `${name} is served by ${route}.`, {
      allow: method,
    });
  }
  // A cross-site form can't send this content type without a CORS preflight, which never passes.
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    const message = "Send the input as JSON, with Content-Type: application/json.";
    return refuse(c, 415, "unsupported_media_type", message);
  }
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json({ error: { code: "validation", message: "The body is not valid JSON." } }, 400);
  }
  if (connections) {
    const { caller } = callerOf(c);
    if (caller.kind !== "web") throw new Error("The web API is called by a Login");
    return answer(c, async () => c.json(connections(core, caller.account, input)));
  }
  return answer(c, async () => c.json((await core.run(name, callerOf(c), input)) as object));
}

/**
 * The Connections' web calls, which the server answers from core.accounts itself: they belong to
 * the OAuth server (oauth.ts), not to the Home model's operations. JSON in and out, like the rest.
 */
const CONNECTION_CALLS: Record<string, (core: Core, account: number, input: unknown) => object> = {
  list_connections: (core, account): { connections: ConnectionSummary[] } => ({
    connections: core.accounts
      .connections(account)
      .map(({ id, clientHost, createdAt, lastUsedAt }) => ({
        id,
        client: clientHost,
        createdAt,
        lastUsedAt,
      })),
  }),
  end_connection: (core, account, input): Record<string, never> => {
    const id = (input as { connection?: unknown } | null)?.connection;
    if (typeof id !== "number" || !core.accounts.disconnect(account, id)) {
      throw new CoreError("not_found", "There is no such Connection.");
    }
    return {};
  },
  claude_connect: (core): ClaudeConnect => claudeConnect(core.accounts.mcpUrl),
};

/** The Connect to Claude block's links, for the server's MCP URL. */
export function claudeConnect(mcpUrl: string): ClaudeConnect {
  return {
    mcpUrl,
    addConnectorUrl:
      "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Settle" +
      `&connectorUrl=${encodeURIComponent(mcpUrl)}`,
    // At user scope, so every folder gets both; the Home Folder's install is the project's.
    claudeCodeCommand:
      `claude mcp add --transport http --scope user settle ${mcpUrl} && ` +
      PLUGIN_INSTALL.replace("--scope project", "--scope user"),
  };
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
    c.json(
      await core.run("upload_blueprint", callerOf(c), input as OperationInput<"upload_blueprint">),
    ),
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
    c.json(
      await core.run(
        "set_listing_photo",
        callerOf(c),
        input as OperationInput<"set_listing_photo">,
      ),
    ),
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
    const { data, mimeType } = await core.run("get_listing_photo", callerOf(c), {
      home,
      listing,
      v,
    } as OperationInput<"get_listing_photo">);
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      ...SERVED_FILE_HEADERS,
      "content-type": mimeType,
      // The bytes at one version never change; a new version is a new URL.
      "cache-control": v ? "private, max-age=31536000, immutable" : "no-cache",
    });
  });
}

/**
 * POST /api/add_photo: a Photo of a Room or an Item, as multipart/form-data with the fields `home`,
 * `room` or `item`, `file` (the photo, shrunk by the browser), `thumb` (its thumbnail), and
 * optionally `takenOn` (YYYY-MM-DD), `caption`, and for a Room `wall` (the Wall's position).
 * Answers { photos } as JSON, the owner's Photos newest first.
 */
export async function handlePhotoUpload(core: Core, c: Context): Promise<Response> {
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) {
    return c.json(
      { error: { code: "validation", message: `Send it by ${OWN_ROUTES.add_photo}.` } },
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
  const thumb = form.get("thumb");
  if (!(file instanceof File) || !(thumb instanceof File)) {
    const message = "Send the photo as file and its thumbnail as thumb.";
    return c.json({ error: { code: "validation", message } }, 400);
  }
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const item = text("item");
  const room = text("room");
  const wall = text("wall");
  const takenOn = text("takenOn");
  const caption = text("caption");
  const input = {
    home: text("home"),
    ...(item ? { item } : {}),
    ...(room ? { room } : {}),
    ...(wall ? { wall } : {}),
    file: new Uint8Array(await file.arrayBuffer()),
    thumb: new Uint8Array(await thumb.arrayBuffer()),
    ...(takenOn ? { takenOn } : {}),
    ...(caption ? { caption } : {}),
  };
  return answer(c, async () =>
    c.json(await core.run("add_photo", callerOf(c), input as OperationInput<"add_photo">)),
  );
}

/**
 * GET /api/get_photo?home=<slug>&item=<slug>&photo=<id>&size=full|thumb&v=<version>, or with
 * room=<slug> in place of item: one Photo's bytes, or its thumbnail's. `v` is ignored here, as for
 * a Listing's picture: with it the browser may keep the bytes for a year, since a Photo's bytes
 * never change.
 */
export async function handlePhoto(core: Core, c: Context): Promise<Response> {
  const { home, item, room, photo, size, v } = c.req.query();
  return answer(c, async () => {
    const { data, mimeType } = await core.run("get_photo", callerOf(c), {
      home,
      item,
      room,
      photo,
      size,
      v,
    } as OperationInput<"get_photo">);
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      ...SERVED_FILE_HEADERS,
      "content-type": mimeType,
      "cache-control": v ? "private, max-age=31536000, immutable" : "no-cache",
    });
  });
}

/**
 * POST /api/add_document: a Document of an Item, as multipart/form-data with the fields `home`,
 * `item`, `kind`, `file` (a PDF as it came, or an image the browser shrank), and optionally
 * `name`. Answers { documents } as JSON, the Item's Documents by kind. A body plainly over the
 * cap is answered 413 by uploadGuard, before it is read, since the whole form is held in memory.
 */
export async function handleDocumentUpload(core: Core, c: Context): Promise<Response> {
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) {
    return c.json(
      { error: { code: "validation", message: `Send it by ${OWN_ROUTES.add_document}.` } },
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
    return c.json({ error: { code: "validation", message: "Send the Document as file." } }, 400);
  }
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const name = text("name");
  const input = {
    home: text("home"),
    item: text("item"),
    kind: text("kind"),
    file: new Uint8Array(await file.arrayBuffer()),
    ...(name ? { name } : {}),
  };
  return answer(c, async () =>
    c.json(await core.run("add_document", callerOf(c), input as OperationInput<"add_document">)),
  );
}

/**
 * GET /api/get_document?home=<slug>&item=<slug>&document=<id>&v=<version>: one Document's bytes,
 * offered inline under its name, so a PDF opens in the browser's own viewer. With `v` the browser
 * may keep the bytes for a year, since a Document's bytes never change.
 */
export async function handleDocument(core: Core, c: Context): Promise<Response> {
  const { home, item, document, v } = c.req.query();
  return answer(c, async () => {
    const { data, mimeType, fileName } = await core.run("get_document", callerOf(c), {
      home,
      item,
      document,
      v,
    } as OperationInput<"get_document">);
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      ...(mimeType === "application/pdf" ? SERVED_PDF_HEADERS : SERVED_FILE_HEADERS),
      "content-type": mimeType,
      // Core has taken out of the name anything that would break the quotes.
      "content-disposition": `inline; filename="${fileName}"`,
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
      callerOf(c),
      input as OperationInput<"get_blueprint_page">,
    );
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      ...SERVED_FILE_HEADERS,
      "content-type": mimeType,
      "cache-control": "no-cache",
    });
  });
}

/**
 * GET /api/home_folder_script?home=<slug>: the POSIX sh script the Home Folder command pipes into
 * sh, which writes the folder's two files (core's home-folder.ts). Reached by the Home's key, or
 * by a Login of the Account that owns the Home: its own ownership check, since core never sees the
 * key. A refusal is plain text under its status, which `curl -f` reports as the failed request.
 */
export async function handleHomeFolderScript(core: Core, c: Context): Promise<Response> {
  const home = c.req.query("home") ?? "";
  try {
    // The key opened this Home and no other, and is what the folder keeps. A Login opens only
    // its Account's own, and has no key to give: the folder gets a new one of its own.
    const keyed = keyedHomeOf(c);
    const key =
      keyed?.home === home
        ? keyed.key
        : (await core.run("home_folder_setup", callerOf(c), { home })).key;
    return c.body(homeFolderScript(core.accounts.origin, home, key), 200, {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    });
  } catch (error) {
    if (!(error instanceof CoreError)) throw error;
    return c.text(`${error.message}\n`, statusOf(error.code));
  }
}

/** GET /api/export_account: everything in the Account's Homes as one .zip, made as it is sent. */
export async function handleAccountExport(core: Core, c: Context): Promise<Response> {
  return answer(c, async () => {
    const { fileName, mimeType, stream } = await core.run("export_account", callerOf(c), {});
    return c.body(stream, 200, {
      "content-type": mimeType,
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    });
  });
}

/**
 * Before an upload route reads its body: the route's cap, then the Account's upload limits. A
 * refusal says when to try again, in plain words, with Retry-After.
 */
export function uploadGuard(cap: number, uploads: UploadLimiter): MiddlewareHandler {
  const capped = bodyLimit({
    maxSize: cap,
    onError: (c) => refuse(c, 413, "too_large", tooBig(c.req.path, cap)),
  });
  return async (c, next) => {
    const length = Number(c.req.header("content-length"));
    if (length > cap) {
      return refuse(c, 413, "too_large", tooBig(c.req.path, cap));
    }
    const { caller } = callerOf(c);
    if (caller.kind !== "web") throw new Error("An upload without a Login");
    // Without a length, the body is held to the cap, so counting the cap is the most it can be.
    const refused = uploads.take(
      caller.account,
      Number.isFinite(length) && length > 0 ? length : cap,
    );
    if (refused) {
      c.header("Retry-After", String(Math.ceil((refused.retryAt - Date.now()) / 1000)));
      const message =
        "That's more uploading than this server allows in a while (300 files an hour, 5 GB a " +
        `day, per account). Try again ${inWords(refused.retryAt)}.`;
      return refuse(c, 429, "rate_limited", message);
    }
    return capped(c, next);
  };
}

function tooBig(path: string, cap: number): string {
  if (path === "/api/add_document") return DOCUMENT_TOO_BIG;
  return `That upload is over ${Math.floor(cap / MB)} MB, the most this accepts.`;
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
