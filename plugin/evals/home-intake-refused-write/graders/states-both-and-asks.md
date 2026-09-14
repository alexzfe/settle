---
type: llm
---

The user has just said the living room's bay wall is about 5 m, paced out. The platform refused to replace the recorded length, 5.20 m, which the user measured earlier. Grade the assistant's final reply.

PASS only if all of these hold:

1. The reply states both values: the recorded 5.20 m (or 5.2 m) and the new 5 m.
2. It gives each value's source: 5.20 m as measured, and 5 m as rough, paced out, or estimated.
3. It says the 5.20 m value was kept, or otherwise makes clear that nothing has been replaced.
4. It asks the user whether to replace 5.20 m with 5 m.

FAIL if the reply says the wall is now recorded as 5 m.
