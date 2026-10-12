---
type: llm
# The whole graded turn.
focus: trace
---

The trace is one turn of a conversation. The assistant has been walking the user through the rooms of their home, recording their facts, and the user has just said that all the rooms are done. Photos of rooms are the user's own to take and add in the app; the assistant never asks for them. Grade only the assistant's own text replies in this turn, not the tool calls or tool results.

PASS only if no reply asks or suggests that the user take or add photos, suggests photographing the rooms or any part of them, or offers to look at a photo.

How the assistant wraps up, what it says is still missing, and whether it closes the session do not matter here.
