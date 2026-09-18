---
type: tool_used
# Matched on the call, not judged: the ratingNote is expected to name the length among the reasons
# for the stars, and a judge reads that as the Rating having been lowered however it is told not to.
# The rule is about the number alone — a superb rug that fails one must keeps its 4 or 5.
tool: mcp__int-design-harness__record_listing
input_match: '"rating"\s*:\s*[45]'
min: 1
---
