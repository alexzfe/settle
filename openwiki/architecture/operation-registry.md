---
type: architecture
title: Operation registry and the write path
description: How @settle/core defines every operation once, how Core.run validates input and dispatches for the Agent or the web UI, how Sessions are checked, and how a write becomes one transaction, change-log rows and event-bus notifications.
tags: [core, operations, registry, write-path, change-log, events, errors]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-00f9d5e70a421c8df1ce07d2
    resource: repo://packages/core/src/core.ts
  - id: openwiki-source-6acbaaa46d6a5fea44f67498
    resource: repo://packages/core/src/errors.ts
  - id: openwiki-source-94123d1ea5a7f267de907d43
    resource: repo://packages/core/src/events.ts
  - id: openwiki-source-134f4a2d465cc6e54275d9a7
    resource: repo://packages/core/src/operations/changes.ts
  - id: openwiki-source-234b516a80785a5e75900dbc
    resource: repo://packages/core/src/operations/scope.ts
  - id: openwiki-source-1ce56a75aa2c0538d40b59cc
    resource: repo://packages/core/src/operations/writer.ts
  - id: openwiki-source-8bbbc3908b98674588288bd8
    resource: repo://packages/core/src/registry.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Operation registry and the write path

`@settle/core` is the whole application logic. The server's MCP endpoint and web API are thin
adapters over a single registry of **operations**; neither adapter contains domain rules.

## Defining an operation

Each operation is a `defineOperation({...})` object (`packages/core/src/registry.ts`) with:

- `name` — the tool/API name (`save_room`, `get_room_sheet`, …);
- `description` — for Agent operations, the MCP tool description, "written for a new hire";
- `input` — a zod object schema; optionally `webInput` when the web UI passes something different
  (typically the Home slug instead of a Session);
- `readOnly` and `surface` (`"agent"`, `"web"` or `"both"`), which decide which adapter exposes it;
- `handler(context, input)`;
- optional `text(output)` — the text the Agent reads, usually rendered by `render.ts` — and
  `images(output)` for tools such as `view_images` that return picture blocks.

`packages/core/src/core.ts` collects them into one `operations` map whose declaration order is the
order the Agent's tools are listed in: reads first, then writes, then `close_session`. Operation
modules live in `packages/core/src/operations/` grouped by domain (homes, rooms, items, decisions,
purchases, photos, documents, shopping, …), with all zod schemas and result types in
`operations/schemas.ts`.

## Calling: `createCore` and `Core.run`

`createCore(options)` opens the store (a SQLite file or `:memory:`), creates the event bus, and
builds a shared base context of ports: `store`, `files`, `renderPdf` (mupdf), `fetchImage`, `dataDir()`
(a temporary folder removed by `close()` when none is given), `now()`, `random()`, and the `origin`
the app names itself by. Clock, randomness, PDF rendering and image fetching are injectable so tests
never touch the network or real time.

`Core.run(name, context, input)`:

1. looks up the operation (unknown name → `not_found`);
2. picks `webInput` when the caller is the web and the operation has one, else `input`;
3. validates with `safeParse` and turns zod issues into a `validation` error naming each path;
4. builds the `OperationContext`: the caller (with the Session taken from the input's `session`
   argument) and the Home — from the adapter (the MCP URL) or else the input's `home` field;
5. awaits the handler.

### Callers and Sessions

`Caller` is `{ kind: "session", session? }` for the Agent or `{ kind: "web" }` for the UI. The Agent
passes its Settle Session as a normal tool argument; if the adapter and input name different
Sessions the call is refused. Inside handlers, `operations/scope.ts` provides:

- `requireHome` — refuses a missing or unknown Home slug, telling a Home Folder to be set up again;
- `requireSession` — refuses a web caller, a missing Session (`session_required`), a Session of a
  different Home (reported as `unknown_session`, so the Agent never learns other Homes exist), and,
  for writes, a closed Session (`session_closed`);
- `originOf` — the change-log origin: the Session's slug, or `"web"`.

### Errors

Every refusal is a `CoreError` with a `code` (`validation`, `not_found`, `weaker_provenance`,
`illegal_transition`, `reason_required`, `not_settled`, …; see `errors.ts`) and a `message` written
for whoever reads it — the Agent or the user — saying what to do next. The MCP adapter returns the
message as an `isError` tool result; the web API maps the code to an HTTP status.

## The write path

Writes go through `context.write(origin, fn)`, implemented in `createCore`:

- `fn` runs inside `store.transaction` (synchronous — so anything slow, such as fetching a Listing
  photo, happens before the write, never inside it);
- `fn` receives a `log(change)` callback; each change is appended to the change log with the same
  timestamp for the whole write, the origin, record kind/id/slug, field, old/new values and an
  optional reason;
- after the transaction commits, one `ChangeEvent { home, recordKind, recordSlug }` per distinct
  changed record is published on the `EventBus`. Nothing is published for a refused write.

`EventBus.publish` isolates listeners: one throwing listener is logged and the rest still run, since
the write has already committed. The server's `/events` stream is the main subscriber
([HTTP server](../server/http-and-mcp.md)).

### The `Writer` helper

Agent writes that touch many fields use `operations/writer.ts`'s `Writer`. Its `create`, `patch`,
`link` and `archive` methods log each change and collect **receipt lines** and **refused parts**.
`patch` applies the Provenance rule to every Measurement and Color: an incoming value of weaker
Provenance than the stored one is refused (and reported in the receipt) unless the write carries an
override reason, which is then logged with the change. Unchanged values are skipped, so re-saving a
Room logs nothing. Before the receipt is rendered, the Writer flags every Purchase whose Requirement
rests on a value this write changed (see [Decisions](../domain/decisions.md)).

The change log is readable only by the web (`get_change_log`, surface `web`, newest first, default
200 rows); it is never given to the Agent.

## Tests

`packages/core/src/operations.test.ts` covers the registry end to end, including "the change log and
the event bus": every write is logged with its origin, one event is published per changed record,
none for a refused write, and unsubscribed listeners stop hearing events.

Related: [Persistence](persistence.md), [Sessions and Agent-facing text](../domain/sessions-and-agent-text.md).
