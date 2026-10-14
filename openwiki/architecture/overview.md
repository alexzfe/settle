---
type: architecture
title: Architecture overview
description: Settle's pnpm monorepo — core domain logic, a Hono server with an MCP endpoint and web API, a React web UI, and Skills built into a Claude Code plugin — and how a change flows from the Agent or the UI through core into SQLite and back out as live updates.
tags: [architecture, monorepo, core, server, web, mcp, data-flow]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-b6d4dbadc290acfd0ace4931
    resource: repo://packages/core/package.json
  - id: openwiki-source-be80b8bb0c3f3a4106e1484a
    resource: repo://packages/server/package.json
  - id: openwiki-source-02bb2bca97eaa7e2abe7801c
    resource: repo://packages/server/src/events.ts
  - id: openwiki-source-d5e559b09ba22d4c297fe6a1
    resource: repo://packages/server/src/main.ts
  - id: openwiki-source-9c7fc804ace0299ef900862c
    resource: repo://packages/server/src/server.ts
  - id: openwiki-source-3b6b890a931b0c064dd628de
    resource: repo://packages/web/src/api.ts
  - id: openwiki-source-1948587955930f84e89ab43a
    resource: repo://packages/web/src/liveUpdates.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Architecture overview

Settle keeps a detailed record of a user's Home and helps them make design and purchase Decisions
by talking it through with **their own** Agent (Claude Code). Settle runs no model: it is a record
keeper with an MCP endpoint and a web UI. The domain vocabulary (Home, Room, Decision, Settled,
Requirement, Quick Guide, …) is defined in `CONTEXT.md` and used verbatim in code.

## Packages

A pnpm workspace (`pnpm-workspace.yaml`, `packages/*`, with a shared dependency catalog), Node 26+:

| Package | Role |
| --- | --- |
| `packages/core` (`@settle/core`) | All domain logic: the operation registry, zod schemas, SQLite store and migrations, Blueprint rendering (mupdf), text rendering for the Agent, exports. No HTTP. |
| `packages/server` (`@settle/server`) | A Hono app on `@hono/node-server`: the per-Home MCP endpoint, the `/api/*` web API, `/events` SSE, the Quick Guide phone pages, login, and static serving of the built web UI. |
| `packages/web` (`@settle/web`) | React + Vite + react-query + react-router UI. Imports only types from core. |
| `packages/skills` (`@settle/skills`) | Skill sources and the shared protocol; its build writes `plugin/`. |
| `plugin/` | The generated Claude Code plugin (Skills) plus replay and live evals. |

Core's package exports a `@settle/source` condition pointing at `src/index.ts`, which the server's
`dev` script uses (`tsx --conditions=@settle/source`) to run against core's sources without a build.

## Core plus thin adapters

```
 Claude Code ──MCP POST /mcp/homes/<slug>──┐
                                           ├─► Core.run(name, caller, input) ─► handler ─► store (SQLite)
 Browser ─────POST /api/<operation>────────┘                                     │
    ▲                                                                            ▼
    └──────────── GET /events (SSE) ◄── EventBus ◄── change log + commit ◄── context.write
```

Every capability is one core **operation**; the MCP server and the web API both call
`Core.run` and contain no domain rules ([Operation registry](operation-registry.md)). An operation's
`surface` decides whether the Agent, the web, or both get it; the web never gets Agent-only text
and the Agent never sees the change log.

## Runtime startup

`packages/server/src/main.ts` loads configuration from the environment (exiting with a plain
message on a bad setting), then `startServer`:

1. creates the data dir and starts listening (a LAN listener too, in LAN mode), answering 503 until
   ready — the bound port must be known first because the MCP endpoint checks Host headers against
   it and port 0 picks one at listen time;
2. opens core on `<dataDir>/settle.sqlite`, which migrates the database;
3. builds the Hono app (`createApp`) and, in LAN mode, the guide-only LAN app.

SIGINT/SIGTERM close the server gracefully. See [HTTP server](../server/http-and-mcp.md) and
[Configuration, security and self-hosting](../operations/hosting-and-security.md).

## End-to-end flows

**Agent write.** The user runs `claude` in a Home Folder, whose `.mcp.json` points at
`/mcp/homes/<slug>` ([Skills and plugin](../agent/skills-and-plugin.md)). A Skill calls
`open_session`, then, say, `save_room` with that Session id. The stateless MCP handler builds a
fresh server per request, records the Agent's activity, and calls `core.run` with a Session caller
and the Home from the URL. The handler validates, writes through `context.write` in one transaction
(logging each field change), and returns a result whose `text` — a receipt — is what the Agent
reads.

**Live UI.** After commit, core publishes one change event per changed record. The browser's
`/events?home=<slug>` stream receives it, and `packages/web/src/liveUpdates.ts` maps the record
kind to the react-query keys that show it and refetches only those. Agent tool calls also stream
as `agent` events, which drive the "Agent is working" status in the UI ([Web UI](../web/ui.md)).

**Web write.** The UI posts JSON to `/api/<operation>`; core runs it as the `web` caller (origin
`"web"` in the change log), using the operation's `webInput` schema when it has one.

## Where to go next

- Data and files: [Persistence](persistence.md).
- Domain: [Home model](../domain/home-model.md), [Decisions](../domain/decisions.md),
  [Purchasing](../domain/purchasing.md), [Media](../domain/media.md),
  [Sessions and Agent text](../domain/sessions-and-agent-text.md).
- Verification: [Tests, evals and demo data](../testing/tests-and-evals.md).
