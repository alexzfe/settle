---
type: llm
# The whole graded turn.
focus: trace
---

The trace is one turn of a conversation. The user has asked what colour their bathroom walls are. The home's record says: plaster, roughly a pale sage green, in a satin finish. The record has no photos of the bathroom. Grade only the assistant's own text replies in this turn, not the tool calls or tool results.

PASS only if all of these hold:

1. A reply gives the recorded colour, pale sage green (or close wording), from the record.
2. No reply offers to look at a photo.
3. No reply asks or suggests that the user take or add photos.
