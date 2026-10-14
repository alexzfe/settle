---
type: subsystem
title: Web UI
description: The @settle/web React and Vite app — its routes and pages per Home, the typed POST /api client and react-query keys, live refetching from the /events stream, the Agent status line and copy-a-prompt hand-offs, the find box, photo preparation, and the "paper and ink" design tokens.
tags: [web, react, vite, react-query, react-router, live-updates, ui]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-3b6b890a931b0c064dd628de
    resource: repo://packages/web/src/api.ts
  - id: openwiki-source-d952717f7ba616148cf6047b
    resource: repo://packages/web/src/App.tsx
  - id: openwiki-source-1948587955930f84e89ab43a
    resource: repo://packages/web/src/liveUpdates.ts
  - id: openwiki-source-88db471af001fbfc241cfe97
    resource: repo://packages/web/src/queries.ts
  - id: openwiki-source-c79aa5633271ba3e2c3e19bd
    resource: repo://packages/web/src/tokens.css
  - id: openwiki-source-431b936afc5e961b9bcbd029
    resource: repo://packages/web/src/ui/AgentStatus.tsx
  - id: openwiki-source-2ddd237ffb95ab07bd2ffb7d
    resource: repo://packages/web/src/ui/AskAgent.tsx
  - id: openwiki-source-ccecd3ec2865b64b4ea6f780
    resource: repo://packages/web/vite.config.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Web UI

`packages/web` is a React 19 single-page app built with Vite, using react-router for routes and
TanStack react-query for data. It imports **only types** from `@settle/core` (a dev dependency): the
operation input/output types are its contract with the server. The built `dist/` is served by the
server ([HTTP server](../server/http-and-mcp.md#static-pages-and-the-web-ui)).

The UI is largely a viewer and light editor: design work is done through the Agent, so many pages
offer a button that hands the user a ready prompt for it (see below).

## Routes (`App.tsx`)

`/` lists Homes (with a create form). Under `/homes/:home`: the Overview (`HomePage`), `about`
(Home Folder setup command), `rooms`, `rooms/:room`, `decisions`, `decisions/:decision`,
`blueprints/:blueprint/:page`, `shopping`, `items`, `items/:item`, `log` (change log) and
`sessions/:session`. A shared `Layout` wraps everything in the find box's provider; each Home's
layout opens the live-updates stream and shows the Agent status.

## Talking to the server

- `api.ts`: `call(name, input)` posts JSON to `/api/<name>`; refusals come back as
  `{ error: { code, message } }` and are thrown as `ApiError` with the server's reader-facing
  message. Uploads post multipart forms. With a password on the server, any 401 sends the browser
  to `/login?next=<here>`.
- `queries.ts`: one react-query key family per record kind (`homes`, `home`, `room`, `items`,
  `item`, `decisions`, `shopping`, `find-index`, `change-log`, …). A shorter key is a prefix of the
  longer ones, so invalidating `rooms(home)` refreshes every Room page of that Home.
- In development (`pnpm dev`), `vite.config.ts` proxies `/api`, `/events`, `/guide`, `/health`,
  `/login`, `/logout` to the server on `SETTLE_PORT` (default 4380), and the front door accepts the
  Vite dev origin because it's on this machine.

## Live updates (`liveUpdates.ts`)

`useLiveUpdates(home)` opens an `EventSource` on `/events?home=<slug>`:

- each `change` event invalidates exactly the queries that show that record kind
  (`queriesShowing`), plus the change log — e.g. a `door` change refetches every Room page and the
  Shopping section, since a Door appears on two Rooms and Measure-first lines read values;
- each `agent` event stores the time of the Agent's last tool call in the query cache;
- after a dropped connection reopens, every query of the Home is refetched; if the browser gives up
  (stream closed), an ordinary call is made so an expired login redirects to the login page.

It reports `connecting`, `live`, `reconnecting` or `stopped`, shown by `LivePill`.

## The Agent status and hand-offs

`ui/AgentStatus.tsx` is the sidebar footer line about the Agent. Because the MCP endpoint is
stateless, "connected" is unknowable; it combines the last tool call with open Sessions: a call in
the last 5 minutes with a Session open reads as working, 30 minutes idle as a Session left open,
otherwise the last Session. It re-renders every minute so states expire without events.

`ui/AskAgent.tsx` is the way back to the Agent: a button that copies a ready command such as
`claude "Using the Color Skill: pick a wall color (slug: living-room)"` (shell-escaped) and says
where to run it.

## Find

`find/Find.tsx` fetches the Home's `find_index` once and `find/match.ts` matches and ranks it locally
on every keystroke — names only, accent-folded, exact > starts-with > inside, retired (Archived or
Rejected) records last ([Sessions and Agent text](../domain/sessions-and-agent-text.md#the-webs-find-box)).

## Photos and Documents

`photoPrep.ts` readies pictures in the browser before upload — upright, 1600 px JPEG plus a 320 px
thumbnail for Photos, 2400 px for Document images, keeping only the EXIF date — and `PhotoCrop.tsx`
(react-image-crop) lets the user crop first ([Media](../domain/media.md#photos)).

## Look and feel

`tokens.css` defines the shared "paper and ink" look as CSS variables: warm off-white ground, ink
text, quiet chrome so the user's own colors carry the color, and one muted olive accent reserved for
the Settled state and the current nav item. Light is default; dark follows the system unless the
user picks a theme (`ThemeToggle` sets `data-theme` on `<html>`). Pages use CSS modules and the
small kit in `src/ui/` (Card, Section, Dialog, Callout, EmptyState, StateMark, Stars, FlagsStrip, …).
Fonts are Inter and Newsreader via Fontsource. The exported HTML files copy these values into their
own styles ([Purchasing](../domain/purchasing.md#shopping-views-and-exports)).

## Tests

Vitest with jsdom and Testing Library (`src/**/*.test.{ts,tsx}`): a test per page, plus
`liveUpdates.test.ts`, `api.test.ts`, `find/match.test.ts`, `photoPrep.test.ts` and helpers in
`testSupport.tsx`.
