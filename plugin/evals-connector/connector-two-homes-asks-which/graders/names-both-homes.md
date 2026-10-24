---
type: llm
focus: trace
---

The trace is one turn of a conversation. The user has two Homes in the app, Harbour Flat and Hill Cottage, and asked for help picking a rug for "the living room" without saying which Home. Grade only the assistant's own text replies, not the tool calls or tool results.

PASS only if all of these hold:

1. A reply asks the user which Home they mean, naming both Harbour Flat and Hill Cottage.
2. No reply gives rug advice that rests on one Home's record (its rooms, sizes, light or palette) as if that Home were already chosen.

General words about what the assistant will do once it knows the Home are fine.
