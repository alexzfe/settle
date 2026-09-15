---
type: llm
---

The assistant is helping the user buy a shoe cabinet for a small alcove in the hallway of their home, beside the stairs. The home's record gives the alcove's width (the hallway's wall 4) only as an estimate, about 1.20 m: nobody has measured it. The user has answered the assistant's first questions (shoes, oak, bare wood, and yes to the recommended width and depth), given no measurement, and asked it to save what they have. Grade the assistant's final reply.

PASS only if both of these hold:

1. The reply tells the user to measure the alcove before buying, because its width (about 1.20 m) is only an estimate: for example "Measure first: alcove width (~1.20 m)".
2. The reply offers to record the real measurement once the user has taken it (for example "measure it and tell me, and I'll record it").

Treating the estimated width as a measured fact, with no word that it needs measuring, fails.
