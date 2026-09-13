# `claude plugin eval` for testing our Skills (researched 2026-09-13)

What Claude Code's plugin eval harness tests, how suites are written and run, and how it compares with Anthropic's other skill-evaluation guidance. Checked against Claude Code 2.1.269. The public docs page [1] exists. The CLI's own embedded reference [3] still says "no public documentation page for them yet", which is out of date. Where [1] and [3] overlap they agree, and [3] has more detail. Re-verify anything load-bearing, because this changes fast.

## What it is

- `claude plugin eval [target]` runs eval cases against a plugin and scores them. A case is "a realistic prompt plus one or more graders" [1][2]. Each run is "a fresh, isolated non-interactive session with only your plugin loaded" (`claude -p`), which runs until Claude finishes or hits the turn or time cap [1][3].
- **Baseline arm:** by default each case also runs with no plugin loaded. The report shows `WITH`, `W/OUT`, and `Δ`, which is what the plugin contributed [1][2]. `--ablation none` runs only the with-plugin arm [2].
- `claude plugin eval init` authors the suite. It interviews you, reads the plugin, proposes 4–6 should-fire and 1–2 should-not-fire prompts, designs graders, pilots them with `--runs 1`, and writes one case directory per prompt. `--bare <name>` writes a blank template instead [2][3].
- **Status:** generally available and on by default for all providers. Anthropic can switch it off with a server-side kill switch ("currently unavailable"). The "early access" message means the build is old [1][3]. It first shipped in 2.1.198, the stable `--json` v1 format in 2.1.210, and the current defaults in 2.1.224 [3].

## What it tests

| Concern | How | Source |
|---|---|---|
| Skill triggering | `tool_used` grader with `tool: Skill` and `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?<skill>"'`. With the baseline arm on, this is only a "plugin-fired" indicator (`withOnly: true`, `scored: false`) unless you set `arm: both`. A "must not fire" check is `min: 0, max: 0, arm: both`. | [2][3] |
| Output quality | `regex` over the final message, the trace, or a file's contents. `llm` rubric judged by a second model. `baseline`: the run must be at least as good as a reference transcript. | [1][3] |
| MCP tool use | `tool_used` / `tool_order` on `mcp__plugin_<plugin>_<server>__<tool>`, with `input_match` (a regex over the JSON input) and `min`/`max` counts. `mock_calls` shows the grader every call made to a mocked tool (input, answer, and whether it errored or aborted). | [3] |
| Produced files | `file_exists` (a glob over files created during the run). `{source: file, path}` grades a file's contents, and images are shown to the judge. | [1][3] |
| Hooks | The plugin's hooks load and run, unsandboxed, as you [1][3]. No grader targets hooks directly. You can only see their effects in the trace or in files. | [1][3] |
| Structure, not behaviour | `claude plugin validate [--strict] [--json] <path>` checks manifests, skills, agents, and commands. `claude plugin details <name>` shows the plugin's components and projected token cost. | [4] |
| `/skill-doctor` | An in-session report of skill usage and context cost (per-skill listing cost, 7-day tokens and uses, never-invoked warnings, unused plugins). It is **not** a linter and not a test. | [3] |

## Suite format

- **Location:** `evals/` at the plugin root. Override it with `--eval-dir` or `"experimental": {"evals": "<dir>"}` in `plugin.json`. A top-level `"evals"` key is ignored [2][3].
- **Layout:** `evals/<case>/prompt.md`, plus `graders/<name>.md`, an optional `case.yaml`, optional per-case `mocks/`, and fixtures. There is also a suite-wide `evals/mocks/<server>/`. Results go to `evals/results/<timestamp>/` (gitignore it) [1][3].
- **`prompt.md`:** the frontmatter keys are `name`, `description`, `tags`, `plugins`, `runs` (default 3, max 50), `expected_outcome`, `model`, `max_turns` (default 10, max 200), `timeout_seconds` (default 300, max 3600), `allowed_tools`, `append_system_prompt`, and `env` (keys must match `EVAL_*`). The body is the prompt. An unknown key is an error [1][3].
- **`case.yaml`:** carries what `prompt.md` cannot: `context.scaffold_script` (runs only with `--scaffold`), `context.history_file`, and `context.add_dirs` (read-only fixture directories). It needs `schema_version: "1.1"` and `name`, and graders can be written inline [1][3].
- **Graders:** the frontmatter has `type`, `weight` (default 1), and `arm`. The body is the rubric or regex pattern. There are six types: four free and deterministic (`regex`, `tool_used`, `tool_order`, `file_exists`) and two paid (`llm`, which is 2-of-3 judge votes, and `baseline`). "There are no custom-code graders by design" [1][3].
- **What a grader can see:** `last_message` (the default), `trace` (JSONL; a regex sees all of it, while the judge sees only the first and last 12 messages), `files` (created **paths** only), `{source: file, path}`, and `mock_calls` [3].
- **Scoring:** a run's score is the weighted fraction of graders passed. A case's score is the mean over its runs. A case passes at `--threshold`, which defaults to **1.0** [1][3].

## Multi-turn

- **No simulated user.** Each run sends one user prompt, and the agent then works through up to `max_turns` agentic turns [1][3].
- **The only multi-turn mechanism is replay.** `context.history_file` points to a `.jsonl` transcript. The harness resumes it (`--resume`) and sends the case's prompt as the next user turn: "replay a known-good conversation up to turn N-1 and evaluate turn N" [1][3]. Prefer `--ablation none` for replay cases [3].
- **Undocumented:** how `AskUserQuestion` behaves with no user present. It is in the default read-only tool set [3], but neither [1] nor [3] says what happens when it is called. Our reading is that a grilling Skill's run ends when the agent asks its question, and the question becomes `last_message`. Confirm this with a pilot run.

## How it runs

- **Sandbox:** each run gets a throwaway `HOME`, working directory, and `CLAUDE_CONFIG_DIR`. Only the plugin under test loads, with no user or project settings, `CLAUDE.md`, or other MCP servers. It runs in `dontAsk` mode with read-only tools. `Bash`, `Write`, `Edit`, `Web*`, and `mcp__*` need an operator `--allow-tools` grant. Granted Bash runs in the OS sandbox (on Linux this needs bubblewrap and socat). The Artifact tool is unavailable [1][3]. It is "not an OS sandbox; network is not blocked" for hooks or real MCP servers [3]. The eval cases themselves are unreadable to the agent [3].
- **MCP (default `--mocks record`):** a server with mock files under `mocks/<server>/<tool>.md` is replaced by a stand-in with the same name. Mocked tools are allowed automatically, and the server's other tools are denied. A server with no mock is **not started at all**, so its tools are unavailable [1][2][3]. Mock types:
  - **Canned:** the file body, with `{{input.x}}` and `{{file:fixtures/...}}` substitution [3].
  - **Input guard:** `expect:` in the frontmatter. A violating call aborts the run with score 0 [3].
  - **Error:** `error: true` returns the body as a tool error [3].
  - **Agent mock:** `type: agent` plus `abort_when:`, where a small model plays the server. Its answers are recorded and can be committed to `mocks/.replay/<server>/` for deterministic replay [3].
- **Real servers:** `--allow-real-servers` starts the real servers that have no mock. `--mocks off` starts every real server, outside the sandbox, with its tools gated by `--allow-tools` [2][3]. The docs only describe servers as *processes* that get started. A localhost **HTTP** server declared by URL is not addressed. Our inference is that you would run the server in the CI job, pass `--mocks off` or `--allow-real-servers` plus `--allow-tools "mcp__plugin_<plugin>_<server>__*"`, and give each run a server-state reset. Pilot this before relying on it. [3] advises: "start long-lived services in the CI job, not per case".
- **Cost:** every agent run and judge call is billed to your plan or API account [1]. Total cost is roughly cases × runs × arms, plus 3 judge calls per `llm`/`baseline` grader [3]. The judge defaults to Haiku (`--judge-model`) [2]. `--model` pins the agent model, and `ANTHROPIC_MODEL` is not inherited [3]. `--max-cost-usd` stops the run (exit 2, partial results) [2]. `-j` runs 1–8 runs in parallel on one rate limit [2].
- **Output:**
  - A stdout table and `aggregate-result.json`, which is the same v1 document that `--json` prints: camelCase, additive-only, with `schemaVersion: 1`, `suite`, `cases[].arms.{with,without}[].graders[]`, and `aggregates` (`score`, `passRate`, `delta`) [1][3].
  - A self-contained `report.html`, published as a private claude.ai artifact when the account allows it. `--no-publish` keeps it local [1][2][3].
- **CI:** `claude plugin eval . --trust-plugin --json results.json --threshold 0.8 --model <pinned> --judge-model <pinned> --no-publish --max-cost-usd 20` [1][3]. Exit codes: 0 means every case passed; 1 means a case fell below threshold, a load error, or an untrusted directory; 2 means partial (cost ceiling or auth failure); 130 is interrupted; 143 is terminated [1][3].

## Limitations and unclear points

- There is no simulated or scripted multi-turn user, only transcript replay [1][3]. There are no custom-code graders [1][3]. Regex `count:N` is exact, with no range. Only `tool_used` has `min`/`max` [3].
- The `llm` judge is noisy on long inputs and sees at most 100k characters of its focus, keeping the head and tail. Prefer `regex` for long artifacts [3].
- `file_exists` and `files` ignore files that were modified or pre-existed [3]. A subagent's narrative text is not recorded in the trace [3].
- Agent mocks fail if a plugin `PostToolUse` hook rewrites a mocked tool's output [3].
- The docs don't say how a localhost HTTP server behaves under `--mocks off`, or how `AskUserQuestion` behaves headless (see above).
- A suite passing is "not a security vetting" of the plugin [1][2].

## Other Anthropic approaches, for comparison

- **skill-creator plugin** [5][6][7][8][9]: a different format from plugin eval [1]. It stores `evals/evals.json` (`prompt`, `expected_output`, `files`, `expectations`) and runs each case twice in parallel subagents, with the skill and as a baseline. A grader agent writes `grading.json` (`text`/`passed`/`evidence`), and the results roll up into `benchmark.json` (pass rate, time, tokens, delta). It also offers an HTML viewer for human feedback and a blind A/B comparator. Its **trigger eval** covers about 20 `{query, should_trigger}` items with a 60/40 train/test split and up to 5 description-rewrite iterations. `run_eval.py` detects a `Skill` call in `claude -p --output-format stream-json`, with 3 runs per query and a 0.5 pass threshold. Official plugins ship this file (for example math-olympiad's `evals/trigger_eval.json` [12]).
- **Agent Skills best practices** [10]:
  - Build evaluations first: at least three scenarios, a no-Skill baseline, and tests with Haiku, Sonnet, and Opus.
  - Iterate with "Claude A" (which writes the Skill) and "Claude B" (which uses it).
  - The page says "There is not currently a built-in way to run these evaluations". That platform page does not mention `claude plugin eval`.
- **"Demystifying evals for AI agents"** [11]:
  - Vocabulary: task, trial, grader, transcript, outcome. Graders are code-based, model-based, or human.
  - For conversational agents, "a second LLM to simulate the user" (plugin eval lacks this).
  - pass@k vs pass^k: at least one success in k tries vs all k succeeding.
  - "grade what the agent produced, not the path it took".

## Sketch: a purchase-grilling Session case

Server and tool names below are placeholders (the MCP server has none yet).

```
evals/
  mocks/design/get_active_home.md       # canned: Rooms, palette, Design Direction
  mocks/design/record_decision.md       # expect: {room: string, kind: [requirement]} → aborts on bad input
  grilling-opens/prompt.md              # "I want a new sofa for the living room"
  grilling-opens/graders/{fires,reads-home,no-premature-write,asks-one-question}.md
  grilling-records/case.yaml            # context.history_file: history.jsonl (Q&A up to the user's answer)
  grilling-records/graders/{records-requirement,traces-to-room}.md
  not-grilling/prompt.md                # "Linen or velvet — which wears better?"  → Skill max 0, arm both
```

- **Opening case:** checks that the Skill fires (an indicator only), that `get_active_home` is called at least once, and that `record_decision` is called zero times (`min: 0, max: 0, arm: both`). An `llm` grader on `last_message` checks that the reply names the Active Home and asks one focused question.
- **Replay case:** checks `record_decision` with an `input_match` on the budget the user gave. An `llm` grader focused on `mock_calls` checks that the Requirement traces to the living room.

## Sources

1. https://code.claude.com/docs/en/plugin-evals
2. `claude plugin eval --help` and `claude plugin eval init --help` (Claude Code 2.1.269, run locally)
3. Reference embedded in the Claude Code 2.1.269 binary: `references/plugin-eval.md` and `references/plugin-eval-quickref.md` (zstd resources, extracted read-only)
4. `claude plugin --help` and `claude plugin validate --help` (2.1.269)
5. https://code.claude.com/docs/en/skills (section "Run evals with skill-creator")
6. https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
7. https://github.com/anthropics/skills/blob/main/skills/skill-creator/references/schemas.md
8. https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/run_eval.py
9. https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills (2026-03-03)
10. https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices (section "Evaluation and iteration")
11. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (2026-01-09)
12. https://github.com/anthropics/claude-plugins-official/tree/main/plugins/math-olympiad (`skills/math-olympiad/evals/trigger_eval.json`, read from the local marketplace clone)
