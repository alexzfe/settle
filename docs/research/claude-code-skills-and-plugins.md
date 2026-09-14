# Claude Code Skills and plugins (researched 2026-09-13)

> **Update 2026-09-14:** the "One plugin" sketch under Consequences predates the Home Folder design. The plugin ships no `.mcp.json`; the Home Folder's `.mcp.json` declares the server, so tools are `mcp__int-design-harness__<tool>`. See [spike 1](spikes/1-home-folder.md) and [spike 2](spikes/2-eval-harness.md).

How Skills and plugins work in Claude Code as of v2.1.270 (2026-09-12) [17]: the `SKILL.md` format, how Skills get invoked, plugin packaging with an MCP server, and the hooks that can enforce rules on MCP tool calls. Findings come from primary sources, listed at the end. The docs record many behaviours with a "requires vX" note, so re-verify anything load-bearing.

## `SKILL.md` format

**Two layers.** The open Agent Skills spec [2] defines six frontmatter fields. Claude Code accepts those six plus its own extensions [1].

| Field | Spec [2] | Claude Code [1] |
|---|---|---|
| `name` | Required. 1–64 chars, `[a-z0-9-]`, no leading, trailing, or double hyphens, must match the directory name | Optional, defaults to the directory name. For personal and project skills it is only a display label, and the command comes from the directory. For plugin skills it sets the command's last segment |
| `description` | Required, 1–1024 chars | "Recommended". Falls back to the first body line. `description` + `when_to_use` are truncated at **1,536 chars** in the listing (configurable with `skillListingMaxDescChars`) |
| `license`, `compatibility` (≤500), `metadata` (map) | Optional | Accepted, not acted on |
| `allowed-tools` | Optional, experimental, space-separated | Pre-approves tools for the invoking turn only. The grant clears on the user's next message. It restricts nothing |

**Claude Code-only fields [1]:**
- **Invocation:** `when_to_use` (trigger phrases, appended to the description), `disable-model-invocation`, `user-invocable`, `paths` (globs, auto-load only when working on matching files).
- **Arguments:** `argument-hint`, `arguments` (named `$name` substitution).
- **Tools and model:** `disallowed-tools`, `model` (for the current turn only), `effort`.
- **Execution:** `context: fork` plus `agent` (run as a subagent), `background` (forks run in the background by default since v2.1.218), `hooks`, `shell`.
- **Booleans:** also accept yes/no/on/off/1/0 since v2.1.218.

**Portability.** claude.ai uploads, the Skills API and `package_skill.py` accept only the six spec fields. Any other field fails with a hard error ("Unexpected key(s) in SKILL.md frontmatter") [1]. Platform docs also forbid XML tags, and the reserved words "anthropic" and "claude", in `name` and `description` [3]. Body features such as `` !`cmd` `` injection work only in Claude Code [1].

**Size and loading.**
- **Progressive disclosure:** metadata (~100 tokens) always loads; the body loads on activation (<5k tokens recommended, keep `SKILL.md` under 500 lines); resources load only when read [2][4].
- **Supporting files:** they don't auto-load. `SKILL.md` must link them and say when to read them. Keep references one level deep [1][2]. Scripts run through bash, and only their output enters context [4].
- **Substitutions in the body:** `$ARGUMENTS`, `$0…`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, and in plugin skills `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}`. These also substitute inside `allowed-tools` Bash rules [1].
- **Lifecycle:** an invoked body stays in context across turns and is never re-read. Invoking it again with identical rendered content adds only a note [1].
- **After compaction:** Claude Code re-attaches the most recent invocation of each skill, at most 5,000 tokens each and 25,000 in total. It fills that budget from the most recently used skill, so older skills can drop out [1].
- **Malformed YAML:** the body still loads, but the description can't be matched [1].

**Where skills live.** In precedence order: enterprise (managed dir), personal `~/.claude/skills/<n>/`, project `.claude/skills/<n>/` (loaded from the start dir up to the repo root), nested (lazy-loaded once Claude touches files in that subtree), `--add-dir`, plugin `<plugin>/skills/<n>/` (namespaced `/plugin:skill`), and claude.ai-synced [1].
- Enterprise beats personal, which beats project.
- Plugin skills never collide with other skills because of their namespace.
- `.claude/commands/*.md` still works, and a skill wins over a command with the same name [1].
- Live reload covers `SKILL.md` text only [1].

## Invocation

**Model invocation.**
- **How Claude chooses:** every skill's name and description sits in a listing, and Claude calls the `Skill` tool when a request matches [1][18]. There is no harness-side keyword matching. The model's judgement is the activation mechanism [7].
- **Listing budget:** the listing is capped at 1% of the context window. On overflow, Claude Code shortens descriptions, least-used skills first, so front-load the key use case [1].
- **Skills trigger only for non-trivial work.** Claude consults skills only for tasks it can't easily do alone. A one-step "read this PDF" may not trigger even a perfectly matched skill [5][6].

**What makes a description route reliably:**
- **What + when.** State what the skill does and when to use it, with keywords users actually say [1][2][3].
- **Person and phrasing (sources disagree).** Platform docs say always write in third person because the text is injected into the system prompt [3]. agentskills.io recommends imperative phrasing, "Use this skill when…" [5]. All official examples combine a third-person "what" sentence with a "Use when…" clause [2][3].
- **Be "pushy."** Anthropic's skill-creator says Claude "has a tendency to undertrigger" skills. It advises listing contexts where the skill applies "even if they don't explicitly ask for" it [6][5].
- **Handle false triggers with boundaries, not narrowing.** State what the skill does not do, and where it ends and adjacent skills begin. Don't add keywords taken from failed queries (overfitting) [5].
- **Test it.** Use about 20 labelled queries, half should-trigger and half near-miss should-not-trigger, 3 runs each, with a 60/40 train/validation split [5][6].
  - `claude plugin eval` (v2.1.269+) runs cases with and without the plugin. Its `tool_used: Skill` grader shows whether the skill fired [16][10].
  - `/skill-doctor` reports unused skills and their context cost [1].

**When several skills match.**
- **No documented tie-break.** The model simply picks from the descriptions. The only deterministic rules cover identical names (the precedence table above) and nested same-name skills, where Claude is told to pick the one whose directory holds the files it's working on [1].
- **Overlap is a description problem.** Fix it with explicit boundaries [5].

**Explicit invocation.**
- Every user-invocable skill is a slash command: `/name`, or `/plugin:name` for plugin skills. A plugin skill's bare `/name` also works unless another command already uses it [1].
- Users can stack up to 6 skills: `/a /b args` loads both, and each gets the same `$ARGUMENTS` [1].
- `disable-model-invocation: true`: only the user can invoke it, and its description is removed from Claude's context. `user-invocable: false`: only Claude can invoke it, and it's hidden from the `/` menu [1].

**Hand-off between skills.**
- **Allowed, but not a documented feature.** Claude may call the `Skill` tool at any point, and subagents can call it too [8]. So a skill body can tell Claude to invoke another skill next. This is inference: the docs describe no chaining primitive.
- **The target must be model-invocable.** If it sets `disable-model-invocation`, Claude Code blocks the call and tells Claude to ask the user to run it [1][17].
- **Preloading.** A subagent's `skills:` field injects full skill bodies at startup [8]. `context: fork` runs a skill in a fresh subagent with no conversation history [1].

## Plugins

**Layout** [9][10].
- `.claude-plugin/plugin.json` is optional; without it, components are auto-discovered and the name comes from the directory.
- Components sit at the plugin root, never inside `.claude-plugin/`: `skills/<n>/SKILL.md`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `monitors/monitors.json`, `bin/` (added to Bash's PATH), `settings.json` (only the `agent` and `subagentStatusLine` keys).
- A root `CLAUDE.md` is **not** loaded. Plugins contribute context only through skills, agents and hooks [10].

**Manifest fields** [10].
- `name` (kebab-case) is the only required field. It is the namespace for skills, agents and MCP tools.
- Metadata: `version`, `displayName`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `metadata`, `defaultEnabled`, `dependencies` (semver constraints on other plugins).
- Component paths: `skills` (adds to the default `skills/`), `commands`/`agents`/`outputStyles` (each replaces its default), `hooks`/`mcpServers`/`lspServers` (path or inline object).
- `userConfig` prompts the user at enable time.
  - Values substitute as `${user_config.KEY}` in MCP/LSP configs, hooks, and (non-sensitive values only) skill content.
  - Since v2.1.207, shell-form hook commands reject that placeholder; hooks read `CLAUDE_PLUGIN_OPTION_<KEY>` instead [10].
- Unknown fields produce warnings, not errors. `claude plugin validate --strict` fails on warnings [10].

**Bundling an MCP server** [10][11].
- Declare it in `.mcp.json` at the plugin root or inline as `mcpServers`. Servers connect automatically when the plugin is enabled, and are managed by installing or uninstalling the plugin, not by `/mcp`. `/mcp` can still toggle one off.
- **Localhost HTTP config:**
  ```json
  { "mcpServers": { "harness": { "type": "http", "url": "http://localhost:${user_config.port}/mcp" } } }
  ```
  - `type` is required. A `url` without `type` is a config error, because an entry with no `type` is read as stdio [11].
  - `streamable-http` is accepted as an alias for `http`. `ws` is also supported.
  - SSE is deprecated. Since v2.1.265 an `http` entry falls back to SSE automatically [11].
- **Placeholders.** `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_PROJECT_DIR}` substitute in `command`/`args`/`env` for stdio servers, and in `url`/`headers`/`headersHelper` for http/sse/ws servers. `${VAR}` and `${VAR:-default}` expand from the environment [10][11].
- **Server lifecycle for HTTP (unclear in the docs).** "Start automatically" plainly means spawning for stdio. For an `http` server Claude Code only connects, so something else must keep the localhost process running. That is inference; the docs don't say.
  - A remote plugin server used before may show `cached` in `/mcp` and connect lazily on the first tool call [11].
- **Tool names.**
  - Plugin tools are named `mcp__plugin_<plugin>_<server>__<tool>`; characters outside `[A-Za-z0-9_-]` become `_`. Use this full name in permission rules, `allowed-tools`, and hook matchers. A matcher on the bare server key never fires [11][14].
  - The server itself registers as `plugin:<plugin>:<server>` [11].
- **Deduplication** [11].
  - Precedence: local > project > user > plugin > claude.ai connectors.
  - Plugins are matched by endpoint, not by name. If the user has already added the same localhost URL, the plugin's copy counts as a duplicate.
- **Context cost** [11].
  - MCP tools are deferred by tool search by default. Set `alwaysLoad: true` on the server, or `_meta["anthropic/alwaysLoad"]` on a tool, to load it upfront.
  - Tool descriptions and server `instructions` are truncated at 2 KB each. Instructions are what tell Claude when to search for the server's tools.
  - A server can force a prompt on every call with `_meta["anthropic/requiresUserInteraction"]: true` [11].

**Caching and paths** [10].
- Marketplace installs are copied to `~/.claude/plugins/cache/`, so `../` paths are rejected and files outside the plugin never arrive. Symlinks are kept only if they point inside the plugin; one pointing elsewhere in the same marketplace is replaced by a copy of its target.
- `${CLAUDE_PLUGIN_ROOT}` changes on every update. State belongs in `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`).
- If there is a `package.json` plus an npm or bun lockfile, dependencies install automatically with `npm ci --ignore-scripts` (60 s timeout).

**Marketplaces, install, update** [12][13][10].
- A marketplace is `.claude-plugin/marketplace.json` with `name`, `owner`, and `plugins[{name, source}]`. Sources can be a relative path, `github`, git `url`, `git-subdir`, `npm`, `archive` (zip), or `command`. Some marketplace names are reserved for Anthropic.
- Add a marketplace with `/plugin marketplace add ./dir | owner/repo[@ref] | URL`. Install with `/plugin install name@marketplace`, choosing user, project (writes `enabledPlugins` to `.claude/settings.json`) or local scope.
- Third-party marketplaces have auto-update off by default. Updating uses `/plugin marketplace update` and `claude plugin update`.
- **Versioning.** The first of these that is set wins: `plugin.json` `version`, the marketplace entry's `version`, the git commit SHA, the archive digest.
  - An explicit `version` pins the plugin: commits pushed without bumping it never reach users.
  - Don't set `version` in both places; `plugin.json` silently wins [10][12].
- Teams can pre-declare marketplaces with `extraKnownMarketplaces` in the project settings [13].

**Local development** [9][10].
- `claude --plugin-dir ./plugin` also accepts a `.zip` and can be repeated. Since v2.1.265 a folder of plugins works too, and it is watched. This local copy overrides an installed plugin of the same name.
- `/reload-plugins` picks up edits. In non-interactive sessions it doesn't reconnect MCP servers.
- Other tools: `claude plugin validate [--strict]`, `claude --debug`, `claude plugin details` (per-component token cost), `claude plugin init <n>` (a skills-dir plugin that loads as `<n>@skills-dir` with no install), and `--plugin-url` (fetches a zip).

## Hooks for enforcing MCP rules

**Where plugins declare hooks.** In `hooks/hooks.json` or inline in the manifest, using the same schema and events as settings hooks [10][14].
- Skill frontmatter `hooks` register when the skill is invoked and stay for the rest of the session. `once: true` removes one after its first successful run [14].
- Plugin-shipped **agents** can't declare hooks, `mcpServers`, or `permissionMode` [10].

**PreToolUse** [14].
- **Matching.** Match on tool name, e.g. `"matcher": "mcp__plugin_idh_harness__.*"`. The `.*` is required: a bare prefix is compared as an exact string. The optional `if` field filters further using permission-rule syntax.
- **Input.** The hook receives `tool_name`, `tool_input` and `tool_use_id`.
- **Decisions.** Return `hookSpecificOutput.permissionDecision`:
  - `allow`, `deny`, `ask`, or `defer` (`-p` mode only). Precedence is deny > defer > ask > allow.
  - `permissionDecisionReason` is shown to Claude on `deny`.
  - `updatedInput` rewrites the arguments. `additionalContext` adds context for Claude.
  - Exiting with code 2 blocks, and JSON can't override that.
- **Limits of `allow`.** Deny and ask rules are still evaluated, and `allow` can't skip the prompt of a `requiresUserInteraction` tool [14][11].
- **Plugin label.** An `ask` from a plugin hook is labelled `[plugin:<name>]` in the prompt [14].

**Other useful events** [14].
- **`PostToolUse`:** `updatedToolOutput` (or `updatedMCPToolOutput`) replaces what Claude sees. MCP output isn't schema-checked. The tool has already run.
- **`PostToolUseFailure`:** fires when a tool call fails, for example to add recovery guidance.
- **`Skill` tool:** `PreToolUse` on the `Skill` tool fires when Claude loads a skill.
- **`UserPromptExpansion`:** covers a user typing `/skill`, which bypasses `PreToolUse`. Its input includes `command_name` and `command_source: "plugin"`.
- **`SessionStart`:** plain stdout is added to Claude's context.
- **`mcp_tool` handlers:** these call a tool on the plugin's own server. Set `server` to `plugin:<plugin>:<server>`.

**Caveat.** For hard allow and deny, the docs point to the permission system rather than hooks, because the `if` filter is best-effort [14]. MCP parameter-level deny rules are only accepted through `--disallowedTools`: Claude Code skips `mcp__…(…)` rules in settings files [15].

## Consequences for us

- **Trigger descriptions.** Keep each description ≤1024 chars and spec-only frontmatter so it stays portable. Put a third-person "what" first, then a pushy "Use when…" with the user's own vocabulary (room, floor plan, moodboard…). Add an explicit "not for X, use `<other-skill>`" boundary between overlapping skills. Measure with `claude plugin eval` and a `tool_used: Skill` grader.
- **Shared protocol across skills.** A plugin-root `CLAUDE.md` won't load. The options are:
  - a shared file each `SKILL.md` links through `${CLAUDE_PLUGIN_ROOT}/…`;
  - a `user-invocable: false` protocol skill that the other skills tell Claude to invoke first;
  - a `SessionStart` hook that prints the protocol.

  Invoked skill bodies persist but can be dropped after compaction, so hard rules belong in hooks or in the MCP server itself.
- **One plugin.** Ship `skills/` plus `.mcp.json` (`type: "http"`, localhost URL, port via `userConfig`) plus `hooks/hooks.json`, with matchers written against `mcp__plugin_<plugin>_<server>__.*`. Starting the localhost server is not handled by Claude Code for `http` entries. Omit `version` during development, and bump it on every release once it's set.

## Sources

1. https://code.claude.com/docs/en/skills
2. https://agentskills.io/specification
3. https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
4. https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
5. https://agentskills.io/skill-creation/optimizing-descriptions
6. https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
7. https://agentskills.io/client-implementation/adding-skills-support
8. https://code.claude.com/docs/en/sub-agents
9. https://code.claude.com/docs/en/plugins
10. https://code.claude.com/docs/en/plugins-reference
11. https://code.claude.com/docs/en/mcp
12. https://code.claude.com/docs/en/plugin-marketplaces
13. https://code.claude.com/docs/en/discover-plugins
14. https://code.claude.com/docs/en/hooks
15. https://code.claude.com/docs/en/permissions
16. https://code.claude.com/docs/en/plugin-evals
17. https://code.claude.com/docs/en/changelog
18. https://code.claude.com/docs/en/tools-reference
