# Build plan: the PoC, slice by slice

**Status:** confirmed by the user on 2026-09-14, in the build-plan grilling. **Progress:** slice 0 done (scaffold and all four spikes, findings in [research/spikes/](research/spikes/)); slice 1 done, demo passed on the user's real Home on 2026-09-14 (plugin, MCP server, Home Folder, and the Skill all worked), tagged `slice-1`; slice 2 built on 2026-09-14 (core, server, web, and Skills tracks green: 144 tests, offline evals 6 of 6, every tool and web view driven through the built server), tagged `slice-2-code`; demo passed on 2026-09-14 on a copy of the user's real Home (migration 0002 on the real database, nine Rooms by interview, the Overview with Gaps, a refused weaker-Provenance write handled in the conversation, and an override), tagged `slice-2`; slice 3 built on 2026-09-14 (core, server, web, and Skills tracks green: 194 tests, offline evals 7 of 8, live evals 2 of 2, every tool and web route driven through the built server), tagged `slice-3-code`; the slice 3 demo waits for the user's real plan PDF. Next: the slice 3 demo, then slice 4, both in [handoff/slice-4.md](handoff/slice-4.md).

This plan turns the settled design into buildable work. Vocabulary is [CONTEXT.md](../CONTEXT.md); the finish line and architecture are in [poc-design.md](poc-design.md); what is recorded and what the Skills do are in [specs/home-model.md](specs/home-model.md) and [specs/skill-set.md](specs/skill-set.md); the four accepted decisions are in [adr/](adr/). Every choice made in the grilling that belongs in a spec was written into that spec, not only here.

## Ground rules for the build

- **CONTEXT.md is the vocabulary** in module names, table names, tool schemas, UI labels, and tests. A Room is a `room`, a Home Folder is a `home_folder`, a Decision state is `candidate | leaning | locked | rejected`.
- **Build within the ADRs.** No LLM calls in the platform (0001). One process serves the web UI and MCP over HTTP (0002). Walls from day one, in our own schema (0003). The server enforces data rules, Skills own judgment (0004).
- **Everything through the Agent.** The web UI is a viewer plus a few actions. Form-based editing of records is deferred to a UI design session after the finish line, along with the UI's look. Slices ship plain, unstyled pages that do only what their demo needs.
- **Rules test-first, renderings snapshotted, Skills evaluated.** Every server-enforced rule gets a test before its implementation. Every text the AI reads is snapshotted from the fixture Home. Every rule that lives only in Skill text gets a behaviour eval.
- **Each slice ends in a demo on the user's real Home.** The demo is the done-when check. Nothing in the next slice starts before it.
- **No token budgets.** Context is judged by relevance ([Context tiers](specs/home-model.md#context-tiers)). `/context` on the real Home is the check.
- **Edge cases wait.** Anything without a field goes in an "other" kind or a Note until a real Home needs more.

## Repository layout

pnpm workspaces (pnpm installed through mise next to Node 26), one TypeScript monorepo, strict mode everywhere.

```
package.json, pnpm-workspace.yaml
packages/core        domain types, the Core operations, the SQLite store, migrations, text renderers, the fixture Home
packages/server      the one Node process: MCP over HTTP, the web API, static UI, SSE
packages/web         React + Vite
packages/skills      Skill sources, the shared protocol, and the build step that writes plugin/
plugin/              the built plugin, checked in: .claude-plugin/plugin.json, skills/, evals/ (offline, mocked), evals-live/ (live smoke), test-support/live-server/ (helper plugin that only declares the server URL)
.claude-plugin/marketplace.json   at the repo root; plugin source "./plugin"
docs/
```

| Concern | Choice |
|---|---|
| Language | TypeScript, ESM, `strict` |
| Tests | Vitest, in every package |
| Lint and format | Biome |
| Dev runner | `tsx watch` for the server, Vite dev server for the UI with a proxy to the server |
| Schemas | Zod, one schema per operation input, shared by core, the web API, and the MCP tool definitions |
| Database | `node:sqlite` (built into Node 26, verified on the user's machine), no ORM, WAL mode, foreign keys on |
| MCP | `@modelcontextprotocol/sdk`, streamable HTTP, stateless |
| UI | React, React Router, TanStack Query, CSS modules, uncontrolled forms validated with the operation schemas |
| Plugin build | a script in `packages/skills` that inlines the protocol into each `SKILL.md` and writes `plugin/skills/` |

Commands: `pnpm dev` (server and UI with live reload), `pnpm test`, `pnpm build`, `pnpm plugin:build`, `pnpm plugin:eval` (offline suite: `claude plugin eval ./plugin --trust-plugin --ablation none --no-publish --model <pinned>`), `pnpm plugin:eval:live` (starts the server on a dedicated port with a temporary data dir seeded with the fixture Home, runs `evals-live/` with the helper plugin, stops the server), `pnpm start`.

Git: trunk on `main`, one commit per step, a tag per finished slice (`slice-1` … `slice-6`).

## The core operations module

This is the deep module of the build. Its interface is small and its implementation holds every rule.

**Interface.** One `Core` object whose operations are declared once in an **operation registry**: `{ name, input: ZodSchema, readOnly, handler }`. The operations are:

- the nineteen tool-shaped operations of the [MCP tool surface](specs/skill-set.md#mcp-tool-surface), named exactly as the tools
- the web-UI-only operations: `create_home`, `list_homes`, `set_up_home_folder`, `upload_blueprint`, `upload_photo`, `list_sessions`, `resolve_flag`, `resolve_conflict`, `set_decision_state` from the UI (same op, different caller), `list_decisions`, `get_shopping`, `export_shopping_list`, `export_guides`, `get_change_log`, and the read views each page needs

Every operation takes a **caller**: `{ kind: "session", sessionId }` or `{ kind: "web" }`. Inside core, the caller decides Home scoping (a Session's Home is fixed at `open_session`), whether a Session and reason are required, how the change log records the origin, and whether receipts are rendered.

Operations return **structured results**. Core also owns the **renderers** that turn those results into the text the AI reads: the Home Overview, the Home-wide Decisions block, a Room Sheet, `find_items` and `find_decisions` lines, a `get_decision` result, a write receipt, and the Quick Guide. Renderers live in core because the in-browser chat (ADR 0001) will need the same text as the MCP server, and because they are what the snapshot tests cover.

**Adapters at the seam.**

- The **MCP server** builds each tool from the registry entry: the Zod schema becomes the input schema, `readOnly` becomes `readOnlyHint`, the handler runs with a session caller, and the result goes through the tool's renderer. Image-returning tools (`view_images`) return `image` blocks and never `structuredContent`. Errors from core become `isError` results with the actionable message core wrote.
- The **web API** exposes every operation as `POST /api/<name>` with JSON in and out, with a web caller. Read views are just read operations.
- The **in-browser chat** and **hosting** plug in here later without touching core.

**Internal seams** (private to core, used by its own tests): the store (SQLite behind a small repository interface), the file store (uploads and rendered Blueprint pages), the clock, and the slug generator. One adapter each in the PoC; they are internal so tests can run on `:memory:` and a temp dir.

**What core enforces**, all with actionable errors: Home scoping; open-Session and non-empty-reason requirements for Agent state changes; the legal transitions table; Basis and Evidence existence within the Home; Archiving instead of deletion for referenced records; the Provenance rule and its `override_provenance` escape; flag cascades on Reopen, Reject, a Deviation from a *must*, and a change to a value a Requirement's reason points at; Door identity between two Rooms; Gap computation; the closed-Session refusal.

## The v1 database schema

Normalised tables, one per record kind in the Home model, all scoped by `home_id`. Slugs are unique per Home and never change ([Identifiers](specs/home-model.md#conventions)). Every table has an integer `id` for joins and a `slug` for the Agent and the UI.

**Values with Provenance** are stored as column triples: `<field>_mm`, `<field>_prov` (`measured | blueprint | estimated`), and `<field>_src` (JSON with `blueprint_id`, `page`, `printed`, present only for Blueprint Provenance). A field registry in core lists every such field per record kind, so the Provenance rule, receipts, and reason-field change detection enumerate them uniformly. Color values are one JSON shape (`name, brand, code, lrv, hex, provenance`) wherever a color appears.

| Table | Key columns beyond id, home_id, slug |
|---|---|
| `homes` | name, country, city, latitude, tenure, planned_stay, building_type, building_era, lift, lift door width and car depth (values), access width (value) and note, home_folder_path |
| `levels` | name, storey |
| `rooms` | level_id, name, functions (JSON list), outdoor, ceiling height (value), times_of_use (JSON list), windowless, archived_at, archived_reason |
| `walls` | room_id, position, length (value), facing, beyond_kind, beyond_room_id, label, obstruction, deciduous, archived_at |
| `windows` | room_id, wall_id (null for roof), roof_facing, kind, width, height, sill height, offset (values), glass, archived_at |
| `doors` | room_a_id, wall_a_id, side_b_kind, room_b_id, wall_b_id, clear width, height, offset (values), glazed, no_door, archived_at |
| `surfaces` | room_id, part (`walls | ceiling | floor | woodwork`), wall_id (whole-Wall exception), materials (JSON list of material + where), color (JSON), finish |
| `features` | room_id, kind, description, wall_id, position_note, width, height, depth (values), light (JSON), archived_at, archived_reason, replaced_by_feature_id |
| `items` | name, category, quantity, room_id, wall_id, position_note, width, depth, height (values), colors (JSON), materials (JSON), condition, brand, model, price, link, light (JSON), archived_at, archived_reason, replaced_by_item_id |
| `blueprints` | file_path, label, page_count, page_levels (JSON page → level_id) |
| `blueprint_pages` | blueprint_id, page, png_path (rendered cache) |
| `photos` | file_path, subject_kind, subject_id, taken_at, caption |
| `constraints` | text, archived_at, archived_reason |
| `notes` | text, created_at, archived_at |
| `sessions` | opened_at, closed_at, skills (JSON list), opening_sent (JSON, which blocks the opening has delivered), summary (JSON: changed, open, next) |
| `decisions` | kind, scope_room_id, title, statement, content (JSON validated per kind), state, created_at, fulfilled_at, fulfilment (JSON: what was done), archived_at |
| `decision_basis` | decision_id, basis_decision_id |
| `decision_evidence` | decision_id, source_kind (`note | session | decision`), source_id, stance (`supports | undermines`), note |
| `requirements` | decision_id, position, text, strength (`must | prefer`), reason_kind, reason_id, reason_field, archived_at |
| `listings` | decision_id, name, url, price, dimensions (JSON), photo_path |
| `listing_checks` | listing_id, requirement_id, result (`pass | fail | unknown`), note |
| `guides` | decision_id, quick_lines (JSON), full_markdown, written_at, requirements_changed_at |
| `deviations` | decision_id, requirement_id, text |
| `flags` | decision_id, cause (`reopened | rejected | deviation | value_changed`), source_kind, source_id, raised_at, cleared_at, resolution |
| `conflicts` | decision_id, session_id, description, raised_at, resolved_at, resolution |
| `state_changes` | decision_id, from_state, to_state, session_id, origin, reason, at |
| `change_log` | at, origin (session id or `web`), record_kind, record_id, field, old (JSON), new (JSON) |
| `settings` | key, value (units) |
| `migrations` | id, applied_at |

**Migrations:** numbered, forward-only SQL files in `packages/core/migrations/`, applied at startup inside a transaction and recorded in `migrations`. One file per slice; a slice may add a second if a demo forces a change. No down migrations in the PoC. The fixture Home is rebuilt from code on every test run, so schema changes never need data migration during the PoC.

## Live updates

Every committed write appends to `change_log` and publishes one event `{ home, recordKind, recordSlug }` on an in-process bus. The server exposes `GET /events?home=<slug>` as Server-Sent Events. The UI holds one connection per open Home, and TanStack Query invalidates the queries keyed by that record kind. No diffing, no client-side merge. Reconnect is the browser's built-in `EventSource` retry; on reconnect the UI refetches everything for the Home.

## The server process

- One process, `pnpm start`, port **4380**, overridable by `IDH_PORT`. Data in `$XDG_DATA_HOME/int-design-harness/` (database, `uploads/`, `rendered/`), overridable by `IDH_DATA_DIR`.
- Routes: `/` the built UI, `/api/<op>` the web API, `/events` SSE, `/mcp/homes/<slug>` the MCP endpoint, `/guide/<decision slug>` the phone-readable Quick Guide page.
- MCP: streamable HTTP, stateless, one endpoint per Home. The URL fixes the Home; the Session id is an explicit tool argument, never an MCP session. Read tools carry `readOnlyHint: true`. Server `instructions` are the 512-character backstop from the spec.
- **LAN mode** (slice 6): `IDH_LAN=1` also binds the LAN address and the Decision page shows the Quick Guide URL as a QR code. No auth; the user's own network.
- Starting the app automatically is deferred; a Skill's first step checks that the tools are present and tells the user to start the app if not.

## Plugin and Skills

- Sources in `packages/skills/`: `protocol.md` (the shared Session protocol) and one folder per Skill with its `SKILL.md` source. The build inlines the protocol under a fixed heading in each Skill body and writes `plugin/skills/<name>/SKILL.md`. Frontmatter is spec-only; `name` matches the directory.
- `plugin/.claude-plugin/plugin.json` carries `name: int-design-harness` and a `version` bumped on every release. The marketplace file at the repo root lists the plugin with source `./plugin`.
- The plugin ships only Skills. No `.mcp.json` in the plugin: the Home Folder's own `.mcp.json` names the server URL, and its `.claude/settings.json` enables the plugin for that folder only.
- Dev loop: `claude --plugin-dir ./plugin` in a Home Folder, `/reload-plugins` after `pnpm plugin:build`.
- Evals are hand-written under `plugin/evals/` in the `claude plugin eval` layout; results are gitignored.

## Testing

| Layer | Where | How |
|---|---|---|
| Server rules | `packages/core` | Vitest against the `Core` interface on `:memory:` SQLite. Written before the rule is implemented. One test per rule in the [enforcement table](specs/skill-set.md#rule-enforcement) and per row of the transitions table |
| What the AI reads | `packages/core` | Snapshot tests of every renderer from the fixture Home. A new line in a snapshot must be justified against the Context tiers in review |
| Adapters | `packages/server` | A handful of tests: an MCP tool call end to end, an API call, an SSE event after a write, the Home Folder files written |
| Skill triggers | `plugin/evals` | About 10 should-fire and 10 near-miss prompts per Skill, graded on whether the Skill fired. **The user revises every prompt set before it is committed** |
| Skill behaviour | `plugin/evals` | Replay cases from real transcripts, tools mocked, grading the next turn. One case per rule that lives only in Skill text |
| Live smoke | `plugin/evals-live` | Against a real server on a dedicated port with a seeded temporary data dir, reached through the helper plugin in `plugin/test-support/live-server/` |
| Acceptance | manual | The finish line on the user's real Home, plus one read-through of the real Overview asking of each line: would a designer need this? |

**The fixture Home** is fictional, built in code in `packages/core/fixture/`, and grows with each slice: two Levels, four Rooms of different shapes, one outdoor Room, Windows, Doors including one shared between two Rooms, Features, Items including one Unplaced and one Archived, Constraints, Notes, and from slice 4 on, Decisions in every state with Basis links, a flag, and a Conflict. Evals use it as the mocked server's data.

**Transcripts for behaviour evals** come from the demos: after each demo on the real Home, the conversation's JSONL is copied, cut to the turn under test, and its Home slug swapped for the fixture Home's.

## Slice 0: scaffold and spikes

Scope: the repository layout above, empty packages that build and test, CI-less for now. Then four time-boxed spikes, each a throwaway with its finding written back into this plan.

| Spike | What it proves | Risk it retires |
|---|---|---|
| 1. Home Folder packaging | A marketplace added from a local path, a Home Folder's `.claude/settings.json` and `.mcp.json`, and Claude Code asking once to approve the folder's HTTP server and once to install the plugin | The Home Folder design: per-folder plugin enablement and Home binding by URL. **Done:** [1-home-folder.md](research/spikes/1-home-folder.md). Binding by URL and per-folder enablement work. There is no install offer: trusting the folder registers the `directory` marketplace and loads the plugin from the source tree, so no version bump is needed in the PoC. The server prompt defaults to "continue without", so `set_up_home_folder` also writes `enabledMcpjsonServers`, leaving the trust dialog as the only question. Tools are named `mcp__int-design-harness__<tool>`. Headless runs connect without approval but need a tool grant |
| 2. Eval harness reach | `claude plugin eval` with `--mocks off` or `--allow-real-servers` calling a localhost HTTP MCP server, and what AskUserQuestion does headless | The live smoke suite and the grilling-Skill eval approach. **Done:** [2-eval-harness.md](research/spikes/2-eval-harness.md). Mocks under `evals/mocks/int-design-harness/` give tools their production names `mcp__int-design-harness__<tool>` with no grant needed. A server declared only in the run's working directory is never read, so live smoke loads a helper plugin `plugin/test-support/live-server/` (manifest plus `.mcp.json`) next to the real one, from its own eval dir `plugin/evals-live/`, with `--mocks off --allow-tools "mcp__plugin_live-server_int-design-harness__*"`, against a server on a dedicated port with a temporary data dir seeded with the fixture Home, never 4380. Always pass `--ablation none`. AskUserQuestion is absent in `claude -p`, so the model asks in plain text and the run ends with the question as `last_message`; replay of transcripts that contain AskUserQuestion calls works |
| 3. PDF to PNG | `mupdf` (WebAssembly) rendering a page at 2000 px in-process; fallback is shelling out to `pdftoppm`, installed here and one package in Docker | Blueprint conversion. **Done:** [3-pdf-to-png.md](research/spikes/3-pdf-to-png.md). `mupdf` wins: no native build, 40–80 ms per page, honours `/Rotate`, renders crops and returns the text layer with boxes in render coordinates, and opens JPEG and PNG Blueprints through the same call. Text reads down to about 5 pt whole-page and 4 pt in the crop. Every WASM object must be destroyed; a truncated PDF repairs to 0 pages and must be refused. **mupdf is AGPL**, which only bites if the platform is hosted for others; the fallback is the one wrapped module swapped for `pdftoppm` or pdfjs. Fixture PDFs are in `docs/research/spikes/fixtures/` |
| 4. Images in a tool result | Several PNG pages returned from one tool call under Claude Code's result cap, and how the model sees them | The `view_images` paging and `crop` design. **Done:** [4-images-in-results.md](research/spikes/4-images-in-results.md). At most 6 pages of 2000 px per call (about 3.9K tokens each) stay under the 25K cap with no truncation logic running; the text block naming the pages goes first; PNG, with JPEG q85 when a page's PNG is over 1 MB, keeps a result far under the 16 MB transport limit; the model read 12 px text on every full-size page, so `crop` stays as cheap insurance and tiles are not needed unless the real Blueprint says so |

Built-in SQLite is already verified and is off the list. HEIC conversion is deferred.

Done when: every spike has a written finding, and the layout builds and runs an empty server.

## Slice 1: walking skeleton

Threads every layer once, with the smallest possible Home model.

- **Core:** `create_home`, `list_homes`, `set_up_home_folder` (writes `.mcp.json` with server key `int-design-harness` and `.claude/settings.json` with `enabledPlugins`, the `directory` marketplace at this repo's absolute path, and `enabledMcpjsonServers`; never touches `settings.local.json`), `open_session`, `save_room` (name and Level only; every Home gets a default ground Level), `get_room_sheet`, `close_session`, `list_sessions`, the change log, the event bus, the slug generator, migration 0001.
- **Server:** the process, the API routes, `/events`, `/mcp/homes/<slug>` with the four tools and the SDK's DNS-rebinding protection turned on (any web page can reach localhost), static UI.
- **Web UI:** create Home, Home list and switcher, Home page with a live Room list and the Set up Home Folder action, Sessions list with summaries.
- **Skill text:** the protocol's opening and closing, and a Home Intake reduced to opening, recording Rooms by name, and closing with the three-part summary. The plugin build, manifest, and marketplace file.
- **Tests:** rules for Session scoping, the closed-Session refusal, and the Home Folder refusing a folder that holds another Home's `.mcp.json`; snapshots of the Overview (Rooms only), a Room Sheet, and a receipt; one mocked trigger eval and one live smoke case to prove both suites run; one server test of an SSE event after a write.
- **Demo:** create your Home in the browser, set up its Home Folder, run Claude Code there, accept the plugin and the server, describe one Room, and watch it appear in the browser. Close the Session and see its summary in the UI.

## Slice 2: the full Home model

- **Core:** `save_home`, the full `save_room` (Walls, Windows, Doors, Features, Surfaces), `save_items`, `set_constraints`, `save_note`, `find_items`, `search_notes`, the full Room Sheet, Gap computation, full receipts with remaining Gaps, the Provenance rule with `override_provenance`, Archiving of referenced records, Door identity, `get_change_log`. Migration 0002 adds the rest of the Home model.
- **Web UI:** Home page with facts, Levels, Constraints, Notes, and the Unplaced count; a read-only Room page with everything on its Room Sheet; an Items list; a read-only change log.
- **Skill text:** the full Home Intake procedure except the Blueprint stages: Home facts and the rented-permissions question, Room-by-Room Gaps, Items with confirmation, times of use, facts along the way as Constraints and Notes, the refused-write line.
- **Tests:** rules for the Provenance order, the override, Archive-not-delete, Door deduplication, Home scoping of every write; snapshots of the Overview with Gaps, a full Room Sheet, `find_items`, and a receipt with a refused part; Home Intake trigger evals (prompt sets to the user first); behaviour evals for "asks before adding a Constraint" and "saves only confirmed Items".
- **Demo:** Home Intake by interview records your whole Home. The Overview shows every Room with its Gaps, and one refused weaker-Provenance write is handled in the conversation.

## Slice 3: Blueprints

- **Core:** `upload_blueprint`, page rendering to PNG on upload with `mupdf` behind the file-store seam (page count, page size, render whole or a quarter, text lines; refuse 0 pages; destroy every WASM object), `view_images` with a page list (at most 6 pages per call, enforced in the schema, text block first, JPEG fallback for pages over 1 MB as PNG) and a `crop` quarter, Blueprint Provenance with page and printed text, `get_room_sheet` with `with_sources`, page-to-Level mapping through `save_home`. Migration 0003.
- **Web UI:** Blueprint upload on the Home page, a page viewer, and Blueprint sources shown next to values on the Room page.
- **Skill text:** the four Blueprint stages, one reply per Level, printed text only, always asking where north is.
- **Tests:** a conversion test on a fixture PDF, a tool result with two pages under the cap, snapshots of `with_sources` and of a Blueprint-Provenance receipt; a behaviour eval for "auto-fills only printed text".
- **Demo:** upload your real plan as a PDF. Home Intake reads it in the four stages, and the Room list and dimensions match what is printed, with Blueprint Provenance and the printed text visible in the browser. If small text is lost, tiles go on the list for a later slice.

## Slice 4: the Decision core

- **Core:** `save_decision` for every kind with per-kind content validation, `set_decision_state` with the transitions table and the reason rule, Basis and Evidence validation, the Design Direction automatically in every Basis, flag cascades on Reopen and Reject, `flag_conflict`, `find_decisions`, `get_decision`, `resolve_flag`, `resolve_conflict`, the opening's Home-wide Decisions block with join semantics and `resend`, `record_fulfilment` for Room use. Migration 0004.
- **Web UI:** Decisions list, a Decision page with Basis, Evidence, flags, and state actions with an optional reason, flags and Conflicts on the Home page with keep, Reopen, and Reject.
- **Skill text:** Design Direction; the protocol's asking-first, saying-what-changed, hand-off and parking, and after-compaction rules; the server `instructions` backstop.
- **Tests:** one test per transition row and per illegal transition, cascade on Reopen and Reject, Basis existence, no state change without Session and reason, the closed-Session refusal on a state change, the automatic Design Direction Basis; snapshots of the opening for Home Intake versus another Skill, a join, `find_decisions`, and `get_decision`; Design Direction trigger evals; behaviour evals for "no Lock without commitment", "asks before Reopen", "never re-proposes a Rejected Decision", "says what it changed".
- **Demo:** a Design Direction Session Locks the Direction and a Room Direction. You Reopen the Direction from the browser and the Room Direction shows a flag. You clear it by keeping.

## Slice 5: Color

- **Core:** Palette and Room color content, the rule that the Palette enters a Basis only when one of its colors is used, `record_fulfilment` updating a Surface, the Palette rendered in full in the opening. Migration 0005 if needed.
- **Web UI:** the Palette shown with swatches from the approximate hex on the Decision page and the Home page; Surface colors on the Room page.
- **Skill text:** Color, including the hand-off from Purchase for a color the Palette lacks.
- **Tests:** the Palette-in-Basis rule, Fulfilment changing the Surface with Provenance; snapshot of the Palette in the opening; Color trigger evals; a behaviour eval for "rests every color Decision on the Palette".
- **Demo:** a Color Session Locks a Palette resting on the Direction and one Room color Decision. Fulfilling it changes that Room's wall Surface, and the Room Sheet shows the new color.

## Slice 6: Purchase, to the finish line

- **Core:** Requirements with reasons and optional fields, `save_guides`, Quick Guide assembly (Measure-first line, *musts* before *prefers*, the AI's lines), Full Guide out-of-date marking, `record_listing` with checks, `record_fulfilment` with Deviations and the resulting Item and Feature changes, flag cascades on a *must* Deviation and on a reason-field change, `get_shopping`, `export_shopping_list` (printable page and CSV), `export_guides` (printable page and Markdown), the `/guide/<slug>` phone page, LAN mode with the QR code. Migration 0006.
- **Web UI:** the Shopping section with the Shopping List and Considering, the Quick Guide on each entry with the Full Guide one tap away, Listings with their checks, exports, the QR code.
- **Skill text:** Purchase, including Measure first, access Requirements, Listing checks, and Fulfilment.
- **Tests:** reason-field change detection (a named field, and no field), the *must* Deviation cascade, out-of-date Guides; snapshots of a Quick Guide, a `get_decision` with Listings, and the exports; Purchase trigger evals; behaviour evals with a rubric grader for "every Requirement traces to its source" and "every *must* in the Full Guide explains why".
- **Demo:** the finish line, items 4 to 6 of the [PoC design](poc-design.md#finish-line). A Purchase Session produces Requirements tracing to the Palette and a Room plus both Guides; you take the Quick Guide into the shop on your phone; you Fulfil with something slightly different, and the Deviation flags a dependent Decision. Then the acceptance read-through of the real Overview.

## Open items

| Item | Owner | When |
|---|---|---|
| Revise the four trigger descriptions and each Skill's trigger prompt sets before they are committed | the user | the slice that ships each Skill |
| Provide the real Blueprint PDF for the slice 3 demo and the Blueprint eval | the user | slice 3 |
| Whether Blueprint pages need tiles | decided by the slice 3 demo | slice 3 |
| Web UI design session, including form-based editing | the user schedules it | after the finish line |
| HEIC conversion | deferred until a HEIC file arrives | later |
| mupdf's AGPL licence: keep it, or swap the one wrapped module for pdftoppm or pdfjs | the user decides before any hosting | before Docker |

Everything else the docs did not answer was settled in the grilling and written into the specs: identifiers, the port, the city table, Decision kinds and their content, Door identity, the Provenance override, reason granularity, the Home Folder path, web UI reasons, no undo, and LAN mode for the phone.
