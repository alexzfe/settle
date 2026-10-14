---
type: subsystem
title: Skills, the Claude Code plugin and Home Folders
description: How Settle's four Skills are authored in packages/skills, built with the shared Session protocol into plugin/skills, shipped as a Claude Code plugin, and how a Home Folder's .mcp.json binds an Agent to one Home's MCP endpoint.
tags: [skills, plugin, claude-code, mcp, home-folder, agent]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-09160a15c85836458c6d2077
    resource: repo://.claude-plugin/marketplace.json
  - id: openwiki-source-34fb0acd2ae70d4ca2b30b29
    resource: repo://packages/core/src/home-folder.ts
  - id: openwiki-source-ac0e9828432f18e95263b384
    resource: repo://packages/core/src/operations/sessions.ts
  - id: openwiki-source-f4f7c6610d3f9dcff280f70a
    resource: repo://packages/server/scripts/write-tools-json.ts
  - id: openwiki-source-025ac13d5542b75363993f74
    resource: repo://packages/server/src/api.ts
  - id: openwiki-source-806d356e983a35b4aeed3d2b
    resource: repo://packages/server/src/mcp.ts
  - id: openwiki-source-1d3eed8d77aaf18363fd86c0
    resource: repo://packages/server/src/tools-list.ts
  - id: openwiki-source-691b2b4c841bde9d3a69b417
    resource: repo://packages/skills/src/build.ts
  - id: openwiki-source-7b5c96d2d2c03cd1dfeb61bd
    resource: repo://packages/skills/src/render.ts
  - id: openwiki-source-983ee1e3d7bec6683235a129
    resource: repo://plugin/.claude-plugin/plugin.json
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Skills, the Claude Code plugin and Home Folders

Settle does no AI work itself. The user's own Agent (Claude Code) holds the conversation; Settle
supplies two things to it: **Skills** (procedural expertise, shipped as a Claude Code plugin) and
**tools** (the MCP endpoint of one Home). The **Home Folder** is what joins them.

## The four Skills

`packages/core/src/operations/sessions.ts` names the Skills core knows: `home-intake`,
`design-direction`, `color`, `purchase`. `open_session` takes one of them as its `skill` argument, so
a new Skill must be added there as well as in `packages/skills/`.

| Skill | Owns |
| --- | --- |
| `home-intake` | Rooms, measurements, windows, doors, Inventory, from a Blueprint or an interview. Makes no design Decisions. |
| `design-direction` | The Home's Design Direction, then Room Directions and undecided Room uses. |
| `color` | The Palette, then each Room's Surface colors; Fulfils paint Decisions. |
| `purchase` | Purchase Decisions end to end: Requirements, Quick/Full Guides, Listing checks, Fulfilment. |

Each source lives at `packages/skills/<name>/SKILL.md`. Its `description` frontmatter is the trigger
text Claude Code matches against; the descriptions deliberately include near-miss exclusions ("Not
for UI, CSS, brand or chart colors").

## The shared Session protocol

`packages/skills/protocol.md` holds the rules every Skill follows: checking the tools are present,
calling `open_session` first and passing the Session id on every write, joining an existing Session
when a second Skill starts, the round format (at most five numbered questions, each with a committed
recommendation), asking the user before a Reopen or a Constraint change, saying what changed,
handling refused writes, and closing. It is written once and inlined into every built Skill.

## Building the plugin

`pnpm plugin:build` runs `packages/skills/src/build.ts`, which:

1. renders every `packages/skills/<dir>/SKILL.md` through `renderSkill` — validating that the
   frontmatter has only `name` and `description`, that `name` is kebab-case and matches its folder,
   that the body does not already contain the protocol heading, and that `protocol.md` uses only
   `###`-or-deeper headings — then appends the protocol under `## Session protocol`;
2. builds each replay eval's `history.jsonl` from `src/eval-histories.ts` (see
   [Tests, evals and demo data](../testing/tests-and-evals.md));
3. only after everything rendered, deletes and rewrites `plugin/skills/`.

So `plugin/skills/*/SKILL.md` is **generated**: edit the sources in `packages/skills/` and rebuild.

The plugin itself is `plugin/` (`plugin/.claude-plugin/plugin.json`), and the repository root is a
plugin marketplace (`.claude-plugin/marketplace.json`) whose single plugin's source is `./plugin`.

## The MCP side

`packages/server/src/mcp.ts` exposes every core operation whose surface is not `web` as an MCP tool,
and refuses to start if a writing tool's input lacks a `session` field — the endpoint is stateless,
so the Settle Session travels as a tool argument, never as an MCP session. The server also sends
`SERVER_INSTRUCTIONS`, a sub-512-character restatement of the core rules (open a Session first, ask
before a Reopen, never re-propose a Rejected Decision, a Note alone never changes a Decision) kept
as a backstop in case compaction drops Skill text. See
[HTTP server](../server/http-and-mcp.md) for the request path.

## Home Folders

A Home Folder holds only two files, written by a script the server serves; the server never writes
to the user's disk. `packages/core/src/home-folder.ts` produces them:

- `.mcp.json` — an `http` MCP server keyed `settle` (so tools appear as `mcp__settle__<tool>`)
  whose URL is `<origin>/mcp/homes/<slug>` and which sends `Authorization: Bearer <home token>`.
  **The URL is how the server knows which Home a folder belongs to**; this is why the MCP config
  lives in the folder rather than the plugin.
- `.claude/settings.json` — enables the `settle@settle` plugin, registers the GitHub marketplace
  `alexzfe/settle`, and pre-approves the `settle` MCP server.

The About page in the web UI shows a command, `curl -fsSL -H "Authorization: Bearer …"
"<origin>/api/home_folder_script?home=<slug>" | sh`. The script (`homeFolderScript`) refuses a folder
whose `.mcp.json` already points at another Home, keeps any differing existing file as
`<file>.before-settle`, writes both files, and prints the plugin install command
(`claude plugin marketplace add alexzfe/settle && claude plugin install settle@settle --scope
project`). The plugin is installed at project scope so the Skills appear only in Home Folders. The
token is always sent, even with no password set, so enabling a password later needs no re-setup
(see [Configuration, security and self-hosting](../operations/hosting-and-security.md)).

## Changing a tool or Skill

- Changing a tool's name, description or schema: run `pnpm --filter @settle/server tools:json` to
  refresh `plugin/evals/mocks/settle/_tools.json`, which the replay evals' mocks use.
- Changing a Skill or `protocol.md`: run `pnpm plugin:build`, then the evals.

Related: [Sessions, the opening and Agent-facing text](../domain/sessions-and-agent-text.md).
