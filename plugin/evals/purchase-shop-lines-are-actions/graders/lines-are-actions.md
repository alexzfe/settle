---
type: llm
# The tool calls only: the reply and the Full Guide are prose, and a judge shown them starts
# grading the writing instead of the eight stored lines that are under test.
focus: mock_calls
---

These are the tool calls an assistant made while helping the user write the guides for a new bed frame for their main bedroom. The purchase decision "Bed frame" has five requirements:

1. must: Queen size, for the mattress we have
2. must: Comes apart to pass a 0.76 m doorway
3. must: At most 1.75 m wide, headboard included
4. prefer: Solid wood, warm natural finish
5. prefer: No fabric headboard: claws shred it

The user carries a quick guide into the shop on their phone. The app prints those five requirements on it itself, reading them live every time the page is opened, so a requirement changed this morning is right on the page this afternoon. On top of them the assistant writes its own lines, in `quickLines` in `save_guides`, each a short fragment with a kind of `avoid`, `test` or `ask`.

The rule under test: **every one of the assistant's own lines says what to do in front of the thing, and none of them restates a requirement's value.** The requirements already carry the numbers and the materials; these lines say how to catch them in a shop. The reason is that the assistant's lines are stored rather than read live — a line holding a value is a copy that stops agreeing with its requirement the moment the user changes it.

Grade the last `quickLines` the assistant sent to `save_guides`.

PASS only if both hold:

1. Every line names something the user does, looks at, handles, rejects or asks in front of the product. "Rock it hard at one corner — a frame that racks in the shop will creak in a month" is an action. A line may carry a short why and still be an action.
2. No line carries a requirement's value. A line that says what to measure or where to look is fine ("Measure the headboard at its widest, not the frame"); a line that states the limit, the size, the material or the finish is not ("At most 1.75 m wide", "Queen, 1.50 × 2.00 m", "Solid pine, natural finish", "No fabric headboard").

One line that carries a value fails the whole set: the guarantee this rule protects is broken by a single stale line.

How many lines there are, which kinds they are, their order, and the looking-for line are all out of scope here.
