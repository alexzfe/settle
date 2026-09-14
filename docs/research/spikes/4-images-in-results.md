# Spike 4: several images in one MCP tool result

**Date:** 2026-09-13. **Status:** done. **Retires:** the `view_images` paging and `crop` design ([build plan, slice 0](../../build-plan.md#slice-0-scaffold-and-spikes)).

**Setup.**

- Claude Code 2.1.269, `claude -p` with `--mcp-config` and `--strict-mcp-config`, `--output-format json`.
- The default model for this account, `claude-opus-5`.
- A stateless streamable-HTTP server built on `@modelcontextprotocol/sdk` 1.30.0 under Node 26.8.1, with one read-only tool, `view_images(count, jpeg?, heavy?)`. It returns `count` image blocks plus one text block listing the pages, and no `structuredContent`.
- Pages are 2000×1500 8-bit RGB. Each has a large unique 4-digit number and a 12 px line reading "Page N note: the codeword is WORD colour NNN mm, keep this line small".
  - PNG: 41–56 KB.
  - JPEG q80: 74–81 KB.
  - A *heavy* variant adds scanner-like noise: 4.3 MB as PNG, 355 KB as JPEG.
- Each run asked the model to call the tool once, then transcribe every number and small line and quote any other text in the result. Read, Bash, and the other file tools were disallowed, so images could reach it only through the tool result.
- Evidence per run:
  - the JSON output
  - stderr
  - a `--debug-file` log
  - the session transcript, which shows the exact blocks the model got.
- "Tokens" below is the cache write of the request that carried the tool result. It is the tool result plus about 150 tokens of the preceding tool call.
- The brief's server runs on 127.0.0.1:4382 with `count` 1–8. To find the break point, a second instance allowed `count` up to 20 (port 4383), and a third put the text block before the images (port 4384).
- Throwaway files, not kept: `/tmp/claude-1000/-home-alex-Projects-int-design-harness/097b96f9-dc2d-4411-b1c0-36b75185d56b/scratchpad/spikes/4/` (server, runner, results).

## Results

| N | Format | Cap (`MAX_MCP_OUTPUT_TOKENS`) | Images the model read (of N) | 12 px line read | Tokens | Notice or warning | Saved to file |
|---|---|---|---|---|---|---|---|
| 1 | PNG | default 25K | 1 | 1/1 exact | 4,056 | none | no |
| 3 | PNG | default | 3 | 3/3 exact | 11,864 | none | no |
| 6 | PNG | default | 6 | 6/6 exact | 23,576 | none | no |
| 7 | PNG | default | 7 | 7/7 exact | 27,480 | **none, although over the cap** | no |
| 8 | PNG | default | 8 | 8/8 exact | 31,492 | `[OUTPUT TRUNCATED - exceeded 25000 token limit]`, but nothing was removed | no |
| 1 | JPEG | default | 1 | 1/1 exact | 4,057 | none | no |
| 3 | JPEG | default | 3 | 3/3 exact | 11,865 | none | no |
| 6 | JPEG | default | 6 | 6/6 exact | 23,577 | none | no |
| 8 | JPEG | default | 8 | 8/8 exact | 31,493 | truncation notice, nothing removed | no |
| 15 | PNG | default | 15 | 15/15 exact | 58,820 | truncation notice, nothing removed | no |
| 16 | PNG | default | **15 whole + page 16 shrunk to ~400×300; page-list text dropped** | 15/16 (page 16 unreadable, its big number still read) | 58,933 | truncation notice | no |
| 20 | PNG | default | **15 whole + page 16 shrunk; pages 17–20 and page-list text dropped** | 15/20 | 58,933 | truncation notice | no |
| 20 | PNG, text block first | default | 15 whole + page 16 shrunk; pages 17–20 dropped; **page list kept** | 15/20 | 59,013 | truncation notice | no |
| 20 | PNG | 100K | 20 | 19/19 exact, plus page 20 correctly reported as blank (see note) | 78,232 | none | no |
| 8 | PNG | 100K | 8 | 8/8 exact | 31,384 | none | no |
| 6 | PNG | 10K | 6 | 6/6 exact | 23,684 | truncation notice, nothing removed | no |
| 3 | PNG | 5K | 3 | 3/3 exact | 11,972 | truncation notice, nothing removed | no |
| 8 | PNG | 5K | **3 whole + page 4 shrunk to ~400×300; pages 5–8 and the page-list text dropped** | 3/4 (page 4 unreadable) | 12,121 | truncation notice | no |
| 8 | JPEG heavy (8×355 KB) | default | 8 | 8/8 exact | 31,498 | truncation notice, nothing removed | no |
| 3 | PNG heavy (3×4.3 MB) | default | **0: tool error** | none | 282 | `MCP server "spike4" session expired` (debug log: `HttpBodyOverflowError: streamed >16MB without an SSE event boundary`) | no |
| 6 | PNG heavy (6×4.3 MB) | default | **0: tool error** | none | 282 | same | no |

- Every run exited 0 and wrote nothing to stderr.
- PNG and JPEG cost the same tokens: **about 3,904 tokens per 2000×1500 page** (the pixel formula gives 72×54 = 3,888, plus a small wrapper). Image bytes did not affect the token count.
- Claude Code passed every image under the limits through unchanged: the base64 length in the transcript equals the server's. The only re-encoded images were the ones truncation shrank.
- *Note:* test page 20 was generated blank by a bug in my generator script (an array one entry short), so it has no number and no codeword. The model said exactly that instead of inventing a reading.

## How Claude Code 2.1.269 caps an MCP result

Read from the bundled JS (the chunk that holds `MAX_MCP_OUTPUT_TOKENS`). Every prediction it gave was confirmed by the runs above.

1. **Cap** = `MAX_MCP_OUTPUT_TOKENS` if set, else a remote flag (`tengu_velvet_ibis.mcp_tool`), else 25,000.
2. **Cheap estimate first.** Text is counted with the local tokenizer, and **every image counts as a flat 1,600 tokens**, whatever its size. If the estimate is at most half the cap (12,500 by default), the result passes untouched. That is why N=7 (estimate 11,200, real 27,480) got through with no notice.
3. **Exact count second.** Above half the cap, Claude Code asks the API to count the tokens, and it truncates only if the real count exceeds the cap. N=8 (estimate 12,800, real about 31.5K) triggers this.
4. **Truncation is a character budget of cap × 4** (100,000 by default), spent block by block in order:
   - A text block costs its length. One that meets an exhausted budget **ends the result**, so every later block is lost.
   - An image block costs a flat 6,400 characters. The image that no longer fits is **re-encoded smaller** (as JPEG, about 400×300) into whatever budget is left. Images after that are **dropped silently**.
   - The `[OUTPUT TRUNCATED …]` notice is always appended, **even when nothing was removed** (N=8 and N=15 at the default cap).
5. **Nothing goes to a file.** None of the runs saved the result to disk. The file-saving path is for oversized text, not images. `ENABLE_MCP_LARGE_OUTPUT_FILES` exists in the binary but was not tested.

**Where images stop arriving at the default cap:** 15 whole pages (15 × 6,400 = 96,000 of the 100,000-character budget). Page 16 arrives as an unreadable thumbnail, and pages 17 on are dropped without a trace. A text block placed after the images is dropped too. The model does see the truncation notice, so it can tell something was cut, but not what. Before that point, 8–15 pages arrive complete but carry a false truncation notice.

**Raising `MAX_MCP_OUTPUT_TOKENS`** moves both thresholds proportionally. At 100K:
- N=8 and N=20 passed with no notice. Their estimates, 12,800 and 32,000, are under 50,000, so no exact count ran.
- All 20 pages arrived whole, at about 78K tokens.

Lowering it to 5K cut N=8 to 3 pages. The cap is an env var on the user's machine, so `view_images` cannot count on it being raised.

**A second, separate limit: 16 MB per response over streamable HTTP.** Claude Code's HTTP transport refuses an SSE stream that sends more than 16 MB without an event boundary. The whole tool result is one SSE event, so a result over about 16 MB of base64 (about 12 MB of image bytes) fails. The model then gets only `MCP server "<name>" session expired`, and the client retries once, then reconnects. This does not depend on tokens: 3 noisy 4.3 MB PNGs, only about 11.7K tokens, failed. The server's JSON response mode (`enableJsonResponse`) might avoid it, but that was not tested.

## Recommendation for `view_images`

- **At most 6 pages per call; enforce it in the tool schema.**
  - 6 pages at 2000 px cost about 23.6K tokens, under the real 25K cap. Their estimate (9,600) stays below the exact-count threshold, so no truncation logic runs at all.
  - Do not rely on 7 passing: it is over the real cap and gets through only because of the flat 1,600-token image estimate, which a later Claude Code may fix.
  - 8–15 still arrive whole, but with a false truncation notice that invites the model to doubt the result.
  - A server-side maximum means Claude Code never truncates.
  - Skills should ask for the pages they need, usually one Level's pages at a time. Each page stays in context as about 3.9K tokens.
- **Put the text block first.** It names the pages returned, and pages are ids in text (no `structuredContent`, per the Codex finding). Confirmed: with text first, the page list survived a truncation that dropped it when it came last.
- **PNG for rendered PDF pages, JPEG q80–85 as the fallback for raster sources.**
  - Tokens are the same either way.
  - For clean line drawings PNG is smaller (41–56 KB against 74–81 KB) and lossless.
  - For noisy scans or photos PNG balloons (4.3 MB against 355 KB).
  - Rule for slice 3: store the rendered page as PNG, and if a page's PNG is over 1 MB, serve it as JPEG q85. This keeps a 6-page result well under the 16 MB transport limit.
- **Target resolution: 2000 px on the long edge.** That is Claude Code's own resize limit for current models (per [mcp-images-and-files.md](../mcp-images-and-files.md#2-claude-code)), so rendering larger only adds bytes. This spike did not test images over 2000 px. A-series pages at 2000×1414 cost about 3,670 tokens, so 6 of them fit too.
- **`crop`: not required by this test, keep it cheap.**
  - The model read the 12 px line exactly on every page that arrived at full size: 150 of 150 across all runs, a check against the expected strings rather than by eye.
  - It failed only on the 4 pages Claude Code had shrunk to about 400×300, and it still read the big number on all 4.
  - But the test text was clean, rendered, black-on-white type. Dimensions on a real scanned plan are fainter, rotated, and crowded by linework.
  - Keep the planned `crop` quarter in slice 3, since it is cheap: it sends a quarter of the page at full 2000 px, roughly doubling the effective resolution. Let the slice 3 demo on the real plan decide whether tiles are needed, as the build plan already says. Nothing here argues for tiles.

## Other observations

- MCP tools from `--mcp-config` are **deferred**: in every run the model first called `ToolSearch` to load `view_images`, which took one extra turn. This needs no work from us, but Skill text should not assume a tool is loaded before it is called.
- Runs took 12–27 s each. The server answered in under 40 ms.
- The build plan says spike findings are written back into the plan. This file is the finding. The plan's slice 3 line "`view_images` with a page list and a `crop` quarter" stands, with a maximum of 6 pages per call and the text block first.

## What a human should check by hand

- The same result in an **interactive** session, including what the terminal shows for a result that triggers the truncation notice. Only `-p` was run here.
- Whether a real Blueprint page's dimension text is readable at 2000 px (slice 3 demo).
- Whether the remote flag `tengu_velvet_ibis.mcp_tool` gives this account a different cap than 25K. The notices here said 25000, so it currently does not.
