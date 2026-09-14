# Spike 1: Home Folder packaging (run 2026-09-13)

**Risk retired:** the Home Folder design in [skill-set.md#packaging](../../specs/skill-set.md#packaging): per-folder plugin enablement and Home binding by URL.

**Environment:** Claude Code 2.1.269, Node 26.8.1, `@modelcontextprotocol/sdk` 1.30.0 (zod 4.6.5), Linux. Headless runs used `--model sonnet` (Sonnet 5). The interactive runs were driven through tmux by the agent, not by a person. The user's default permission mode on this machine is `auto`.

## Verdict

- **Home binding by URL works.** Each Home Folder's `.mcp.json` reached its own endpoint, and `ping` returned `spike-home` in one folder and `other-home` in the other. A folder outside any Home Folder saw neither the server nor the plugin.
- **Per-folder plugin enablement works, but there is no install offer.** In an interactive session, accepting the workspace trust dialog is enough. Claude Code then registers the folder's directory marketplace in the background and loads the plugin in place from the marketplace directory. No `claude plugin install` is needed, and nothing is copied to the plugin cache.
- **Claude Code asks once for the server,** in a separate "New MCP server found" prompt right after the trust dialog. Its default option is **Continue without using this MCP server**. Writing `enabledMcpjsonServers` into the Home Folder's `.claude/settings.json` removes that prompt, leaving the trust dialog as the only question (verified).
- **Headless (`claude -p`):**
  - the folder's `.mcp.json` server connects without approval
  - calling its tools still needs a permission grant; `readOnlyHint` alone is not enough
  - the plugin loads only once the marketplace has been registered for the user, either by one interactive trust or by `claude plugin marketplace add`

## Working files

Throwaway layout under the session scratchpad (`…/scratchpad/spikes/1/`):

```
server/server.js                               the MCP server (package.json: "type": "module", @modelcontextprotocol/sdk ^1.30.0)
repo/.claude-plugin/marketplace.json           the marketplace, source "./idh-spike"
repo/idh-spike/.claude-plugin/plugin.json      the plugin manifest
repo/idh-spike/skills/spike-intake/SKILL.md    the one Skill
homes/spike-home/.claude/settings.json         Home Folder files
homes/spike-home/.mcp.json
homes/other-home/…                             the same, slug other-home
homes/third-home/…                             the same plus enabledMcpjsonServers (pre-approval test)
outside/                                       empty control folder
```

### `server/server.js`

```js
// Spike 1: a stateless streamable HTTP MCP server, one endpoint per Home.
// The URL fixes the Home: /mcp/homes/<home slug>.
import http from "node:http";
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.IDH_PORT ?? 4380);
const ROUTE = /^\/mcp\/homes\/([a-z0-9-]+)\/?$/;
const LOG = new URL("./requests.log", import.meta.url);

function log(line) {
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

function buildServer(homeSlug) {
  const server = new McpServer(
    { name: "idh-spike", version: "0.0.1" },
    { instructions: "Interior design platform for one Home. Call ping to learn which Home this folder belongs to." },
  );
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Returns the slug of the Home this folder is bound to.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      log(`tool ping home=${homeSlug}`);
      return { content: [{ type: "text", text: `Home: ${homeSlug}` }] };
    },
  );
  return server;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    const match = ROUTE.exec(pathname);
    if (!match) {
      log(`404 ${req.method} ${pathname}`);
      res.writeHead(404).end("not found");
      return;
    }
    const homeSlug = match[1];
    if (req.method !== "POST") {
      // Stateless: no standalone SSE stream, no session to delete.
      log(`405 ${req.method} ${pathname}`);
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    try {
      const body = await readJson(req);
      const methods = [body].flat().map((m) => m?.method ?? "response");
      log(`POST ${pathname} ${methods.join(",")} ua=${req.headers["user-agent"] ?? "-"}`);
      const server = buildServer(homeSlug);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      log(`500 ${pathname} ${err?.stack ?? err}`);
      if (!res.headersSent) res.writeHead(500).end(String(err));
    }
  })
  .listen(PORT, "127.0.0.1", () => log(`listening on 127.0.0.1:${PORT}`));
```

### `repo/.claude-plugin/marketplace.json`

```json
{
  "name": "idh-spike-local",
  "owner": { "name": "Alex Ferrer" },
  "description": "Spike 1 marketplace, added from a local path.",
  "plugins": [
    {
      "name": "idh-spike",
      "source": "./idh-spike",
      "description": "Spike 1: one Skill that pings the Home Folder's MCP server."
    }
  ]
}
```

### `repo/idh-spike/.claude-plugin/plugin.json`

```json
{
  "name": "idh-spike",
  "version": "0.0.1",
  "description": "Spike 1: one Skill that pings the Home Folder's MCP server.",
  "author": { "name": "Alex Ferrer" }
}
```

`claude plugin validate --strict` fails on warnings unless the marketplace has a top-level `description` and the plugin has an `author`. With both, both validations pass.

### `repo/idh-spike/skills/spike-intake/SKILL.md`

```markdown
---
name: spike-intake
description: Records the rooms of the user's home. Use when the user wants to set up their home or asks which home this folder belongs to ("which home is this?", "start home intake"). Not for design advice, colors or shopping.
---

# Spike intake

1. Call the `ping` tool from the Home Folder's MCP server. If no `ping` tool is available, tell the user to start the app and reconnect with `/mcp`, and stop.
2. Report the Home name exactly as `ping` returned it, in one line: "This folder belongs to the Home <slug>."
3. Do nothing else.
```

`claude plugin details idh-spike@idh-spike-local`: 1 Skill, about 82 tokens always-on, about 120 on invoke.

### Home Folder `homes/spike-home/.claude/settings.json`

```json
{
  "enabledPlugins": {
    "idh-spike@idh-spike-local": true
  },
  "extraKnownMarketplaces": {
    "idh-spike-local": {
      "source": {
        "source": "directory",
        "path": "/tmp/claude-1000/-home-alex-Projects-int-design-harness/097b96f9-dc2d-4411-b1c0-36b75185d56b/scratchpad/spikes/1/repo"
      }
    }
  }
}
```

The `directory` source takes an absolute path to the folder that holds `.claude-plugin/marketplace.json`. A relative path would resolve against a git checkout, and a Home Folder is not in one.

### Home Folder `homes/spike-home/.mcp.json`

```json
{
  "mcpServers": {
    "int-design-harness": {
      "type": "http",
      "url": "http://127.0.0.1:4380/mcp/homes/spike-home"
    }
  }
}
```

`other-home` is identical except the URL ends `/mcp/homes/other-home`. `third-home` adds `"enabledMcpjsonServers": ["int-design-harness"]` to its `settings.json`.

### Written by Claude Code, not by us

After the user approves the server interactively, `homes/spike-home/.claude/settings.local.json` appears:

```json
{
  "enabledMcpjsonServers": [
    "int-design-harness"
  ]
}
```

Trust is recorded in `~/.claude.json` under `projects["<folder path>"].hasTrustDialogAccepted: true`. That entry's `enabledMcpjsonServers` stays `[]`: the approval lives in the folder's `settings.local.json`.

## What happened, in order

| # | Where | State before | What Claude Code did |
|---|---|---|---|
| 0 | `spike-home`, `claude mcp list` | nothing registered | Server listed as `⏸ Pending approval (run claude to approve)`. `claude plugin list` and `claude plugin marketplace list` show nothing from the folder |
| 1 | `spike-home` and `other-home`, `claude -p` | nothing registered, folders never trusted | **Server connected without approval** (server log: `server/discover`, `initialize`, `tools/list`). `ping` found but **denied**: `permission_denials: [mcp__int-design-harness__ping]`, "Claude requested permissions to use mcp__int-design-harness__ping, but you haven't granted it yet." **Plugin not loaded.** Debug log: `Skipping orphaned enabledPlugins entry idh-spike@idh-spike-local: marketplace not registered` |
| 1 | `outside`, `claude -p` | same | No server, no plugin, no request reached the server |
| 2 | both Home Folders, `claude -p … --allowedTools mcp__int-design-harness__ping` | same | `Home: spike-home` and `Home: other-home` |
| 3 | `spike-home`, interactive `claude` | same | 1. Workspace trust dialog ("Quick safety check: Is this a project you created or one you trust?…"), which says nothing about MCP servers or plugins. 2. On **Yes, I trust this folder**, a second screen: "New MCP server found in this project: int-design-harness", with options *Use this MCP server* / *Use this and all future MCP servers in this project* / **❯ Continue without using this MCP server** (preselected). 3. After *Use this MCP server*: **no plugin prompt at all.** Debug log: `Installing 1 marketplace(s) in background`, `[reconcile] 1 marketplace(s): idh-spike-local(install)`, `Added marketplace source: idh-spike-local`, `Loading plugin idh-spike from source: "./idh-spike"`, `Loaded 1 skills`. The model listed `idh-spike:spike-intake` and `ping` returned `Home: spike-home` (no tool prompt, because the user's mode is `auto`) |
| 3 | global files after step 3 | | `~/.claude/plugins/known_marketplaces.json` gained `idh-spike-local` (source `directory`, `installLocation` = the repo path). `installed_plugins.json`, `~/.claude/settings.json`, and the plugin cache were unchanged |
| 4 | `spike-home`, `claude -p "which home is this folder for?"` | marketplace registered by step 3 | Init lists plugin `idh-spike@idh-spike-local` at path `…/repo/idh-spike` (the source directory). Tool calls: **`Skill(idh-spike:spike-intake)`** → `ToolSearch` → `ping`. Result: "This folder belongs to the Home spike-home." |
| 4 | `other-home` (never trusted), same prompt | same | Plugin also loaded (`-p` skips trust, and the marketplace is now registered for the user). The model called `ping` directly, without the Skill: "…bound to the Home slug other-home" |
| 4 | `outside`, same prompt | same | No plugin, no server, even with the marketplace registered |
| 4 | `spike-home` TUI, `/clear` then "which home is this folder for?" | same | The model called `ping` directly, without the Skill. Whether the Skill fires is the model's judgement (known from the research) |
| 5 | `outside`: `claude plugin marketplace remove idh-spike-local` | | Removed from `known_marketplaces.json`; `other-home -p` went back to "orphaned … marketplace not registered" |
| 6 | `other-home`: `claude plugin marketplace add <repo>` | nothing registered | "declared in user settings". Writes `extraKnownMarketplaces.idh-spike-local` into **`~/.claude/settings.json`** (rewriting the file, which reorders keys) and adds the entry to `known_marketplaces.json`. Home Folder untouched. `-p` now loads the plugin from the source directory |
| 7 | `other-home`: `claude plugin install idh-spike@idh-spike-local --scope project` | after 6 | Adds `installed_plugins.json` entry `{scope: "project", installPath: ~/.claude/plugins/cache/idh-spike-local/idh-spike/0.0.1, projectPath: <Home Folder>}`, copies the plugin to that cache path, and rewrites the Home Folder's `.claude/settings.json` (same content). **Sessions still load the plugin from the source directory**, not the cache copy |
| 8 | `other-home`: `claude plugin uninstall idh-spike@idh-spike-local --scope project` | | **Removes the `enabledPlugins` entry from the Home Folder's `.claude/settings.json`** (leaves `"enabledPlugins": {}`), and leaves the cache copy behind with an `.orphaned_at` marker |
| 9 | `third-home` (pre-approved), `claude mcp list` then interactive `claude` | nothing registered | Before trust: `⏸ Pending approval`, since committed approvals are ignored in an untrusted folder, as the docs say. After the trust dialog: **no MCP prompt**. Claude Code connected straight away (refused only because the server was stopped by then), and `claude mcp list` shows `✘ Failed to connect`, no longer "Pending". The marketplace was registered on trust, as in step 3 |

## Commands

```sh
# server
cd spikes/1/server && npm init -y && npm pkg set type=module && npm install @modelcontextprotocol/sdk@1.30.0
node server.js                                   # background; stopped at the end
curl -s -H Content-Type:application/json -H Accept:application/json,text/event-stream \
  -X POST http://127.0.0.1:4380/mcp/homes/spike-home \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ping","arguments":{}}}'

# manifests
claude plugin validate --strict spikes/1/repo
claude plugin validate --strict spikes/1/repo/idh-spike

# inspection, from inside a Home Folder
claude mcp list; claude mcp get int-design-harness
claude plugin list; claude plugin marketplace list
claude plugin details idh-spike@idh-spike-local

# headless checks (the prompt must come before --allowedTools, which takes a list)
claude -p "Do exactly these steps…" --model sonnet --output-format json --debug-file runs/r1.debug.log
claude -p "which home is this folder for?" --model sonnet --output-format stream-json --verbose \
  --allowedTools mcp__int-design-harness__ping
#   init message: jq 'select(.type=="system" and .subtype=="init") | {mcp_servers, plugins, skills}'
#   tool calls:   jq 'select(.type=="assistant") | .message.content[] | select(.type=="tool_use") | .name'

# interactive checks
tmux new-session -d -s idh-spike1 -x 160 -y 50 -c homes/spike-home "claude --model sonnet --debug-file runs/i1.debug.log"
tmux capture-pane -p -t idh-spike1; tmux send-keys -t idh-spike1 Down Enter

# the CLI path, and undoing it
claude plugin marketplace add spikes/1/repo
claude plugin install idh-spike@idh-spike-local --scope project
claude plugin uninstall idh-spike@idh-spike-local --scope project
claude plugin marketplace remove idh-spike-local
```

## Where this contradicts or sharpens the spec and plan

1. **"`.claude/settings.json` … names its marketplace, so Claude Code offers to install it."** There is no install offer. For a `directory` marketplace, the trust dialog is the only step. Claude Code registers the marketplace silently and enables the plugin in place. The spec's wording should say that trusting the folder turns the plugin on.
2. **"The user adds the marketplace from its local path."** This is not needed. The first Home Folder the user trusts registers the marketplace for the user, in the user-level `known_marketplaces.json`. After that, the plugin loads in any folder whose project settings enable it, and only Home Folders do. The control folder confirmed that unrelated sessions still don't get the plugin.
3. **"Moving it to GitHub later is a one-line change."** This is probably not true for users (from the docs, not tested). The discover-plugins docs say that since v2.1.195, a plugin from an *external* source that only project settings enable does not load until the user runs `claude plugin install`; Claude Code shows that command. Moving to GitHub would add an install step, and the plugin-cache update rules (item 4) would start to apply.
4. **"`version` … is bumped on every release, because without a bump installed copies never update."** For a `directory` marketplace, every session's init message shows the plugin loaded from the source directory. That held even after `plugin install` had made a cache copy. So in the PoC, a rebuilt `plugin/` should reach every Home Folder on the next session without a bump. This is inferred from the plugin path, not tested by editing a Skill. The bump rule matters once the plugin is fetched from git.
5. **"Claude Code asks once to approve the folder's server."** True, but the preselected answer is *Continue without using this MCP server*, so pressing Enter out of habit leaves the Session with no tools. Proposed change, verified in step 9: the Set up Home Folder action also writes `"enabledMcpjsonServers": ["int-design-harness"]` into the folder's `.claude/settings.json`. It stays two files, and the user sees one prompt: the trust dialog. Security is not weakened, because the committed approval takes effect only after the user trusts the folder. **The user should decide this.**
6. **The approval lands in the Home Folder's `.claude/settings.local.json`,** not in `~/.claude.json`. The Set up action must never overwrite `settings.local.json`. Re-running it may rewrite `settings.json` and `.mcp.json`.
7. **Claude Code edits the Home Folder's `.claude/settings.json`.** `plugin install --scope project` rewrites it, and `plugin uninstall --scope project` deletes the enablement. The server's "refuses a folder that already holds another Home's `.mcp.json`" check should look only at `.mcp.json`. A changed `settings.json` does not mean the folder belongs to another Home.
8. **Tool names are `mcp__<server key>__<tool>`** (here `mcp__int-design-harness__ping`), not the `mcp__plugin_<plugin>_<server>__` form in [claude-code-skills-and-plugins.md](../claude-code-skills-and-plugins.md), because the server comes from the folder, not the plugin. Any permission rule, `allowed-tools` entry, or eval grant must use this form. The spec should fix the `.mcp.json` server key (this spike used `int-design-harness`).
9. **Headless and evals.** In `-p`, the folder's server connects with no approval. Its tools, read-only ones included, are denied unless granted (`--allowedTools mcp__int-design-harness__<tool>` or a permission rule). The plugin loads only once the marketplace is registered for the user. This bears on spike 2 and the live smoke suite.
10. **What the server sees from Claude Code 2.1.269.**
    - It sends a `server/discover` probe first and falls back to `initialize` (debug: "version negotiation probe failed … reconnecting pinned legacy"). It negotiates protocol `2025-11-25`.
    - It opens a `GET` for the SSE stream. A 405 answer is harmless.
    - The User-Agent is `claude-code/2.1.269 (cli)` interactively and `(sdk-cli)` under `-p`.
    - The SDK's stateless transport (`sessionIdGenerator: undefined`, one `McpServer` per request) handled all of this unchanged.

Recommended Home Folder files for `set_up_home_folder`, if item 5 is accepted:

```jsonc
// <Home Folder>/.claude/settings.json
{
  "enabledPlugins": { "int-design-harness@<marketplace name>": true },
  "extraKnownMarketplaces": {
    "<marketplace name>": { "source": { "source": "directory", "path": "<absolute repo root>" } }
  },
  "enabledMcpjsonServers": ["int-design-harness"]
}
// <Home Folder>/.mcp.json
{ "mcpServers": { "int-design-harness": { "type": "http", "url": "http://127.0.0.1:4380/mcp/homes/<home slug>" } } }
```

The marketplace name must avoid the reserved list in the plugin-marketplaces docs. Whether it may equal the plugin name (`int-design-harness@int-design-harness`) was not tested.

## What a human must confirm interactively

The agent drove the TUI through tmux and saw every prompt above, but a person should run it once in their own terminal:

1. **Trust, then the MCP prompt.** In a fresh Home Folder, the trust dialog comes first, then "New MCP server found" with *Continue without using this MCP server* preselected. With `enabledMcpjsonServers` in the folder's `settings.json`, only the trust dialog should appear.
2. **No plugin install prompt.** After trust, `/plugin` → Installed should show the plugin enabled for the project, and `/` should list the Skill. The agent checked only through the model's skill listing and the stream-json init.
3. **Tool permission prompts in default mode.** This machine runs in `auto` mode, so no per-tool prompt appeared for `ping`. In `default` mode, expect one the first time each tool is used. Decide whether the Home Folder's `settings.json` should pre-allow the read tools.
4. **Recovering from a declined server.** Not tested: `claude mcp reset-project-choices` or `/mcp` after choosing *Continue without*.
5. **A GitHub-sourced marketplace** (item 3), when the plugin moves there.

## State left behind

- **Restored to baseline:**
  - `~/.claude/settings.json` (byte-identical to the copy taken before the spike)
  - `~/.claude/plugins/installed_plugins.json`
  - `~/.claude/plugins/known_marketplaces.json` (only `claude-plugins-official.lastUpdated` differs, from a background update of the official marketplace)
  - the stray cache copy `~/.claude/plugins/cache/idh-spike-local/` (deleted)
- **Stopped:** the spike server on 4380 and both tmux sessions.
- **Left in place:**
  - `~/.claude.json` `projects` entries for `…/spikes/1/homes/spike-home` and `…/spikes/1/homes/third-home` (trust accepted). Every running Claude Code session rewrites this file, so editing it while other agents run risks clobbering their writes. These entries are harmless, since the paths are under `/tmp`.
  - Session transcripts in `~/.claude/projects/-tmp-claude-1000--home-alex-Projects-int-design-harness-097b96f9-dc2d-4411-b1c0-36b75185d56b-scratchpad-spikes-1-{homes-spike-home,homes-other-home,outside}/`
  - 4 lines in `~/.claude/history.jsonl` from the interactive prompts
  - the throwaway directory `…/scratchpad/spikes/1/`, with its server, plugin, Home Folders, baselines, run outputs, and debug logs
