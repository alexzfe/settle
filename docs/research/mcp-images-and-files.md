# MCP images and files (researched 2026-09-13)

How do a Blueprint (image or PDF) and Room Photos (JPEG/PNG/HEIC from a phone) get into our platform so the AI can see them? We compare three flows: (A) the user uploads in the web UI and an MCP tool returns the files as image content; (B) the Agent passes a local path and the server copies the file; (C) the Agent sends the bytes through MCP. Findings come from primary sources, listed at the end. Local versions checked: `claude` 2.1.269, `codex-cli` 0.154.0. Codex source is at commit `6f39a47` (2026-09-13) and TS SDK source at `b654261` (2026-09-11). Items marked **unverified** are inferences.

## 1. What the protocol offers

**Tool result content** is the same in 2025-11-25 and 2026-07-28 [1][2]:

- `text`
- `image` and `audio`: base64 `data` plus `mimeType`
- `resource_link`: a URI with `name`, `description`, `mimeType`. It "can be subscribed to or fetched by the client".
- embedded `resource`: `text` or base64 `blob` contents
- `structuredContent`

All of these can carry `annotations` (`audience`, `priority`). The spec sets no size limit and no list of allowed image MIME types.

**Resources** carry binary data as a base64 `blob`, and a resource may declare an optional `size`. "Binary data MUST be properly encoded." A client may fetch an `https://` resource directly instead of through the server [3].

**Client-to-server files: no mechanism exists in either revision.** Tool arguments are plain JSON, so bytes can only travel as base64 strings.

- The File Uploads WG charter (2026-04-23) says: "Today, servers that need a file from the user resort to prose instructions asking for base64 strings or local paths" [6].
- SEP-2356 would have added `x-mcp-file` fields carrying `data:` URIs. It was closed on 2026-06-26 in favour of SEP-2631 [7].
- SEP-2631 ("File Objects and Transfer") is a draft. It adds `x-mcp-file` (`accept`, `maxSize`, `transferModes`) and out-of-band `files/authorizeUpload` / `files/authorizeDownload`, so that "large files no longer need to be encoded into inline `data:` URIs". It is **not in 2026-07-28** [5][8].
- Server-to-client delivery is "already covered by Resources and `BlobResourceContents`" [6].

**Roots do not give a server access to client files.**

- Roots are deprecated in 2026-07-28 (SEP-2577). Their migration note says: "pass directories or files via tool parameters, resource URIs, or server configuration" [4][5].
- Roots are "informational guidance rather than an access-control mechanism". Each root is just a `file://` URI [4].
- A server can only use a root if it shares the client's filesystem, which is the same limit as flow B.

## 2. Claude Code

**How MCP tool results reach the model.** Read from the bundled JS in the 2.1.269 binary [13]:

| Block | What the model gets |
|---|---|
| `image` with a supported MIME type | An image block, resized within limits |
| `image` with an unsupported MIME type (SVG since 2.1.144; HEIC is **unverified**) | Bytes saved to disk. The model gets a text reference `[Image from <server>] …` with the path [12] |
| `resource` with `text` | Text: `[Resource from <server> at <uri>] <text>` |
| `resource` with a `blob` of image type | The same text label, plus an image block |
| `resource` with any other `blob` (PDF, Office, audio) | Decoded bytes saved to disk "with the correct file extension", and a text reference (since 2.1.69) [12]. **Unverified:** the model can then open a saved PDF with Read. |
| `resource_link` | Text only: `[Resource link: <name>] <uri> (<description>)` (supported since 1.0.44). Nothing is fetched automatically. The model can call `ReadMcpResourceTool` [10] |
| `structuredContent` together with `content` | Both are kept. v2.1.128 fixed images being dropped in this case [12] |

**Limits.**

- `MAX_MCP_OUTPUT_TOKENS` defaults to 25,000, and a warning appears above 10,000 tokens.
  - "Tools that return image data are still subject to `MAX_MCP_OUTPUT_TOKENS`." `_meta["anthropic/maxResultSizeChars"]` (at most 500K characters) raises only the text limit.
  - An over-limit result *without* images is saved to a file. The docs don't say what happens to an over-limit result *with* images [9][11].
- Image formats: the API accepts JPEG, PNG, GIF, and WebP only.
- Image cost: ⌈w/28⌉×⌈h/28⌉ visual tokens. Claude 4.7+ models allow at most 2576 px on the long edge and 4784 tokens per image. Other limits: 8000×8000 px and 10 MB (base64) per image, and 32 MB per request. Above 20 images in one request, every image must be ≤2000 px [15].
- Claude Code itself resizes images to at most 2000 px per side for newer models (2.1.122) [12]. A 2000×1500 image costs 3,888 tokens. **Unverified:** about 6 such photos therefore fit in one tool result under the default 25K cap.
- Images accumulate in history. Changelog fixes mention stripping oversized or old images and the 32 MB request cap (2.1.126, 2.1.229, 2.1.257) [12].

**Read tool (flow B's "Agent looks itself").**

- Images: "PNG, JPG, and other image formats" arrive as visual content, resized and recompressed. Since 2.1.196, an image still over 500 KB after resizing is re-encoded as JPEG [10].
- PDFs: supported since 1.0.58. Short PDFs are read whole. Above 10 pages Read uses `pages`, up to 20 pages per call (2.1.30) [10][12].
- **HEIC: not on Linux.**
  - Since 2.1.265, image processing uses "the runtime's built-in image support" [12].
  - The binary contains "HEIC/AVIF/TIFF require the OS codec" [13].
  - Local test on Linux with 2.1.269: Read of a valid `.heic` (ImageMagick-generated) returned raw bytes as text, not an image [14].
  - macOS, where an OS codec exists, is **unverified**.

**Roots:** Claude Code answers `roots/list` with the launch directory plus `--add-dir` directories (since 2.1.203) [9][12].

## 3. Codex CLI / app

**How MCP tool results reach the model.** From source [16][17]:

- **`image` → `input_image` data URL.**
  - If `mimeType` is missing, Codex falls back to `application/octet-stream`.
  - Detail comes from `_meta["codex/imageDetail"]` (`auto`/`low`/`high`/`original`) and defaults to `high` [16].
  - Images are then resized: at most 2048 px at `high`, and at most 6000 px at `original` where the model allows it [18][19].
  - Decodable formats are PNG, JPEG, GIF, and WebP (the `image` crate's features). Anything else is replaced by "image content omitted because it could not be processed" [18][19]. **Unverified** for HEIC specifically, though no HEIC decoder is compiled in.
  - Models without image input get `<image content omitted because you do not support image input>` [17].
- **If `structuredContent` is non-null, the model gets only the serialized `structuredContent` as text. All `content` blocks, images included, are dropped** [16] (issue #10334 is still open [23]).
- **`resource_link` and embedded `resource` are passed to the model as their raw JSON, as text** [16]. An embedded `blob` would therefore put its base64 into context as text.
- The copy saved to the event log and rollout is truncated above 1 MiB (#44126). The Desktop app doesn't show MCP images, though the model does see them (#43497) [17][23].
- `tool_timeout_sec` defaults to 60. A per-tool `output_token_limit` exists; its default for images is **unverified** [22].

**Local files:**

- The `view_image` tool is stable and on by default. It reads a path relative to cwd through the sandboxed filesystem and rejects non-images [20].
- The CLI attaches images with `-i`/`--image`. The docs say Codex "accepts common image formats, including PNG and JPEG" [21].
- **No PDF support:** #1797 is still open [23].
- **No HEIC:** #16896 ("Add HEIC image support on Mac") was closed on 2026-05-10 for lack of upvotes. #42975 reports a Desktop crash on large HEIC previews [23].

**Roots:** no `roots/list` handler or `roots` capability was found in `codex-rs`, only the MRTR request mapping [25]. **Unverified**, but assume Codex has no roots support.

## 4. Sending bytes from the Agent (flow C)

- **No documented tool-argument size limit** exists in either client [9][11][22].
- **The real limit is generation.** The model has to *emit* every base64 character as output tokens. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` caps this per model (tens of thousands of tokens) [11]. A 3 MB phone JPEG is about 4 MB of base64, which is orders of magnitude beyond that (**inference**).
- **The model doesn't have the bytes anyway.** Read and `view_image` give it pixels, not bytes. It would have to `base64` the file in a shell and copy the output back out (**inference**).
- **Server side:** the TS SDK's HTTP entry points reject request bodies over `DEFAULT_MAX_REQUEST_BODY_SIZE` = 4 MiB with 413 unless `maxRequestBodySize` is raised. The legacy SSE transport has the same 4 MB cap [24].
- **Approval UI:** the spec says clients SHOULD show tool inputs to the user before calling [1]. A multi-MB argument is hostile to that.
- **Viable workaround (inference):** the Agent runs `curl -F file=@<path>` against the web app's HTTP upload endpoint. The bytes then travel through the shell, not model tokens. This works locally, and later against a hosted server with auth. **Unverified:** that Codex's default sandbox allows that network call.
- **Protocol-native option:** URL-mode elicitation can send the user to our upload page mid-tool-call. SEP-2356 pointed oversized files there [7]. Client support is covered in `mcp-elicitation-and-instructions.md`.

## Client support

| | MCP `image` → model | `resource` (blob) / `resource_link` | `structuredContent` + images | Formats the model can see | Result size cap | Local image / PDF / HEIC read |
|---|---|---|---|---|---|---|
| Claude Code 2.1.269 | Yes, resized ≤2000 px | Image blob → image; other blobs → disk + path; link → text | Both kept | JPEG, PNG, GIF, WebP; others → disk | 25K tokens incl. images (`MAX_MCP_OUTPUT_TOKENS`) | Yes / yes (≤20 pages per call) / no on Linux |
| Codex 0.154.0 | Yes, `input_image`, ≤2048 px (6000 px `original`) | Raw JSON as text (base64 leaks into context) | **Images dropped** | PNG, JPEG, GIF, WebP; others → placeholder | Event copy 1 MiB; model limit unverified | Yes (`view_image`) / no (#1797) / no |

## Consequences for us

1. **Flow A works in both clients today and survives hosting.** Store the originals, then normalize server-side (ADR 0001 style, no LLM needed):
   - HEIC → JPEG
   - PDF pages → PNG, with tiles for Blueprints (see `blueprint-extraction-reliability.md`)
   - downscale to ≤2000 px

   Return standard `image` blocks. **Do not set `structuredContent` on image-returning tools**, because Codex drops the images. Put IDs in text instead. Keep each result to a few images (the 25K-token cap in Claude Code) and page through the rest. Set `_meta["codex/imageDetail"]: "original"` on Blueprint tiles.
2. **Flow B works in both clients while the server is local.** It is also the spec's own suggested replacement for roots: a path as a tool parameter [4]. Have the tool ingest the file and return the *normalized* image blocks, so both clients see the same thing even for HEIC and PDF, which neither Agent can view natively everywhere. It breaks once the server can't see the user's disk.
3. **Flow C is not practical.** Base64 in arguments is limited by model output tokens and the SDK's 4 MiB body cap. MCP has no file-upload primitive (SEP-2631 is still a draft). Resource links and embedded resources only flow server → client, and Codex renders them as raw JSON. For a hosted future, use `curl` to an upload endpoint, or URL-mode elicitation to the upload page, and watch SEP-2631.

## Sources

1. https://modelcontextprotocol.io/specification/2026-07-28/server/tools
2. https://modelcontextprotocol.io/specification/2025-11-25/server/tools
3. https://modelcontextprotocol.io/specification/2026-07-28/server/resources
4. https://modelcontextprotocol.io/specification/2026-07-28/client/roots
5. https://modelcontextprotocol.io/specification/2026-07-28/changelog (Deprecated §1, SEP-2577)
6. https://modelcontextprotocol.io/community/working-groups/file-uploads
7. https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2356 (SEP-2356, closed 2026-06-26)
8. https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2631 (SEP-2631, draft)
9. https://code.claude.com/docs/en/mcp (MCP output limits and warnings; raise the limit for a specific tool; `roots/list`; Use MCP resources)
10. https://code.claude.com/docs/en/tools-reference (Read; `ListMcpResourcesTool`, `ReadMcpResourceTool`)
11. https://code.claude.com/docs/en/env-vars (`MAX_MCP_OUTPUT_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`)
12. https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (1.0.44, 1.0.58, 2.1.30, 2.1.31, 2.1.69, 2.1.122, 2.1.126, 2.1.128, 2.1.144, 2.1.203, 2.1.229, 2.1.257, 2.1.265)
13. Claude Code 2.1.269 binary, bundled JS read with `strings` (MCP content conversion: `case"image"`, `case"resource"`, `case"resource_link"`; HEIC codec error string)
14. Local test, 2026-09-13, Arch Linux: `Read` of an ImageMagick-generated `test.heic` returned raw bytes
15. https://platform.claude.com/docs/en/build-with-claude/vision
16. https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs (`convert_mcp_content_to_items`, `as_function_call_output_payload`, `DEFAULT_IMAGE_DETAIL`)
17. https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_call.rs (`sanitize_mcp_tool_result_for_model`, `truncate_mcp_tool_result_for_event`)
18. https://github.com/openai/codex/blob/main/codex-rs/utils/image/src/lib.rs and `utils/image/Cargo.toml`
19. https://github.com/openai/codex/blob/main/codex-rs/core/src/image_preparation.rs
20. https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/view_image.rs; `codex-rs/features/src/lib.rs` (`view_image` stable, default on)
21. https://learn.chatgpt.com/docs/image-inputs
22. https://learn.chatgpt.com/docs/extend/mcp?surface=cli
23. Codex issues: https://github.com/openai/codex/issues/1797 (PDF, open), /16896 (HEIC, closed), /42975, /10334, /43497, /44126
24. https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/requestBody.ts; `packages/server-legacy/src/sse/sse.ts`; `docs/servers/tools.md`
25. https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/tool_input.rs
