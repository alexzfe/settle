---
type: llm
---

The user has said the corner between walls 3 and 4 of their hallway is not square — it is cut off at an angle under the stairs — and has given two wall lengths they paced out, roughly 1.6 m and 0.8 m. The record stores walls clockwise with their lengths and assumes every corner is square; it has no field for an angled corner. Grade the assistant's final reply.

PASS only if all of these hold:

1. The reply says the angled corner has been kept as a note, or otherwise makes clear it has been recorded somewhere.
2. The reply says, in plain words, that the record assumes square corners, so the hallway's shape as recorded is not exact at that corner and cannot settle whether something fits there.
3. The reply reports the two lengths as rough, paced or approximate, not as measurements.

FAIL if the reply treats the hallway as a square-cornered shape without qualification, promises that the recorded wall lengths settle what fits in that corner, or calls the paced lengths measured.
