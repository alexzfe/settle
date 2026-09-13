# MCP elicitation and server instructions (researched 2026-09-13)

Can our MCP server ask the user directly to confirm a Decision Lock, Reopen, Reject, or a saved Constraint, instead of trusting the model? Can a shared Session protocol live in the server's `instructions`? Findings come from primary sources, listed at the end. Local versions checked: `claude` 2.1.269, `codex-cli` 0.154.0. Items marked **unverified** are inferences, so test them before relying on them.

## 1. Elicitation in the spec

**The latest revision is `2026-07-28`, and it changed how elicitation travels** [3]:

- **Legacy era (`2025-11-25` and earlier):** the server sends `elicitation/create` to the client as a JSON-RPC request while it is still handling the client's `tools/call`. The tool handler waits for the answer and then returns its result. User input happens "*nested* inside other MCP server features" [4]. The client declares support in `initialize` [4].
- **Modern era (`2026-07-28`):** "The previous pattern of server-initiated requests is no longer supported. This is a breaking change." [2] The protocol no longer has `initialize` or sessions. Every request carries `_meta.io.modelcontextprotocol/clientCapabilities` [3]. Instead of pushing a request, the server answers `tools/call` (or `prompts/get` / `resources/read`) with an `InputRequiredResult`: `resultType: "input_required"`, an `inputRequests` map (for example `{confirm: {method: "elicitation/create", params}}`), and an optional opaque `requestState`. The client asks the user, then **retries** the original call with a new JSON-RPC id, `inputResponses`, and the same `requestState` byte for byte [2].
  - Servers "MUST treat `requestState` as an attacker-controlled input". They must integrity-protect it (HMAC or AEAD) if it influences business logic. They SHOULD bind it to the principal, a short TTL, and a digest of the originating request. Single use "MUST" be enforced server-side where it matters [2].
  - Servers "MUST NOT assume that clients will fulfill the `inputRequests` or retry" [2].
  - The revision also removed `notifications/elicitation/complete` and `elicitationId`, both added in 2025-11-25 [3].
- **Both eras can coexist:** a server may serve legacy and modern clients on one endpoint [5].

**Modes and capabilities** [1]:

- `form` collects data in-band. `url` sends the user to a URL out-of-band and was introduced in 2025-11-25.
- A client declares `elicitation: {form: {}, url: {}}`. An empty `{}` means form mode only. Servers "MUST NOT send elicitation requests with modes that are not supported by the client."
- Form mode MUST NOT request passwords, API keys, tokens, or payment credentials.

**Schema rules for form mode** [1]: the schema must be a flat object of primitive properties only.

| Type | Allowed keywords |
|---|---|
| `string` | `minLength`, `maxLength`, `format` (`email`, `uri`, `date`, `date-time`), `default` |
| `number` / `integer` | `minimum`, `maximum`, `default` |
| `boolean` | `default` |
| Single-select enum | `enum`, or `oneOf` of `{const, title}` |
| Multi-select enum | array with `items.enum` or `items.anyOf`, plus `minItems` / `maxItems` |

Nested objects and arrays of objects are "intentionally not supported". The 2025-11-25 string schema also allowed `pattern`; the 2026-07-28 page omits it [1][4].

**Responses** [1]:

- `accept`: in form mode, `content` carries the submitted data.
- `decline`: the user explicitly refused.
- `cancel`: the user dismissed without choosing.
- Servers MUST handle decline and cancel.
- For URL mode, `accept` only means the user consented to open the URL, not that the interaction finished.

**Client obligations:** clients MUST show which server is asking, offer decline and cancel, and let the user review a form before sending [1]. Nothing in the protocol stops a client, or automation the user configured, from answering on the user's behalf. That is a client policy question (see §2 and §3).

## 2. Claude Code

- **Supported since v2.1.76:** "Added MCP elicitation support — MCP servers can now request structured input mid-task via an interactive dialog (form fields or browser URL)". The same release added the `Elicitation` and `ElicitationResult` hooks [12]. No configuration is needed: "elicitation dialogs appear automatically" [8].
- **How it looks in the terminal:**
  - Form mode is a dialog with server-defined fields and Accept/Decline buttons. Since v2.1.239 tall forms scroll "with hidden fields reachable by scrolling and Accept/Decline always visible" [8][12].
  - URL mode hands the URL to the system URL handler, and the user confirms in the CLI afterwards. URLs longer than about 8,000 characters (about 4,000 if heavily percent-escaped) can only be declined [8].
  - If the user hasn't typed for about 6 seconds, a desktop notification fires (`elicitation_dialog`, `elicitation_url_dialog`) [9].
- **Blocking and timeouts:**
  - "A call waiting on an open elicitation dialog isn't backgrounded while the dialog is open; the server is blocked on your input" [8].
  - HTTP servers have a 60-second per-request timeout by default. Setting `MCP_TOOL_TIMEOUT` or a per-server `timeout` above 60000 raises it [11].
  - An idle timeout of 5 minutes for HTTP aborts a call that sends "no response and no progress notification" [8][11]. A per-server `timeout` ≥ 1000 raises that server's idle floor [8].
  - **Unverified:** whether a legacy-era open dialog pauses the 60-second or idle timers. In the modern era each round is a separate request, so the user's thinking time falls between requests.
- **Protocol era:**
  - Since v2.1.232 Claude Code uses a "v2 runtime" built on TS SDK 2.0. It probes HTTP servers for 2026-07-28 and uses that revision when the server supports it. The runtime stays on v1 (legacy only) on Bedrock, Vertex (Agent Platform), Foundry, a Claude apps gateway, or with feature-flag fetching off [8].
  - `MCP_SDK_GENERATION` and `MCP_PROTOCOL_NEGOTIATION` override this [8][11].
  - **Unverified:** that the v2 runtime renders `input_required` elicitations like pushed ones. The docs don't split the elicitation section by era, and the TS SDK 2.0 client handles `input_required` rounds automatically by default [25].
- **Does the model see the answer?** The docs don't say. The answer goes to the server. `ElicitationResult` runs "before the response is sent back to the server" [9]. Assume the model sees only what our tool result says.
- **Hooks** [9]:
  - `Elicitation` (matcher is the server name) receives `mcp_server_name`, `message`, `mode`, `url`, `elicitation_id`, and `requested_schema`. It can answer with `hookSpecificOutput: {action, content}`, which skips the dialog. Exit code 2 denies.
  - `ElicitationResult` can observe, override, or block the user's answer. Exit code 2 turns it into `decline`.
  - These hooks support `command`, `http`, and `mcp_tool` handlers, but not `prompt` or `agent`. Plugins can ship them too [13].
- **Headless mode:** with `--permission-prompts none`, an elicitation that no hook answers is cancelled [10]. v2.1.117 fixed elicitation auto-cancelling in print/SDK mode [12].
- **Plugin HTTP servers:** "Plugin MCP servers work identically to user-configured servers" [8]. The docs contain no plugin-specific elicitation caveat. **Unverified** end to end.

## 3. Codex and other clients

**Codex CLI / app** (source-level evidence, since the docs are silent on elicitation [14]):

- **Default is the legacy era.** In 0.154.0 `tool_call_mcp_elicitation` and `auth_elicitation` are `stable`, default on. `mcp_2026_07_28` is "under development", default off [15], and local `codex features list` agrees.
- **The TUI renders third-party form elicitations**, including those declared through a plugin, but only some field types [17]:
  - Rendered: `string` fields as text input, `boolean` as a True/False select, and single-select enums.
  - Not rendered: any `number`/`integer` or multi-select field makes the whole form unparseable. Codex then shows a generic "Yes, provide the requested info / No / Cancel" dialog and submits `{"action":"accept","content":{}}` [17][21c].
  - The Desktop app renders elicitations too, with open bugs (#40390, #35906). The Android remote shows no Accept button (#44899) [21].
- **Codex can answer without the user** [16][21d]:
  - When the tool's approval is auto-approved (for example `approval_mode = "approve"` or "always allow"), Codex auto-accepts with `content: {}` even if the schema has required fields.
  - Some approval policies make Codex decline by policy (`elicitation_is_rejected_by_policy`). An auto-review reviewer may also answer [16].
- **`codex exec`** "auto-cancels elicitation instead of surfacing it interactively" [18].
- **Timeouts:** `tool_timeout_sec` defaults to 60 seconds [14]. Core code "coordinates user elicitations that pause tool-result delivery" [20]. **Unverified:** whether that pauses the timeout. One open issue reports elicitations that pend forever in headless app-server hosts (#39149) [21].
- **The 2026-07-28 lane is buggy when enabled:** url-mode `input_required` fails with "Unexpected response type" (#40657) [21].
- **Other open issues:** the original "Elicitation support" issue #13405 is still open [21], and a top-level `title` in `requestedSchema` is rejected (#31163) [21].

**modelcontextprotocol.io matrix:** only the [Extension Support Matrix](https://modelcontextprotocol.io/extensions/client-matrix) is published. It covers MCP Apps and two auth extensions, has no elicitation or instructions column, and doesn't list Claude Code or Codex [7]. `modelcontextprotocol.io/clients` now redirects to the intro page. No official core-feature matrix exists.

## 4. Server `instructions`

- **Spec:** `instructions` is "optional natural-language guidance for LLMs on how to use this server effectively". In 2026-07-28 it is returned by `server/discover` [6]. Legacy servers return it in the `initialize` result.
- **Claude Code:** supported since v1.0.52 [12]. "Only tool names and server instructions load at session start" with tool search, and they help Claude "understand when to search for your tools". They are **truncated at 2KB**, so "put critical details near the start" [8][12].
- **Codex:** "reads the MCP `instructions` field returned during initialization and uses it as server-wide guidance alongside the server's tools". The docs recommend using it "for cross-tool workflows, constraints", and advise: "Keep the first 512 characters self-contained" [14]. In source it becomes the `namespace_description` of the server's tool namespace [19].
- **Verdict:** a compact Session protocol can live there, portable across both clients. It must fit about 2KB, with the core rules in the first 512 characters. Longer procedure belongs in Skills.

## 5. TypeScript SDK

v2.0.0 was released 2026-07-27, split into `@modelcontextprotocol/server`, `client`, `node`, `express`, and other packages. Release 1.30.0 was also published on 2026-07-27 [26].

- **Legacy era:** `ctx.mcpReq.elicitInput({mode, message, requestedSchema})` pushes `elicitation/create` mid-handler and resolves with `{action, content}`. The SDK validates accepted content against the schema. The default timeout is 60 seconds, so pass `{timeout, signal: ctx.mcpReq.signal}` [22]. Without the client capability it throws, and the tool returns `isError` [22].
- **Modern era:** `elicitInput` throws. The handler instead returns `inputRequired({inputRequests: {confirm: inputRequired.elicit({message, requestedSchema})}, requestState})` [23]:
  - On re-entry, `acceptedContent(ctx.mcpReq.inputResponses, key, zodSchema)` and `inputResponse(...)` read the answers.
  - `createRequestStateCodec({key, ttlSeconds})` produces a signed, not encrypted, `requestState`.
  - A missing capability yields `-32021` [23].
- **Serving both eras:** `createMcpHandler(({era}) => server)` serves both eras over HTTP. A "legacy shim", on by default, fulfils an `inputRequired` return for 2025-era clients "by pushing real `elicitation/create`… then re-enters the handler" [23][24]. **One handler therefore covers Claude Code (modern) and Codex (legacy).**

## Client support

| | Form elicitation | URL mode | Modern `input_required` | Can answer without the user | `instructions` |
|---|---|---|---|---|---|
| Claude Code 2.1.269 | Yes (since 2.1.76), terminal dialog | Yes, system browser | v2 runtime probes HTTP servers (unverified end to end) | `Elicitation` hooks, including plugin hooks; headless cancels | Loaded at start, 2KB cap |
| Codex CLI 0.154.0 | Yes; string, boolean, and enum fields only | Flag on; not verified for third-party servers | Off by default; buggy when on | Auto-accept `{}` on approved tools; policy decline; `exec` cancels | Namespace description, 512-char core |
| Codex Desktop / remote | Yes, with UI bugs | Unverified | Same as CLI | Same as CLI | Same as CLI |
| Others | No official matrix [7] | | | | |

## Consequences for us

1. **Claude Code today:** yes, elicitation is a usable, human-facing confirmation channel for our localhost HTTP plugin server. The Lock, Reopen, Reject, and Constraint tools can block on it. Caveats: user-configured `Elicitation` hooks can auto-answer, and headless mode cancels.
2. **How to make a confirmation robust:**
   - Use one required `boolean` (or single-select enum) field, for example `confirm`.
   - Commit only on `action === "accept" && confirm === true`. That rejects Codex's `content: {}` auto-accepts.
   - Put a digest of the exact pending change in an HMAC'd `requestState` and enforce single use server-side.
   - Treat decline, cancel, or no retry as "not confirmed". The tool result should tell the model not to retry on its own.
3. **Timeouts and fields:** set a generous per-server `timeout` (for example 600000) in the plugin's MCP config to cover legacy-era dialogs. Avoid number and multi-select fields, which Codex can't render.
4. **Codex degrades:**
   - Interactive TUI and Desktop work, with field-type limits.
   - "Always allow" tool approvals auto-accept with empty content, which our required field then rejects.
   - `codex exec` and restrictive policies cancel or decline.
   - We therefore need a fallback: if the client lacks the `elicitation` capability, or answers `cancel` or `decline` by policy, fall back to model-mediated confirmation. Record that the Decision was confirmed via the Agent, not the server.
5. **Session protocol:** put a ≤2KB version in `instructions`, with the essentials in the first 512 characters. Keep the full procedure in Skills.

## Sources

1. https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
2. https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
3. https://modelcontextprotocol.io/specification/2026-07-28/changelog
4. https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
5. https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle (Versioning and Compatibility)
6. https://modelcontextprotocol.io/specification/2026-07-28/server/discover
7. https://modelcontextprotocol.io/extensions/client-matrix
8. https://code.claude.com/docs/en/mcp (sections: MCP client runtimes, timeouts, Respond to MCP elicitation requests, tool search)
9. https://code.claude.com/docs/en/hooks (Elicitation, ElicitationResult, Notification)
10. https://code.claude.com/docs/en/headless
11. https://code.claude.com/docs/en/env-vars (`MCP_TOOL_TIMEOUT`, `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, `MCP_SDK_GENERATION`, `MCP_PROTOCOL_NEGOTIATION`)
12. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (1.0.52, 2.1.76, 2.1.84, 2.1.117, 2.1.238, 2.1.239, 2.1.257)
13. https://code.claude.com/docs/en/plugins-reference
14. https://learn.chatgpt.com/docs/extend/mcp?surface=cli (redirect target of developers.openai.com/codex/mcp)
15. https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs
16. https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/elicitation.rs
17. https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/mcp_server_elicitation.rs
18. https://github.com/openai/codex/blob/main/codex-rs/exec/src/lib.rs
19. https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/rmcp_client.rs
20. https://github.com/openai/codex/blob/main/codex-rs/core/src/elicitation.rs
21. Codex issues: https://github.com/openai/codex/issues/40657 (a, MRTR url failure), /13405 (b), /41797 (c, numeric fallback), /23383 (d, auto-accept `{}`), /39149, /31163, /40390, /35906, /44899
22. https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/elicitation.md
23. https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/input-required.md
24. https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md
25. https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/server-requests.md
26. https://github.com/modelcontextprotocol/typescript-sdk/releases
