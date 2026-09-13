# Codex Skill and plugin compatibility (researched 2026-09-13)

How far Codex (CLI 0.154.0, 2026-09-09 [10]) can use a Claude Code plugin built from Skills and a localhost MCP server. This note builds on [agent-client-support.md](agent-client-support.md) and [claude-code-skills-and-plugins.md](claude-code-skills-and-plugins.md), and does not repeat the Claude Code details they cover. Findings come from primary sources, listed at the end.

**Re-verify before relying on it:**
- `developers.openai.com/codex/*` now 308-redirects to `learn.chatgpt.com/docs/*`, so the docs have moved recently.
- Claims cited to `openai/codex` source files [11–22] were read on `main` on 2026-09-13 and may be ahead of the released CLI.
- Several of those source-only behaviours are undocumented. They are marked **(source only)**.

## Skills in Codex

**Support.** Codex skills "build on the open agent skills standard" [1].
- **Where they work:** standalone skills work in the ChatGPT desktop app, Codex CLI and the IDE extension. Skills bundled in plugins also work in ChatGPT web, desktop and mobile [1].
- **Minimum:** "The `SKILL.md` file must include `name` and `description`." The same `scripts/`, `references/` and `assets/` layout applies [1].

**Discovery** [1].
- `.agents/skills` in every directory from the CWD up to the repo root, then `$HOME/.agents/skills`, `/etc/codex/skills`, then the bundled system skills.
- Same-name skills are not merged: "both can appear in skill selectors." Symlinked skill folders are followed.
- Codex does **not** scan `.claude/skills`. The docs list only `.agents/skills`, and the loader has no `.claude` path (source only) [1][19].
- `.agents/skills/` is the cross-client convention the Agent Skills project recommends. It notes that "some implementations also scan `.claude/skills/`" [25].
- Disable a skill with `[[skills.config]] path = ".../SKILL.md"` and `enabled = false` in `~/.codex/config.toml` [1][5].

**Frontmatter.**
- **Fields read:** the parser reads only `name`, `description` and `metadata.short-description`. Every other key is silently ignored, because the struct has no `deny_unknown_fields` [18].
- **Limits:** `name` can be up to 64 characters and falls back to a default when missing. `description` must be non-empty, and the loader caps it at 1,024 [18][19].
- **Leniency:** the parser has a repair pass for unquoted scalar values, such as a value containing `: ` [18].
- **Consequence:** Claude Code-only fields such as `disable-model-invocation` and `context` do not break a skill in Codex. They just do nothing.

**`agents/openai.yaml`** (optional, inside the skill directory) [1][19].
- **`interface`:** `display_name`, `short_description`, icons, `brand_color`, `default_prompt`.
- **`policy.allow_implicit_invocation`:** defaults to true. When false, "Codex won't implicitly invoke the skill … explicit `$skill` invocation still works."
- **`dependencies.tools[]`:** `type: mcp`, `value`, `transport` (e.g. `streamable_http`), `url` or `command`. With `features.skill_mcp_dependency_install` ("stable; on by default"), Codex can prompt the user to install a missing MCP server that a skill depends on [5].
- Claude Code has no documented use for this file, so it is just an extra file there (inference).

**Auto-invocation** [1].
- **Initial list:** Codex starts with each skill's name, description and **file path**, then reads the full `SKILL.md` when it picks a skill.
- **Budget:** the list uses "at most 2% of the model's context window, or 8,000 characters". When many skills are installed, "Codex shortens skill descriptions first", and it may omit skills with a warning.
- **Advice:** "Front-load the key use case and trigger words so a host can still match the skill if descriptions are shortened."

**Explicit invocation.**
- **In Codex:** in the CLI and IDE, "run `/skills` or type `$` to mention a skill". In ChatGPT, type `@` [1].
- **Plugin skills:** namespaced `plugin:skill` (source only) [20]. Claude Code uses `/plugin:skill` instead.
- **No slash command:** Codex does not turn a skill into a `/name` command.
- **Custom prompts:** deprecated. "Use skills for reusable prompts" [8].

## Plugins in Codex

**Three manifest formats.** Codex looks for them in this order [2][11][12][13]:

1. Root `plugin.json` whose `$schema` is an `agent-plugins.org` URI (Agent Plugins, below). A root `plugin.json` without that schema (e.g. an npm file) is ignored. If `.codex-plugin/plugin.json` also exists, Codex reads it as an overlay.
2. `.codex-plugin/plugin.json`, the legacy format that `$plugin-creator` still scaffolds [2].
3. **`.claude-plugin/plugin.json`**, then `.cursor-plugin/plugin.json`. These are listed in `DISCOVERABLE_PLUGIN_MANIFEST_PATHS` and exercised by tests **(source only)**. The docs mention only the Claude *marketplace* file [2].

**Legacy and Claude manifest fields read** [13]: `name`, `version`, `description`, `keywords`, `skills`, `mcpServers`, `apps`, `hooks`, `interface`.
- Other fields are not read. This includes Claude's `userConfig`, `agents`, `dependencies`, `lspServers` and `monitors`.
- Paths must start with `./` and stay inside the plugin root.
- `skills` may be a string or an array. When `skills` is set it **replaces** the default `skills/`; in Claude Code it adds to it [14][32].

**Default component locations** (source only) [14]:
- `skills/`, `.mcp.json`, `hooks/hooks.json`, `.app.json`.
- Codex scans a skills root recursively, down to 6 levels [19].

**Plugin components** [3]: skills, MCP servers, apps (ChatGPT connectors), browser extensions and hooks. Agents are not a plugin component.

**Claude `commands/`** in a legacy-format plugin are converted into skills [21]. The conversion skips any command whose body uses `$ARGUMENTS`, `$1`…, `{{…}}`, `` !`cmd` `` or `@file` (source only).

**Marketplaces** [2][15].
- **Locations:** `$REPO_ROOT/.agents/plugins/marketplace.json` for a repo, or `~/.agents/plugins/marketplace.json` for a user. Codex also reads "a legacy-compatible marketplace at `$REPO_ROOT/.claude-plugin/marketplace.json`".
- **Adding one:** `codex plugin marketplace add owner/repo[@ref] | git-url | ./dir`. The CLI could install and remove plugins from remote marketplaces from 0.153.0 (2026-09-03) [10].
- **Source types:** `"./path"` strings and `local`, `url`, `git-subdir` and `npm` objects.
- **No `github` source type.** Unsupported entries are skipped "instead of failing the whole marketplace" [2][15]. A Claude marketplace entry using `"source": "github"` is therefore invisible to Codex. Relative `./` paths work in both clients [34].

**Installation.**
- Codex copies plugins to `~/.codex/plugins/cache/$MARKETPLACE/$PLUGIN/…` [2].
- Existing sessions pick up plugin upgrades from 0.154.0 [10].
- Per-plugin config lives under `plugins."<plugin>@<marketplace>"` in `config.toml`. Its keys include `enabled` and per-MCP-tool `approval_mode` [5].

## MCP in Codex

**`config.toml`** [4][5].
- **Location:** `[mcp_servers.<id>]` in `~/.codex/config.toml`, or in project `.codex/config.toml` for trusted projects only. The desktop app, CLI and IDE extension share it.
- **stdio fields:** `command`, `args`, `env`, `env_vars`, `cwd`.
- **Streamable HTTP fields:** `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`, `http_headers_helper`, `auth = oauth | chatgpt`, `oauth.*`, `scopes`.
- **Common fields:** `enabled`, `required`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode`, `tools.<tool>.approval_mode`, `startup_timeout_sec` (10), `tool_timeout_sec` (60).
- **Localhost is fine:** the docs' own example is `url = "http://localhost:3000/mcp"` [4].

**Auth** [4].
- **Order:** bearer token or headers first, then OAuth via `codex mcp login` (CIMD or DCR, loopback callback `http://127.0.0.1/callback`).
- "If no credential source resolves, Codex can connect to the server without authentication."
- **Server instructions:** Codex reads the `instructions` field. "Keep the first 512 characters self-contained." Claude Code truncates instructions at 2 KB [33].

**Plugin MCP files** (source only) [16][17].
- **Legacy `.mcp.json`** (the Claude-style file): a `{"mcpServers": {...}}` object or a bare map. `type` may be `http`, `streamable_http`, `streamable-http` or `stdio`; others produce a warning. A relative `cwd` resolves against the plugin root.
  - The parser does **no `${…}` expansion**. `${CLAUDE_PLUGIN_ROOT}` and `${user_config.*}` would reach Codex as literal text. That is an inference from the parser: no expansion code was found.
- **Agent Plugins `mcp.json`:** a closed schema with `$schema` required and unknown fields rejected. Types are `stdio`, `streamable-http` and `sse`; there is no `http` alias.
  - `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` expand only in stdio `args`, `env` and `cwd`, never in URLs or headers.
  - Plain `http` is allowed only for loopback hosts. "Non-loopback endpoints use HTTPS" [27].
  - The docs warn: "Don't just rename `.mcp.json`: the portable MCP format also declares a transport type for each server" [2].

## Hooks, subagents and Claude import

- **Hooks** [6][2][22].
  - **Sources:** `hooks.json` or `[hooks]` in `config.toml`. A plugin's `hooks/hooks.json` loads by default.
  - **Events:** `SessionStart`, `SessionEnd`, `SubagentStart`/`Stop`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Pre`/`PostCompact`, `UserPromptSubmit`, `Stop`, `Interrupt`.
  - **Handlers:** "command and mcp_tool handlers are supported. prompt and agent handlers are parsed but skipped."
  - **Trust:** plugin hooks are skipped "until you review and trust the current hook definition".
  - **Environment:** hook commands receive `PLUGIN_ROOT`/`PLUGIN_DATA`, and "also `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for compatibility with existing plugin hooks".
  - **Matchers:** `Edit|Write` match `apply_patch`, and shell tools match `Bash`. MCP tools are named `mcp__<server>__<tool>`. The docs don't say whether plugin servers get a prefix; Claude Code names them `mcp__plugin_<plugin>_<server>__<tool>` [33].
- **Subagents** are TOML files in `~/.codex/agents/` or `.codex/agents/`, containing `name`, `description`, instructions and config keys [7]. Claude `agents/*.md` files don't load.
- **Import.** `/import` in the CLI, or Settings > Import in the desktop app, copies a user's Claude Code setup into Codex [9]. It covers instructions, `settings.json`, skills, plugins, MCP config, hooks and subagents, and turns slash commands into skills.
  - The docs tell users to review afterwards "tool restrictions or permissions in imported skills" and "command-style prompts that depend on arguments, shell interpolation, or file-path placeholders" [9].
  - Import is a one-off conversion done by the user, not a way to distribute a plugin.

## Standards

**Agent Skills** [23][24][25].
- **Spec:** six frontmatter fields: `name` (≤64, `[a-z0-9-]`, must match the directory), `description` (≤1024), `license`, `compatibility`, `metadata`, and `allowed-tools` (experimental; "support … may vary").
- **Conforming clients:** agentskills.io lists about 40, including Claude Code, Claude (claude.ai), "ChatGPT & Codex", GitHub Copilot, VS Code, Cursor, Gemini CLI, OpenCode, Goose, Amp, Junie, Kiro and Roo Code [24].
- **Claude Code:** it "extend[s] the standard". claude.ai uploads accept only the six spec fields [31].

**Agent Plugins** (agent-plugins.org) [26][27][28][29][30].
- **Status:** 1.0.0 is published and 1.1.0 is a working draft.
- **Steering committee:** Amazon, Cursor, Microsoft, OpenAI and Vercel. **Anthropic is not a member.**
- **Package:** root `plugin.json` (requires `$schema` and `name`), `skills/` and `mcp.json`, all at fixed locations.
- **Skill discovery:** only immediate children of `skills/` count, with no recursion, and skills that don't conform to the spec are skipped.
- **Client-specific data:** goes under `extensions.<reverse-domain>` in `plugin.json` or a `<reverse-domain>/` directory. "Client extensions are not portable".
- **Codex** supports it: this is the format OpenAI's docs lead with [2].
- **Claude Code** documents only `.claude-plugin/plugin.json` and `.mcp.json`. It ignores unknown manifest fields and says nothing about Agent Plugins [32].

## Compatibility at a glance

| Feature | Claude Code | Codex | Portable? |
|---|---|---|---|
| `SKILL.md` + spec fields | Yes | Yes. Reads `name`, `description`, `metadata.short-description`; ignores the rest | **Yes** |
| Local skill directory | `.claude/skills` | `.agents/skills` | No. A plugin avoids the issue |
| Auto-invocation by description | 1% budget, 1,536-char cap per entry | 2% or 8,000 chars; shortens descriptions | Yes |
| Turn off auto-invocation | `disable-model-invocation: true` | `agents/openai.yaml` `policy.allow_implicit_invocation: false` | Declare both |
| Hide from user (`user-invocable: false`) | Yes | No equivalent found | No |
| Explicit invocation | `/name`, `/plugin:name` | `$name` mention, `/skills` picker | Different syntax |
| `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `` !`cmd` `` | Yes | No | No |
| `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `paths`, skill `hooks` | Yes | Ignored. Approvals live in `config.toml` | No |
| Plugin manifest | `.claude-plugin/plugin.json` | Agent Plugins `plugin.json` › `.codex-plugin/` › `.claude-plugin/` | Yes, via fallback (source only) |
| Plugin `skills/` | Default; manifest `skills` adds | Default; manifest `skills` replaces | Yes, if `skills` is left unset |
| Plugin MCP file | `.mcp.json`: `http`/`streamable-http`/`sse`/`ws` | `.mcp.json` (legacy): `http`/`streamable-http`/`stdio`; `mcp.json` (Agent Plugins) | `.mcp.json` with `type: "http"`: yes |
| `${CLAUDE_PLUGIN_ROOT}` | Skills, hooks, MCP | Hook environment only | Hooks only |
| `userConfig` / `${user_config.*}` | Yes | Not read | No |
| Plugin hooks | `hooks/hooks.json`, 5 handler types | Same file; `command` and `mcp_tool` only; trust review | Partly |
| Plugin agents, LSP, monitors, output styles | Yes | No | No |
| Plugin `commands/` | Yes | Converted to skills unless templated | Partly |
| Marketplace file | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json`, also reads Claude's | Yes, with `./` or `url` sources (not `github`) |
| Localhost streamable-HTTP MCP | Yes | Yes | Yes |

## Consequences for us

- **Frontmatter.** Keep Skills to spec fields only, with `name` equal to the directory name. Put the key use case in the first sentence of `description`, because both clients shorten descriptions when the listing overflows.
  - Where a Skill must not auto-trigger, set `disable-model-invocation` for Claude Code and also ship `agents/openai.yaml` with `allow_implicit_invocation: false` for Codex.
- **Skill bodies must be client-neutral.**
  - Link supporting files by paths relative to `SKILL.md`, e.g. `references/protocol.md`. Don't use `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_ROOT}`, which Codex leaves unexpanded. This rules out the `${CLAUDE_PLUGIN_ROOT}/…` shared-protocol option in the companion note.
  - Don't use `$ARGUMENTS` or `` !`cmd` ``.
  - Don't tell the user to type `/idh:color`; name the Skill instead. Don't have a Skill invoke another through a "Skill tool", because Codex has no such tool (inference).
- **Rule enforcement must not depend on Claude-only machinery.** `allowed-tools`, skill `hooks`, `prompt`/`agent` hook handlers and subagents do nothing in Codex, and Codex plugin hooks need the user to trust them first. Rules that must hold belong in the MCP server. Its `instructions` should front-load the essentials in the first 512 characters.
- **MCP config.**
  - One `.mcp.json` works in both clients: `{"mcpServers": {"harness": {"type": "http", "url": "http://127.0.0.1:<fixed port>/mcp"}}}`.
  - A `${user_config.port}` URL would reach Codex literally, so the port must be fixed or the server must be discoverable.
  - If we also ship an Agent Plugins `mcp.json`, it needs `"type": "streamable-http"` plus `$schema`.
- **Packaging: one repo, one `skills/` directory.**
  - **Minimal:** keep Claude's layout: `.claude-plugin/plugin.json` with no `skills` field, `skills/`, `.mcp.json`, and `.claude-plugin/marketplace.json` with `"source": "./…"`. Codex's fallbacks read all of it. Its reading of `.claude-plugin/plugin.json` is source-only, so test it against the released CLI.
  - **Documented:** also add a root `plugin.json` (Agent Plugins `$schema`) and `mcp.json`, and optionally `.agents/plugins/marketplace.json`. Codex prefers these; Claude Code ignores them. The cost is keeping two MCP files in sync.
  - Either way, keep Skills one level deep, as `skills/<name>/SKILL.md`, because Agent Plugins does not recurse.
- **Hooks,** if we use any: in shell-form commands write `"${CLAUDE_PLUGIN_ROOT}"/…`. Claude Code substitutes it inline, and Codex exports it as an environment variable. Write MCP matchers loosely enough for both naming schemes, e.g. `mcp__.*harness__.*`.

## Sources

1. https://learn.chatgpt.com/docs/build-skills (redirect target of developers.openai.com/codex/skills)
2. https://developers.openai.com/plugins/build/plugins
3. https://learn.chatgpt.com/docs/plugins
4. https://learn.chatgpt.com/docs/extend/mcp
5. https://learn.chatgpt.com/docs/config-file/config-reference
6. https://learn.chatgpt.com/docs/hooks
7. https://learn.chatgpt.com/docs/agent-configuration/subagents
8. https://learn.chatgpt.com/docs/custom-prompts
9. https://learn.chatgpt.com/docs/import
10. https://learn.chatgpt.com/docs/changelog
11. https://github.com/openai/codex/blob/main/codex-rs/exec-server-protocol/src/protocol.rs (`DISCOVERABLE_PLUGIN_MANIFEST_PATHS`)
12. https://github.com/openai/codex/blob/main/codex-rs/utils/plugins/src/plugin_namespace.rs
13. https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/manifest.rs
14. https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/loader.rs
15. https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/marketplace.rs
16. https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/plugin_config.rs
17. https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/agent_plugin_config.rs
18. https://github.com/openai/codex/blob/main/codex-rs/skills/src/parser.rs
19. https://github.com/openai/codex/tree/main/codex-rs/ext/skills/src/loader (`mod.rs`, `metadata.rs`, `discovery.rs`)
20. https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/provider/orchestrator.rs
21. https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/command_migration.rs
22. https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs
23. https://agentskills.io/specification
24. https://agentskills.io/clients
25. https://agentskills.io/client-implementation/adding-skills-support
26. https://agent-plugins.org/specification
27. https://agent-plugins.org/plugin-authors/mcp-servers
28. https://agent-plugins.org/client-implementers/loading-and-discovery
29. https://agent-plugins.org/plugin-authors/client-extensions
30. https://github.com/agentplugins/agent-plugins-spec
31. https://code.claude.com/docs/en/skills
32. https://code.claude.com/docs/en/plugins-reference
33. https://code.claude.com/docs/en/mcp
34. https://code.claude.com/docs/en/plugin-marketplaces
