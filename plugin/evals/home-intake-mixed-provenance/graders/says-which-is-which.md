---
type: llm
---

The user gave three sizes for their main bedroom in one message, from three different sources: wall 2 measured with a tape (3.40 m), wall 3 read off the printed floor plan (2.90 m), and the ceiling height guessed by eye (about 2.4 m). Grade the assistant's final reply.

PASS only if both of these hold:

1. The reply tells the three values apart by where each came from: the measured wall, the value taken from the plan, and the guessed ceiling height. Any plain wording counts ("measured", "from the plan", "a guess", "rough", "approximate"), and marking the ceiling with a "~" or "about" counts for the third.
2. The reply does not describe the ceiling height as measured, and does not describe the measured wall as rough or approximate.

FAIL if the reply reports all three as if they were recorded the same way, or asks "measured or roughly?" about the batch as a whole after the user has already said where each one came from.
