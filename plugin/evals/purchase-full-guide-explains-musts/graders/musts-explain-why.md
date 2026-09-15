---
type: llm
# The tool calls only: the Full Guide save_guides was given.
focus: mock_calls
---

These are the tool calls an assistant made while helping the user buy a new sofa for the living room of their home. The purchase decision "Living room sofa" has five requirements:

1. must: At most 2.20 m wide (from the living room's wall 6, 3.90 m, which also holds the door into the room)
2. must: Gets through a 0.76 m doorway, legs off if need be (from the home's narrowest access: the front door, 0.76 m clear; the living room door is 0.76 m too)
3. must: A tightly woven wool cover, with no loops or loose weave (from the constraint "Two cats")
4. prefer: Cover in Jitney, or close to it (from the palette "Warm clay")
5. prefer: Oak legs (from the design direction "Warm minimalism")

The user asked for the quick guide and the full guide. Grade the save_guides call or calls: the full guide each saves, which is Markdown.

PASS only if both of these hold:

1. save_guides is called with a full guide.
2. The full guide covers each of the three must requirements, and for each one explains why it is a must: what would go wrong without it, or the fact it comes from (the wall's length and the door on it, the 0.76 m front door, the cats' claws). A must that is only stated, with no reason given, fails.

The full guide's headings and order are the assistant's choice, and it may explain the prefers too, or not.
