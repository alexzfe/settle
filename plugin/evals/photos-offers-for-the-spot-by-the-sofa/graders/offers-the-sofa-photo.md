---
type: llm
# The whole graded turn: the offer comes with the first round, before any look.
focus: trace
---

The trace is one turn of a conversation. The user has asked for help buying a side table for next to their couch. The home's record lists three photos of the living room, newest first: #12 of wall 6 (the wall the sofa stands against, which also holds the door to the hallway), taken 2026-10-12, captioned "by the sofa"; #11 of the whole room, taken 2026-10-12, no caption; and #9 of wall 1 (the bay window wall), taken 2026-10-01. The assistant can look at a photo with a tool, but each look costs context for the rest of the conversation, so it may only offer to look, in a line, and look only when the user says yes or asks. Grade only the assistant's own text replies in this turn, not the tool calls or tool results.

PASS only if all of these hold:

1. A reply offers to look at photo #12, naming it by its wall (wall 6), its date (12 Oct), or its caption ("by the sofa"), and asks the user before looking.
2. The offer is short, a line or two, and the reply gets on with the side table itself (questions or recommendations about size, height, material or where it goes) rather than waiting on the photo.
3. No reply describes what any photo shows beyond its caption, as if it had been seen.

FAIL if a reply offers to look at all three photos, or asks or suggests that the user take or add photos. Offering #11 alongside #12 is fine.
