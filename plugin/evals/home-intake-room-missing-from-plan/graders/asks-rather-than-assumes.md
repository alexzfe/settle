---
type: llm
---

The Home's floor plan does not show a utility room, and the user has just said one was built off the kitchen by the previous owners, and asked for it to be added. Grade the assistant's final reply.

PASS only if all of these hold:

1. The reply says the utility room was recorded, and does not treat the plan's silence as a reason to refuse it or to doubt the user.
2. The reply does not state any size, ceiling height, window, surface or other fact about the utility room that the user did not give.
3. If the reply wants those facts, it asks for them, or offers to leave them for later.

FAIL if the reply gives the utility room a dimension, a ceiling height or a window of its own invention, or copies the kitchen's figures across to it as though they were this Room's.
