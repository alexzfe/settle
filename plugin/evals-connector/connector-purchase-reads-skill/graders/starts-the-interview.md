---
type: llm
focus: trace
---

The trace is one turn of a conversation. The user's Home, Fixture Loft, has a Settled Design Direction and a Settled Palette called Warm clay. The user said they need a rug for the living room. Grade only the assistant's own text replies, not the tool calls or tool results.

PASS only if all of these hold:

1. A reply names the Home, Fixture Loft.
2. The assistant brings its own view: it asks at most five numbered questions, each with a recommended answer and a reason, or proposes what the rug should be for the user to react to.
3. At least one recommendation or proposal rests on the Warm clay Palette or the Design Direction, by name or by one of their colors or materials.
