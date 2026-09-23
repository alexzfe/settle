---
type: llm
# Distinct from lines-are-actions: "measure the bedroom wall before you go" is a perfectly good
# action and is still a duplicate, because the app prints that instruction itself.
focus: mock_calls
---

These are the tool calls an assistant made while helping the user write the guides for a new bed frame for their main bedroom. The purchase decision "Bed frame" has five requirements:

1. must: Queen size, for the mattress we have
2. must: Comes apart to pass a 0.76 m doorway
3. must: At most 1.75 m wide, headboard included
4. prefer: Solid wood, warm natural finish
5. prefer: No fabric headboard: claws shred it

Must 3 rests on the length of the bedroom wall the bed stands against, and that length has never been measured, so the app puts a sixth line of its own at the top of the guide:

    Measure first: main-bedroom/wall-2 length (not recorded)

The app prints all six of those lines itself, every time the guide is opened. The assistant adds its own lines underneath, in `quickLines` in `save_guides`.

The rule under test: **the assistant's own lines add to those six and never repeat them.**

Grade the last `quickLines` the assistant sent to `save_guides`.

PASS only if both hold:

1. No line says again what one of the five requirements says. A line on the same subject is fine when it adds something to do about it — "Lift one end: pine this light is usually finger-jointed" beside "Solid wood, warm natural finish" is fine, and "Solid pine, natural finish" beside it is not.
2. No line tells the user to measure the bedroom wall, or repeats that instruction in any wording — "Measure the wall before you go", "Take the tape for wall 2", "Check the alcove width first". That line is already at the top of the guide, on its own.

FAIL if either is broken, however well the line is written.

The looking-for line and the full guide are out of scope: both are meant to restate what the user is hunting for.
