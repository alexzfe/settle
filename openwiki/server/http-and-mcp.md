---
type: subsystem
title: "HTTP server: MCP endpoint, web API and live events"
description: The @settle/server Hono app — its route table, the stateless per-Home MCP endpoint and which operations it exposes, the JSON /api/<operation> adapter and multipart routes, the /events SSE stream with Agent activity, static pages and exports, and serving the built web UI.
tags: [server, hono, mcp, api, sse, events, routes]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-c0d9cdc5879f7d9ea42d9028
    resource: repo://packages/server/src/agent-activity.ts
  - id: openwiki-source-025ac13d5542b75363993f74
    resource: repo://packages/server/src/api.ts
  - id: openwiki-source-14c7fc2cd7605010c868d4c7
    resource: repo://packages/server/src/app.ts
  - id: openwiki-source-02bb2bca97eaa7e2abe7801c
    resource: repo://packages/server/src/events.ts
  - id: openwiki-source-806d356e983a35b4aeed3d2b
    resource: repo://packages/server/src/mcp.ts
  - id: openwiki-source-488ee8b277c583ce3b927f31
    resource: repo://packages/server/src/pages.ts
  - id: openwiki-source-9c7fc804ace0299ef900862c
    resource: repo://packages/server/src/server.ts
  - id: openwiki-source-c570bdf5903a6eedca3d6385
    resource: repo://packages/server/src/web.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# HTTP server: MCP endpoint, web API and live events

`packages/server` is a thin adapter: every route ends in `core.run(...)`
([Operation registry](../architecture/operation-registry.md)). Startup, listeners and the LAN
listener are covered in [Architecture overview](../architecture/overview.md#runtime-startup) and
[Configuration, security and self-hosting](../operations/hosting-and-security.md).

## Route table (`createApp`, `app.ts`)

Middleware first: the **front door** Host/Origin guard on `*`, then login (`useAuth`) or
`useNoAuth`.

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ status: "ok" }`, open without login (container healthcheck) |
| `GET /api/auth_status` | Whether a login exists, so the UI can offer log-out |
| `POST /api/upload_blueprint`, `GET /api/get_blueprint_page` | Blueprint upload (multipart) and page PNGs |
| `POST /api/set_listing_photo`, `GET /api/get_listing_photo` | Listing picture in/out |
| `POST /api/add_photo`, `GET /api/get_photo` | Room/Item Photos and thumbnails |
| `POST /api/add_document`, `GET /api/get_document` | Item Documents |
| `GET /api/export_shopping_list`, `GET /api/export_guides` | Exports as files |
| `GET /api/home_folder_script` | The Home Folder shell script |
| `POST /api/:operation` | Every other web operation, JSON |
| `GET /guide/:slug` | Quick Guide phone page: by token, or by slug with `?home=` |
| `GET /events?home=` | Server-Sent Events |
| `ALL /mcp/homes/:home` | The Agent's MCP endpoint for one Home |
| everything else | Built web UI with history fallback |

## The web API

`handleApi` (`api.ts`) runs one operation as the `web` caller:

- unknown names and **Agent-only** operations → 404 (an Agent tool is never callable over the web);
- operations with their own route (uploads, file downloads) → 405 naming that route;
- the body must be `Content-Type: application/json` (415 otherwise) — a cross-site form cannot send
  that type without a CORS preflight, which never passes;
- a `CoreError` becomes `{ error: { code, message } }` with an HTTP status from `statusOf` (409 by
  default for codes not mapped).

Multipart handlers parse the form, call the matching operation and answer the same way. Byte
responses for versioned URLs are cached immutably ([Media](../domain/media.md)).

## The MCP endpoint

`mcp.ts` serves the Model Context Protocol over Streamable HTTP, **statelessly**: each POST builds a
fresh `McpServer` and transport bound to the Home in the URL, handles the request with JSON
responses, and closes. Non-POST methods get 405 (no standalone SSE stream, no MCP session to
delete). The transport's own DNS-rebinding protection allows `127.0.0.1:<port>`,
`localhost:<port>` and the public origin.

- `mcpTools(core)` exposes every operation whose surface isn't `web`, in registry order, and throws
  at startup if a writing tool lacks a `session` input — the Settle Session travels as an argument.
- Each tool is registered with its description, zod input schema and annotations
  `readOnlyHint` / `openWorldHint: false`; titles are derived from names (`open_session` → "Open
  session").
- A call records Agent activity, runs `core.run` with a Session caller, and returns a text block
  (`tool.text(output)` or JSON) followed by any image blocks. `structuredContent` is never used,
  because it makes Codex drop the images.
- A `CoreError` is returned as an `isError` result with its message, which tells the Agent what to
  fix; other errors propagate.
- `SERVER_INSTRUCTIONS` restates core rules as a compaction backstop
  ([Skills and plugin](../agent/skills-and-plugin.md#the-mcp-side)).

`tools-list.ts` and `scripts/write-tools-json.ts` dump `tools/list` into the eval mocks'
`_tools.json`.

## Live events

`GET /events?home=<slug>` (`events.ts`) is an SSE stream with two event types:

- `change` — `{ home, recordKind, recordSlug }` for each record a committed write changed in that
  Home (from core's event bus);
- `agent` — `{ home, at }` for each MCP tool call for that Home; the last one is also sent on
  connect.

It sets `X-Accel-Buffering: no` so reverse proxies such as nginx pass events through immediately,
writes a comment first to flush headers, serialises writes, and sends a keep-alive comment every
25 s. `AgentActivity` (`agent-activity.ts`) holds the last tool call per Home **in memory only** —
the stateless MCP endpoint can't know whether an Agent is connected, so the last call is the
truthful signal. The web UI's use of these is in [Web UI](../web/ui.md).

On shutdown, `closeAll` calls `closeAllConnections()` because open `/events` streams would
otherwise keep `close()` waiting forever.

## Static pages and the web UI

- `pages.ts` serves rendered files (exports, Quick Guide pages, message pages) with `FILE_HEADERS`:
  a CSP of `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:` and
  `form-action 'none'`, `nosniff`, `no-referrer` and `no-store`.
- `web.ts` serves `packages/web/dist` statically with a history fallback to `index.html` for client
  routes, never swallowing `/api`, `/events`, `/mcp`, `/health` or `/guide`. `index.html` is re-read
  on each request so a rebuilt UI appears without restart. Without a build, `/` shows a placeholder.

## Tests

`app.test.ts` covers the web UI serving, web API, search index, Item page, Photos, Documents, the
MCP endpoint, Purchases, Decisions, Blueprints, DNS-rebinding protection and the Home Folder script;
`server.test.ts`, `auth.test.ts`, `lan.test.ts`, `pages.test.ts`, `agent-activity.test.ts` and
`config.test.ts` cover the rest.
