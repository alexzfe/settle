# Spike 2: can the plugin eval harness reach a localhost HTTP MCP server (run 2026-09-14)

Spike 2 of the [build plan](../../build-plan.md#slice-0-scaffold-and-spikes). It retires the risk behind the live smoke suite and the grilling-Skill eval approach. Every claim below comes from a real run, and the evidence is quoted. The spike code was throwaway and lived in the session scratchpad.

## Answer

- **Yes, the harness reaches a localhost HTTP server.** It needs a plugin that declares the server, `--mocks off` (or `--allow-real-servers`), and `--allow-tools "mcp__plugin_<plugin>_<server>__*"`. The sandbox doesn't block it, because the child `claude` process makes the HTTP connection itself, and that connection isn't sandboxed.
- **Our real plugin can't reach the server on its own.** It ships no `.mcp.json`. A `.mcp.json` placed in the run's working directory is ignored, whether a scaffold writes it or `context.add_dirs` provides it. Live smoke needs a small **test-only helper plugin**, loaded next to the real one, that ships only a `.mcp.json`.
- **Mocks work with or without a `.mcp.json`.** Without one, `mocks/<server>/` registers a standalone stand-in whose tools are named `mcp__<server>__<tool>`. That is exactly the name production uses, where the Home Folder's project `.mcp.json` names the server.
- **AskUserQuestion doesn't exist in an eval run,** even when it is granted. The model falls back to asking in plain text. The run ends normally with the question as `last_message`. It doesn't hang or error.
- **Transcript replay works,** including a history that contains AskUserQuestion calls, answered or not.

## Setup

| | |
|---|---|
| Claude Code | 2.1.269 |
| Node | v26.8.1 |
| MCP SDK | `@modelcontextprotocol/sdk` 1.30.0, stateless streamable HTTP (`sessionIdGenerator: undefined`), `node:http` |
| Agent model | `claude-sonnet-5` (`--model`) |
| Judge | not used (no `llm` graders) |
| Total spend | $0.83 over 18 eval invocations |

- **Server:** `127.0.0.1:4381/mcp` with one tool, `ping` (`readOnlyHint: true`), which returns `pong from server`. It logs every request with its user agent.
- **`plugin-http`:** a plugin named `idh-eval-spike`, with a `.mcp.json` that declares `"idh": {"type": "http", "url": "http://127.0.0.1:4381/mcp"}`. It has two Skills:
  - `ping-skill`: call `ping` and reply `The server said: <answer>`.
  - `ask-first`: ask "Which room do you want to work on?" with AskUserQuestion before anything else.
- **`plugin-nomcp`:** the same plugin name and `ping-skill`, with **no** `.mcp.json`, like our real plugin.
- **Mock answer:** every mock returns `pong from mock`, so the two sources can be told apart.

Every run used these base flags:

```
claude plugin eval . --case <case> --runs 1 --ablation none --no-publish --max-cost-usd 5 \
  --model claude-sonnet-5 --trust-plugin --keep-temp [extra flags]
```

`claude plugin validate .` on `plugin-http` exited 0, with one warning (no author).

## 1. Mocks

| Plugin | Mock file | Run header | Tool name in trace | Result |
|---|---|---|---|---|
| `plugin-http` (declares `idh`) | `evals/mock-ping/mocks/idh/ping.md` | `mocked: idh(ping=fixed)` | `mcp__plugin_idh-eval-spike_idh__ping` | 1.00, exit 0 |
| `plugin-nomcp` (declares nothing) | `evals/mock-ping/mocks/idh/ping.md` | `mocked: idh[standalone](ping=fixed)` | `mcp__idh__ping` | 1.00, exit 0 |

- **Graders.** Both runs used `tool_used` on the tool name (`regex` over the trace for the standalone case) and a `regex` for `pong from mock` on `last_message`, and every grader passed. Both runs ended `The server said: pong from mock`. The server log shows no request during either run.
- **Directory name.** With a `.mcp.json` http entry, the mock directory is the server's key in that file (`idh`), and the tool gets the plugin prefix. Without a `.mcp.json`, any directory name works, and it becomes a standalone server of that name (the init line shows `mcp_servers: [{"name": "idh", "status": "connected"}]`).
- **Not documented.** The embedded reference only describes mocks that replace a server the plugin declares. The standalone behaviour is what we would rely on, so a mock case in the suite will catch a change.
- **No grant needed.** Mocked tools are allowed automatically, in both shapes.

## 2. Real server

`plugin-http` ran the `real-ping` case with no mocks, and the server was running:

| Run | Extra flags | What happened | Score | Exit |
|---|---|---|---|---|
| A | none (`--mocks record`) | `"plugin:idh-eval-spike:idh" has no mock and is NOT started`. An empty stand-in shows as `connected` with zero tools. The server log shows no request. The model replied `No ping tool available.` | 0.33 | 1 |
| B | `--allow-real-servers` | The server connected. The log shows the handshake (`POST`, `POST`, `GET`, `POST` from `claude-code/2.1.269 (sdk-cli)`) but no tool call. The tool was listed, and the call was **denied**: `Permission to use mcp__plugin_idh-eval-spike_idh__ping has been denied because Claude Code is running in don't ask mode.` | 0.67 | 1 |
| C | `--allow-real-servers --allow-tools "mcp__plugin_idh-eval-spike_idh__*"` | The log shows `TOOL ping called (#2)`. The model replied `The server said: pong from server`. | 1.00 | 0 |
| D | `--mocks off --allow-tools "mcp__plugin_idh-eval-spike_idh__*"` | The log shows `TOOL ping called (#3)`. Same reply as C. | 1.00 | 0 |

- **Grant.** The case's own `allowed_tools` isn't enough: the run prints `not granted (missing --allow-tools grant ...)`. Only the operator's `--allow-tools "mcp__plugin_<plugin>_<server>__*"` makes the tool callable.
- **Sandbox.** Nothing blocks the call. No Bash grant is involved, and the OS sandbox only confines shell tools. For an HTTP server, "starts the real server" just means connecting to the URL.
- **Grader gotcha (run B).** `tool_used` counted the denied call as a use (`called 1x`, passed). A `tool_used` grader proves the model *tried* a tool, not that the tool answered. Pair it with a grader on the tool's output.
- **Turns.** MCP tools are deferred, so every run spent a `ToolSearch` (`select:<tool>`) before its first call, and a one-tool ping took 5 turns. Budget `max_turns` for this.
- **Server down.** When the server is unreachable (see run F4b below), the run doesn't error. The init line shows `status: "failed"`, ToolSearch tells the model `ConnectionRefused`, and the graders fail normally.

## 3. Reaching a server our real plugin doesn't declare

All of these ran on `plugin-nomcp`:

| Run | Approach | Result |
|---|---|---|
| F | A scaffold writes a Home-Folder-style `.mcp.json` and a `.claude/settings.json` (`enableAllProjectMcpServers`) into the working directory. `context.add_dirs` also holds a fixture `.mcp.json`. Flags: `--scaffold --mocks off --allow-tools "mcp__idh__*" ...` | **Not loaded.** The files were in the kept workspace, but the init line shows `mcp_servers: []`, the server log shows no request, and the model replied `No ping tool available.` Score 0.00, exit 1. This matches the reference: the child runs with `--setting-sources user`, so project-scope config is never read. |
| F1 | Helper plugin `idh-live` (a `plugin.json` plus the `.mcp.json`) at `evals/live-server/`, a sibling of the case. The case has `plugins: ["../..", "../live-server"]` | **Refused before running:** `a plugins entry names the case directory, its graders or mocks, or a directory covering them — a plugin shipped with a case must sit in its own subdirectory`. Score 0, $0, exit 1. Why this location trips the check is unclear. |
| F2 | Helper inside the case directory (`evals/live-helper2/live-server/`), `plugins: ["../..", "live-server"]` | Works. Both plugins load (`Plugin under test: "idh-live" ...`). The log shows `TOOL ping called (#4)`. Score 1.00, exit 0. |
| F3 | Helper outside the eval dir, at `<plugin root>/test-support/live-server/`, `plugins: ["../..", "../../test-support/live-server"]` | Works (#5). Score 1.00, exit 0. |
| F4a | Helper URL `http://127.0.0.1:${EVAL_IDH_PORT:-9}/mcp`, with the case's `env: {EVAL_IDH_PORT: "4381"}` | Works (#6). Score 1.00, exit 0. The case's `EVAL_*` env reaches the `.mcp.json` expansion. |
| F4b | Helper URL `${IDH_SPIKE_PORT:-9}`, with `IDH_SPIKE_PORT=4381` set in the operator's shell | **Not passed through.** The URL fell back to port 9, and the result was `plugin:idh-live:idh (ConnectionRefused)`. Score 0.33, exit 1. |
| L | The F3 layout from a **separate eval dir**, `evals-live/`: `--eval-dir evals-live --mocks off --allow-tools "mcp__plugin_idh-live_idh__*"`, without `--ablation` | Works. With-arm 1.00, baseline arm 0.00, Δ +1.00, exit 0. |

- **Tool names.** Through the helper, the tools are named `mcp__plugin_idh-live_idh__<tool>`. That differs from both production and the mocks (`mcp__<server>__<tool>`). The Skills find the tool by its bare name, so they work unchanged. Only the live graders and the `--allow-tools` grant use the prefixed name.
- **Ablation default.** Run L showed that a path target now defaults to `--ablation with-without` (`Ablation: defaulting to with-without — a plugin resolved from this path`). The embedded reference says a path target defaults to `none`, which is wrong for 2.1.269; the `--help` text is right. Pass `--ablation none` explicitly.

So an eval can't reach a server declared only in the case's working directory. The evals need a test-only variant, and the cheapest one is a helper plugin loaded next to the real plugin, not a copy of the real plugin with a `.mcp.json` added.

## 4. AskUserQuestion headless

**Run H** (case `ask-first` on `plugin-http`, no extra flags) scored 0.75 and exited 1:

```
ASSISTANT tool_use Skill {"skill": "idh-eval-spike:ask-first"}
USER      tool_result 'Launching skill: idh-eval-spike:ask-first'
ASSISTANT tool_use ToolSearch {"query": "select:AskUserQuestion", "max_results": 3}
USER      tool_result 'No matching deferred tools found'
ASSISTANT text 'Which room do you want to work on — Kitchen, Bedroom, or Living room?'
RESULT    subtype=success is_error=False num_turns=4 terminal_reason=completed permission_denials=[]
```

Its graders:

- ✗ `asks-with-tool` (`tool_used AskUserQuestion`): `called 0x`
- ✓ `fires`
- ✓ `last-message-is-question` (`/which room/i`)
- ✓ `no-made-up-answer` (`not_contains "We will work on the"`)

**Run H2** added `--allow-tools AskUserQuestion` and got the same outcome: 0.75, exit 1. Its init line lists the child's whole tool set: `Glob, Grep, Read, Skill, Task, TaskOutput, TaskStop, ToolSearch`. There is no AskUserQuestion. The model searched twice, then asked with a plain-text list.

So the run neither hangs nor errors. It ends in 5–12 s with the question as `last_message`. The reason is not what our research guessed: AskUserQuestion is simply absent from `claude -p`, even though the reference lists it in the read-only set.

**Replay** (`context.history_file`, `--ablation none`). The history came from a kept run H2 transcript, and two variants were edited from it to look like interactive transcripts:

| Case | History ends with | Case prompt | Result |
|---|---|---|---|
| R1 `replay-plain` | the plain-text question | `Bedroom` | `We will work on the bedroom.`, 1.00, exit 0 |
| R2 `replay-ask-answered` | an AskUserQuestion `tool_use`, its `tool_result` answering "Bedroom", and an assistant reply | `Remind me which room we picked, in one word.` | `Bedroom.`, 1.00, exit 0 |
| R3 `replay-ask-dangling` | an **unanswered** AskUserQuestion `tool_use` | `Bedroom` | `We will work on the bedroom.`, 1.00, exit 0 |

- **Unavailable tools in history.** Resuming a history that contains AskUserQuestion calls works, even though the tool isn't in the run. R3 shows that a dangling call is patched up on resume. How it was patched isn't visible, because the resumed transcript isn't kept.
- **Trace scope.** A replay's `trace.jsonl` holds only the evaluated turn (3 lines: init, assistant, result), so `trace` graders see turn N only.
- **Cost.** Each replay run cost about $0.006 and took 2 s.

## 5. Every invocation

Each row adds its extra flags to the base flags above, except L, which uses `--eval-dir` instead of `--case` and has no `--ablation`. Every exit 1 is a case below the default threshold of 1.0.

| Run | Plugin | Case | Extra flags | Score | Exit |
|---|---|---|---|---|---|
| 1 | http | mock-ping | none | 1.00 | 0 |
| A | http | real-ping | none | 0.33 | 1 |
| B | http | real-ping | `--allow-real-servers` | 0.67 | 1 |
| C | http | real-ping | `--allow-real-servers --allow-tools "mcp__plugin_idh-eval-spike_idh__*"` | 1.00 | 0 |
| D | http | real-ping | `--mocks off --allow-tools "mcp__plugin_idh-eval-spike_idh__*"` | 1.00 | 0 |
| E | nomcp | mock-ping | none | 1.00 | 0 |
| F | nomcp | workspace-mcp | `--scaffold --mocks off --allow-tools "mcp__idh__*" "mcp__plugin_idh-eval-spike_idh__*"` | 0.00 | 1 |
| F1 | nomcp | live-helper | `--allow-real-servers --allow-tools "mcp__plugin_idh-live_idh__*"` | 0 (refused) | 1 |
| F2 | nomcp | live-helper2 | same as F1 | 1.00 | 0 |
| F3 | nomcp | live-helper3 | same as F1 | 1.00 | 0 |
| F4a | nomcp | live-env-case | same as F1 | 1.00 | 0 |
| F4b | nomcp | live-env-operator | same as F1, with `IDH_SPIKE_PORT=4381` in the shell | 0.33 | 1 |
| H | http | ask-first | none | 0.75 | 1 |
| H2 | http | ask-first | `--allow-tools AskUserQuestion` | 0.75 | 1 |
| R1–R3 | http | replay-* | none | 1.00 each | 0 |
| L | nomcp | (eval dir `evals-live`) | `--eval-dir evals-live --mocks off --allow-tools "mcp__plugin_idh-live_idh__*"` | with 1.00 / without 0.00 | 0 |

## Recommendation for `plugin/evals/`

```
plugin/
  .claude-plugin/plugin.json      int-design-harness, still no .mcp.json
  skills/<name>/SKILL.md
  evals/                          offline suite, `pnpm plugin:eval`
    mocks/<srv>/<tool>.md         suite-wide canned answers rendered from the fixture Home
    <skill>-fires-<n>/prompt.md   should-fire trigger cases
    <skill>-skips-<n>/prompt.md   near-miss trigger cases
    <skill>-<rule>/case.yaml      behaviour cases: history.jsonl beside it, per-case mocks/ overrides
    results/                      gitignored
  evals-live/                     live smoke suite, `pnpm plugin:eval:live`
    <case>/prompt.md              plugins: ["../..", "../../test-support/live-server"]
    results/                      gitignored
  test-support/live-server/       helper plugin: .claude-plugin/plugin.json + .mcp.json only
```

- **One server name everywhere.** `<srv>` must be the server key the Home Folder's `.mcp.json` uses. Then mocked tools are named `mcp__<srv>__<tool>`, exactly as in production, so offline graders match real Sessions. Give the helper plugin's `.mcp.json` the same key, so live tools are `mcp__plugin_<helper>_<srv>__<tool>`.
- **Offline suite:** `claude plugin eval ./plugin --trust-plugin --ablation none --no-publish --model <pinned>`. Mocks are on by default and no grant is needed.
  - Write the target as `./plugin`: a target with no `/` is read as an installed plugin's name.
  - Pass `--ablation none` for trigger evals, because under the path default (`with-without`) the `tool_used: Skill` graders go unscored.
- **Live suite:** a script starts the server on a **dedicated port with a temporary `IDH_DATA_DIR` seeded with the fixture Home**, then runs `claude plugin eval ./plugin --eval-dir evals-live --mocks off --allow-tools "mcp__plugin_<helper>_<srv>__*" --trust-plugin --ablation none --no-publish --model <pinned>`, then stops the server.
  - Never point live smoke at 4380. Its writes would land in the user's real Home.
  - Fix the URL (port and fixture Home slug) in the helper's `.mcp.json`, or take it from the case's `EVAL_*` env. The operator's shell env doesn't reach it.
  - Keeping the live cases in their own eval dir means the suite-wide `evals/mocks/` can never shadow the helper's server of the same name.
- **Grilling Skills:**
  - **Opening turn:** a single-prompt case. Grade that `last_message` asks one question and that no write tool was called (`tool_used` with `min: 0, max: 0`). Never grade an AskUserQuestion call; it can't happen headless.
  - **Later turns:** replay cases. Cut the demo transcript right after the assistant's question, whether it is plain text or an AskUserQuestion call, and put the user's answer in the case prompt.
- **Pair `tool_used` with an output grader** wherever a tool could be denied or unmocked.
- **Skill text names tools by bare name** (`get_room_sheet`), never by an `mcp__…` name. The prefix differs between production and mocks (`mcp__<srv>__`) and live smoke (`mcp__plugin_<helper>_<srv>__`).

## What turned out wrong or missing in the docs

- **[build-plan.md](../../build-plan.md), Repository layout and Commands.** Add `plugin/evals-live/`, `plugin/test-support/live-server/`, and `pnpm plugin:eval:live`. The Live smoke row should say "via a test-only helper plugin, on a dedicated port with a seeded data dir". The open item "AskUserQuestion behaviour in headless evals" is resolved: it's absent, and the question is asked in plain text.
- **[specs/skill-set.md](../../specs/skill-set.md), Setting up a Home Folder.** The `.mcp.json` server **key** is never named, only the URL. It must be fixed, because the mock directories, the graders, and every tool name depend on it. Decide it in slice 1.
- **[claude-plugin-eval.md](../claude-plugin-eval.md):**
  - "It is in the default read-only tool set" (AskUserQuestion) is wrong in practice. It isn't in the child's tools, even when granted. The guessed outcome (the question becomes `last_message`) is right, but only because the model falls back to plain text.
  - `mcp__plugin_<plugin>_<server>__<tool>` holds only for servers the plugin declares. A mock for an undeclared server is `mcp__<server>__<tool>`.
  - An HTTP server "starts" by connecting, and that works. The server-state reset per run is still unsolved.
- **The embedded reference.** It says a path target defaults to `--ablation none`, but 2.1.269 defaults to `with-without`.
- **[claude-code-skills-and-plugins.md](../claude-code-skills-and-plugins.md).** Its "One plugin" sketch (a plugin shipping `.mcp.json`, and matchers on `mcp__plugin_idh_harness__.*`) predates the Home Folder design and is stale.

## Verify by hand

- **A real interactive transcript.** Replay was proven on a headless transcript edited to include AskUserQuestion calls. Try one real demo transcript in slice 1 or 2.
- **The standalone mock server.** It is undocumented. Re-check it after CLI updates; any mock case failing will show it.
- **The trust prompt.** Every run here passed `--trust-plugin`. The first run in the repo from a terminal will ask `Trust this plugin directory?`.
- **Not exercised:** report publishing (`--no-publish` throughout), `llm` graders and the judge, `--concurrency`, and anything about Codex.
- **Kept sandboxes.** They remain under `/tmp/claude-eval-*`, read-only and sealed. Delete them with `chmod -R u+w` and then `rm -rf`, or leave them for `/tmp` cleanup.
