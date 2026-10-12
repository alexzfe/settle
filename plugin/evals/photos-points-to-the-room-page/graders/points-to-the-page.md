---
type: llm
# The whole graded turn.
focus: trace
---

The trace is one turn of a conversation. The user has asked what is next to their couch. The home's record says the sofa stands against wall 6 of the living room, which also holds the door to the hallway; nothing else is recorded beside it. The bookcase is on wall 4. The home's record lists three photos of the living room, newest first: #12 of wall 6 (the wall the sofa stands against, which also holds the door to the hallway), taken 2026-10-12, captioned "by the sofa"; #11 of the whole room, taken 2026-10-12, no caption; and #9 of wall 1 (the bay window wall), taken 2026-10-01. The assistant can look at a photo with a tool, but each look costs context for the rest of the conversation, so it may only offer to look, in a line, and look only when the user says yes or asks. The user can see their photos themselves in the app, on the living room's page, so the assistant should not offer to look for them. Grade only the assistant's own text replies in this turn, not the tool calls or tool results.

PASS only if all of these hold:

1. A reply answers from the record: where the sofa is, and what the record places beside or near it (the hallway door on the same wall), or that nothing more is recorded.
2. A reply points the user to the living room's page in the app (or Settle, or the web app) to see the photo there, ideally the one captioned "by the sofa".
3. No reply offers to look at a photo for the user.

FAIL if a reply names things beside the sofa that the record does not hold (a lamp, a stool, a plant) as fact, or asks or suggests that the user take or add photos.
