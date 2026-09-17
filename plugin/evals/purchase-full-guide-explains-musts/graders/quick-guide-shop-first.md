---
type: llm
# The tool calls only: the looking-for line and Quick Guide lines save_guides was given.
focus: mock_calls
---

These are the tool calls an assistant made while helping the user buy a new sofa for the living room of their home. The purchase decision "Living room sofa" has five requirements:

1. must: At most 2.20 m wide
2. must: Gets through a 0.76 m doorway, legs off if need be
3. must: A tightly woven wool cover, no loops or loose weave (the home has two cats)
4. prefer: Cover in Jitney, or close to it
5. prefer: Oak legs

The user asked for the quick guide and the full guide. The app builds the quick guide from these requirements plus two things the assistant writes in save_guides: `lookingFor`, one line at the top naming what the user is hunting for, and `quickLines`, the assistant's own lines, each with a kind of `avoid`, `test`, or `ask`. The quick guide is glanced at in a shop, so its lines are fragments, not sentences. Grade the save_guides call or calls: the last `lookingFor` and `quickLines` given.

PASS only if all of these hold:

1. `lookingFor` is given, and is a short line of fragments naming the sofa being hunted for (for example "Three-seater · ≤ 2.20 m wide · tight wool weave · oak legs"). A full sentence, or a line that only says "a new sofa for the living room", fails.
2. `quickLines` is given, with at most 8 lines in all, and at least one of them is an `avoid`.
3. Each line is a short fragment someone could take in at a glance. A line of more than about fifteen words, or one that explains its reasoning at length, fails.
4. No line just restates one of the five requirements ("At most 2.20 m wide", "Oak legs"). A `test` or `avoid` that says how to check a requirement in the shop, or what a wrong version looks like, is fine.

How many lines of each kind, and their order, are the assistant's choice.
