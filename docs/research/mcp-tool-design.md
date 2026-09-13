# MCP tool design for Agents (researched 2026-09-13)

Guidance from primary sources on designing the MCP tool surface our Skills use. The latest MCP spec revision is **2026-07-28** [9][16]. Items marked *(inference)* are our reading, not a vendor statement.

## 1. Granularity and tool count

- **Build workflows, not API wrappers.** "More tools don't always lead to better outcomes. A common error we've observed is tools that merely wrap existing software functionality or API endpoints." Build "a few thoughtful tools targeting specific high-impact workflows" [1].
  - Anthropic's examples: `schedule_event` instead of `list_users` + `list_events` + `create_event`, and `get_customer_context` instead of `get_customer_by_id` + `list_transactions` + `list_notes` [1].
- **Combine calls that always happen together.** OpenAI: "Combine functions that are always called in sequence" [20].
- **Consolidate related operations.** The Claude docs suggest one tool with an `action` parameter instead of `create_pr` / `review_pr` / `merge_pr`, because "fewer, more capable tools reduce selection ambiguity" [2].
- **Counter-rule: split by risk.** OpenAI says to "split operations when they have different permissions, safety risks, or confirmation requirements" and to "separate read and write behavior." Its example set is `list_projects`, `get_project`, `create_project`, `update_project`, `archive_project` [21].
  - This follows from annotations. `readOnlyHint` defaults to false [10], and Codex's `writes` approval mode "prompts for tools that aren't marked read-only" [22]. A tool that mixes reads and writes therefore prompts on every call. *(inference)*
- **Avoid overlapping tools.** "Too many tools or overlapping tools can also distract agents" [1]. "If a human engineer can't definitively say which tool should be used in a given situation, an AI agent can't be expected to do better", so curate a "minimal viable set of tools" [6].
  - Wrong-tool picks are "most common" when names are similar, e.g. `notification-send-user` vs `notification-send-channel` [5].
- **How many is too many:**
  - OpenAI: "Aim for fewer than 20 functions available at the start of a turn" [20].
  - Claude: tool selection "degrades once you exceed 30–50 available tools". Tool search is recommended at 10+ tools or more than 10k tokens of definitions [4]. Measured gains with tool search: Opus 4 went from 49% to 74% [5].
- **Context cost:** a five-server setup with 58 tools used about 55K tokens of definitions [5].
  - Claude Code defers MCP tools by default, so only tool names and server instructions load at session start. It sets no per-server tool cap [17].
  - The Codex MCP docs do not mention tool search or deferral [22].

## 2. Naming and namespacing

- **MCP spec** [9]:
  - Names SHOULD be 1–128 characters, case-sensitive, and unique within a server.
  - Allowed characters are `A-Z a-z 0-9 _ - .`, with no spaces.
  - Tools SHOULD be returned in a deterministic order, for prompt-cache hits.
- **Claude API** tool names must match `^[a-zA-Z0-9_-]{1,128}$`, so no dots [2]. Avoid `.` for portability. *(inference)*
- **Claude Code's callable name** is `mcp__<server>__<tool>`. For plugin servers it is `mcp__plugin_<plugin>_<server>__<tool>` [17].
- **Namespacing:** group by service and by resource, e.g. `asana_projects_search` [1]. Consistent prefixes let one tool-search query match a whole group [4].
  - Prefix vs suffix "non-trivial effects" on evals, varying by model; choose by your own evals [1].
- **Parameters** should be "unambiguously named: instead of … `user`, try … `user_id`" [1].

## 3. Descriptions and input schemas

- **Descriptions matter most.** They are "by far the most important factor in tool performance." Cover:
  - what the tool does;
  - when to use it and when not to;
  - what each parameter means;
  - caveats and what it does not return.

  Aim for "at least 3–4 sentences" [2].
- **Write for a new hire.** Make implicit context explicit, such as "definitions of niche terminology, relationships between underlying resources" [1]. OpenAI calls this the "intern test" [20].
- **Selection-oriented wording** (OpenAI): "Describe the user intent, not the implementation" and "distinguish it from similar tools" [21].
- **Make invalid inputs impossible.** "Use enums and object structure to prevent invalid states" [20]. Poka-yoke: "change the arguments so that it is harder to make mistakes" [7].
- **Don't make the model supply what the server knows.** "Don't require the model to fill in arguments you already possess" [20]. At the same time, "do not depend on the model guessing identifiers" [21]. The Active Home should be implicit server-side, not a parameter. *(inference)*
- **Examples:**
  - The Claude API has `input_examples`; complex-parameter accuracy went from 72% to 90% [5][2].
  - MCP tool definitions have no examples field [9], so put examples in the description. *(inference)*
- **Truncation:** Claude Code truncates each tool description and the server instructions at 2KB, so put critical details first [17].
- **What goes where:**
  - Per-tool "when to use" goes in the description.
  - Cross-tool workflows and constraints go in the MCP server `instructions` field. Examples: "Always call X before Y" and rate limits. Don't duplicate tool descriptions there [15].
  - Codex and Claude Code both read `instructions` [22][17]. An eval found 85% task success with instructions vs 60% without, but instructions "cannot guarantee behavior" [15].
  - OpenAI puts detailed "when and when not" guidance in the system prompt [20]. For us, that role belongs to Skills. *(inference)*

## 4. Return values

- **Return high-signal fields only.** Avoid low-level fields such as `uuid` and `mime_type`.
  - "Resolving arbitrary alphanumeric UUIDs to more semantically meaningful … language (or even a 0-indexed ID scheme) significantly improves Claude's precision" [1].
  - Return "semantic, stable identifiers (for example, slugs …)" [2] and "enough structured information for follow-up calls" [21].
  - Returning a stable slug alongside a human name satisfies both. *(inference)*
- **Offer a detail level.** Consider a `response_format` enum, `"concise"` or `"detailed"` [1].
- **Size:** use "pagination, range selection, filtering, and/or truncation with sensible default parameter values" [1].
  - **Claude Code** warns when output exceeds 10,000 tokens and caps it at 25,000 by default (`MAX_MCP_OUTPUT_TOKENS`). Larger results are saved to a file. A tool can raise its own cap with `_meta["anthropic/maxResultSizeChars"]`, up to 500,000 characters [17].
  - **Codex** has a per-tool `output_token_limit` [22].
- **`structuredContent` / `outputSchema`** [9]:
  - `structuredContent` holds a JSON result.
  - If an `outputSchema` is declared, the server MUST conform to it and clients SHOULD validate against it.
  - A tool returning structured content SHOULD also return the serialized JSON in a text block, for backward compatibility.
  - Claude Code supports `structuredContent` [18].
  - Results may also carry `resource_link` items [9].
- **State across calls:** MCP has no protocol-level session. Return an explicit handle from a creation tool and accept it on later calls.
  - Put the retention policy in the creation tool's description.
  - Unknown or expired handles should return a tool execution error that says so, so the model can recover [9].
  - The tool list "MUST NOT vary per-connection or as a side effect of other requests" [9].
  - This applies directly to a Session ID. *(inference)*

## 5. Errors

- **Two kinds** [9]:
  - **Protocol errors** (JSON-RPC) are for an unknown tool or a malformed request. The model is "less likely" to fix these.
  - **Tool execution errors** (`isError: true` in the result) are for "input validation errors … business logic errors". They carry "actionable feedback that language models can use to self-correct and retry". Clients SHOULD pass them to the model.
  - Schema: tool-originated errors "SHOULD be reported inside the result object … _not_ as an MCP protocol-level error" [10].
- **Spec example pattern** — say what's wrong, the rule, and the current state: "Invalid departure date: must be in the future. Current date is 08/08/2025." [9]
- **Write actionable errors.** Prompt-engineer them to give "specific and actionable improvements, rather than opaque error codes or tracebacks". Include examples of correct input [1]. Say "what went wrong and what Claude should try next" [3].
- **Retries:** Claude "will retry 2-3 times with corrections before apologizing to the user" [3].
- **Unsupported requests:** these "produce an understandable limitation instead of an unsafe approximation." OpenAI also recommends testing with invalid and unauthorized inputs [21].

## 6. Annotations

- **Fields and defaults** [10]:

  | Hint | Default | Meaning |
  |---|---|---|
  | `readOnlyHint` | false | Tool does not modify its environment |
  | `destructiveHint` | true | May make destructive updates; false means additive only. Meaningful only when not read-only |
  | `idempotentHint` | false | Repeating the same call has no extra effect. Meaningful only when not read-only |
  | `openWorldHint` | true | Interacts with external entities; false for a closed domain such as a memory tool |
  | `title` | — | Display name |

- **They are hints only.** Clients "should never make tool use decisions based on `ToolAnnotations` received from untrusted servers" [10].
- **How clients use them:** a trusted read-only tool "might be auto-approved", while a destructive one "gets a confirmation step". They are "not enforcement" [14]. OpenAI: they "do not replace server-side authorization, input validation, or confirmation for consequential actions" [21].
- **Per client:**
  - **Codex:** `default_tools_approval_mode` / per-tool `approval_mode` take `auto`, `prompt`, `writes` or `approve`. `writes` prompts for tools not marked read-only [22].
  - **Claude Code:** its docs only say annotations and titles show in `/mcp` [18]. To force a prompt on every call, use `_meta["anthropic/requiresUserInteraction"]: true` [17].
  - **Anthropic's directory** requires `title` plus `readOnlyHint` or `destructiveHint` on every tool [19].

## 7. Resources and prompts vs tools

- **Who controls what** [13][11][12]:
  - Tools are model-controlled.
  - Resources are application-driven: "passive data sources … read-only". The host decides how to include them.
  - Prompts are user-controlled templates, typically slash commands.
- **Claude Code:**
  - Resources are `@server:protocol://path` mentions, and Claude Code "automatically provides tools to list and read MCP resources".
  - Prompts become `/mcp__server__prompt` commands.
  - Elicitation is shown as a dialog [17].
- **Codex:** the MCP docs describe only tools and server instructions [22]; resources and prompts are not mentioned.
- **Consequence:** anything the model must read by itself should be a read-only tool, and optionally also a resource. *(inference)*
- **Spec changes in 2026-07-28** [16]:
  - Stateless requests.
  - Multi round-trip `input_required` results, for asking the user mid-call.
  - Cacheable `tools/list`.
  - Roots, Sampling and Logging deprecated.

## 8. Server-side enforcement vs model instructions

- **The spec puts enforcement on the server.** Servers MUST "validate all tool inputs" and "implement proper access controls". Clients SHOULD keep a human in the loop and confirm sensitive operations [9].
- **Instructions and annotations are not guarantees.** Server instructions are "not going to be followed the same way all the time" [15], and annotations "aren't enforcement" [14].
- **Business-rule violations belong in `isError` results.** The spec lists them as "business logic errors" [9]. So a server that refuses a write and explains why (e.g. moving a Decision out of Locked without the user's instruction) is using the mechanism as intended. *(inference)*
- **Explicit user confirmation:** the server can ask the user directly through elicitation / `input_required` in Claude Code [17][9], or require `requiresUserInteraction` [17]. Codex's docs do not mention elicitation [22]. *(inference: a model-supplied "user said so" flag is weaker than either.)*

## Sources

1. https://www.anthropic.com/engineering/writing-tools-for-agents
2. https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
3. https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
4. https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
5. https://www.anthropic.com/engineering/advanced-tool-use
6. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
7. https://www.anthropic.com/engineering/building-effective-agents
8. https://www.anthropic.com/engineering/code-execution-with-mcp (intermediate results cost context; 150K→2K tokens example)
9. https://modelcontextprotocol.io/specification/2026-07-28/server/tools
10. https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
11. https://modelcontextprotocol.io/specification/2026-07-28/server/resources
12. https://modelcontextprotocol.io/specification/2026-07-28/server/prompts
13. https://modelcontextprotocol.io/docs/learn/server-concepts
14. https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
15. https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/
16. https://blog.modelcontextprotocol.io/posts/2026-07-28/
17. https://code.claude.com/docs/en/mcp
18. https://code.claude.com/docs/en/changelog
19. https://claude.com/docs/connectors/building/submission
20. https://developers.openai.com/api/docs/guides/function-calling
21. https://developers.openai.com/apps-sdk/plan/tools
22. https://learn.chatgpt.com/docs/extend/mcp (Codex MCP; redirected from developers.openai.com/codex/mcp)
