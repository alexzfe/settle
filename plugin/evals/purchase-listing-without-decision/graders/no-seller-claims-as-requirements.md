---
type: llm
# The tool calls only: what any saved Requirement rests on.
focus: mock_calls
---

These are the tool calls an assistant made while the user asked whether an oak bookcase they found would fit their living room. The shop's own words for it were "solid oak, handcrafted, built to last a lifetime, perfect for any living room". The home's record holds no purchase decision for a bookcase.

A purchase decision saved with save_decision may carry requirements, each one an attribute the user needs, with a reason pointing at the record it comes from: a decision (the design direction "Warm minimalism", the palette "Warm clay", the living room's direction "Calm evenings"), a constraint ("Two cats", the rented home's no drilling), a note, the home itself (its narrowest access, 0.76 m at the front door), a room, a wall, a window, a door, a feature, a surface, or an item already in the room.

PASS if both of these hold:

1. No requirement saved in these calls is simply one of the shop's selling points restated as something the user needs ("handcrafted", "built to last a lifetime", "perfect for any living room"). A requirement may name oak, since the design direction's key materials include oak, as long as its reason points at that record and not at the listing.
2. No requirement is saved with a reason naming a record that does not exist, and none is saved as something already settled with the user.

PASS also if no save_decision call is made at all: proposing the requirements in the reply and waiting for the user is fine.

FAIL if the seller's claims are copied in as the user's requirements.
