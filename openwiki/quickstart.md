---
type: quickstart
title: Quickstart
description: What Settle is, how its packages fit together, the commands to build, run and test it, and which wiki page to read for each kind of task.
tags: [quickstart, overview, routing, commands]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-39c3295efc089133e87a9c80
    resource: repo://CONTEXT.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-db34765ae3d656869538c268
    resource: repo://packages/core/src/files.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Quickstart

**Settle** keeps a detailed record of a user's Home — Rooms, Walls with lengths and facings,
Windows, Doors, Surfaces, everything they own — and helps them furnish it by talking it through with
their own Claude Code session. Choices are **Decisions** that move from Candidate to Settled; later
advice builds on Settled ones. For purchases it records **Requirements** traced to their reasons and
produces a **Quick Guide** for the shop. Settle runs no model itself: it is a server with an MCP
endpoint per Home, a web UI, and a Claude Code plugin of **Skills**.

The domain words are defined in `CONTEXT.md` and used exactly in code, tool descriptions and UI —
read it before naming anything. ("Settled" replaced "Locked"; the CONTEXT.md *Avoid* lists name the
words not to use.)

## Layout

| Path | What |
| --- | --- |
| `packages/core` | All domain logic: operations, schemas, SQLite store, migrations, Agent text |
| `packages/server` | Hono server: MCP endpoint, web API, SSE, login, static UI |
| `packages/web` | React + Vite UI |
| `packages/skills` | Skill sources and shared protocol (build → `plugin/skills`) |
| `plugin/` | The Claude Code plugin, plus `evals/` and `evals-live/` |
| `scripts/` | Live eval runner, demo and eval seed scripts |
| `deploy/`, `Dockerfile`, `SELF-HOSTING.md` | Container and hosting |

## Commands

Node 26+, pnpm 12+.

```sh
pnpm install
pnpm dev          # server (tsx watch on core sources) + Vite, together
pnpm build && pnpm start   # production build, app at http://127.0.0.1:4380
pnpm test         # Vitest, all packages
pnpm lint         # Biome
pnpm plugin:build # rebuild plugin/skills and replay eval histories
```

Evals call a model and cost money; they are run by hand (`pnpm plugin:eval`,
`pnpm plugin:eval:live`). See [Tests, evals and demo data](testing/tests-and-evals.md).

## Where to read for a task

| Task | Start with |
| --- | --- |
| Understand the overall shape and data flow | [Architecture overview](architecture/overview.md) |
| Add or change an operation / tool | [Operation registry and the write path](architecture/operation-registry.md) |
| Add a table, column or migration; file storage | [Persistence](architecture/persistence.md) |
| Rooms, Walls, Items, Constraints, Gaps, Provenance | [The Home model](domain/home-model.md) |
| Decision states, Basis, Flags, Conflicts, Fulfilment | [Decisions](domain/decisions.md) |
| Requirements, Listings, Quick/Full Guides, exports | [Purchasing](domain/purchasing.md) |
| Blueprints, Photos, Documents, Listing pictures | [Media](domain/media.md) |
| What the Agent reads; openings, Room Sheets, receipts | [Sessions and Agent-facing text](domain/sessions-and-agent-text.md) |
| Routes, MCP transport, web API, `/events` | [HTTP server](server/http-and-mcp.md) |
| Env vars, login, keys, LAN mode, Docker, CI | [Configuration, security and self-hosting](operations/hosting-and-security.md) |
| Pages, queries, live refetching, look | [Web UI](web/ui.md) |
| Skills, the plugin, Home Folders | [Skills and plugin](agent/skills-and-plugin.md) |
| Tests, snapshots, evals, demo data | [Tests, evals and demo data](testing/tests-and-evals.md) |

## Things that surprise newcomers

- **Rules live in core, not in the Skills.** The server refuses anything it can check (illegal
  transitions, weaker Provenance, missing reasons) with a message telling the Agent what to do;
  Skills handle judgement.
- **Agent text is a product surface.** Tool descriptions and `render.ts` output are what the Agent
  sees; snapshot tests pin them.
- **The MCP endpoint is stateless** and per Home (`/mcp/homes/<slug>`); the Settle Session is a tool
  argument, not an MCP session.
- **`plugin/skills` is generated** from `packages/skills`; don't edit it by hand.
- **Lengths are millimetres** in storage with Provenance; the UI and Agent show metres and
  centimetres.
- Settle is **AGPL-3.0-or-later** because of its mupdf dependency.
