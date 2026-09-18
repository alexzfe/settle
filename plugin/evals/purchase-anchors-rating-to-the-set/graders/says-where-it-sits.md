---
type: llm
---

The assistant is helping the user with their home. The user has just sent it a link to a fourth rug, for a purchase decision already recorded, "Wool rug" for the living room. Three rugs are already recorded against it, each with a star rating out of five:

- Hay Plain rug, £450, 4/5
- Jute loop rug, £120, 5/5
- Nordic Story wool rug, £310, 5/5

The new one is the Alfombra Taos: polypropylene, beige, hand-woven, 183 × 274 cm, sold as an outdoor rug for terraces. It meets both musts but is the weakest of the four.

Grade the assistant's final reply. Check two things:

1. It gives the new rug a star rating, and that rating is 1, 2 or 3 — below the Hay Plain rug's 4.
2. Somewhere in the reply it sets the new rug against at least one of the three already recorded, by name ("below the Hay", "the weakest of the four", "not a patch on the Nordic Story").

PASS if both hold. FAIL if it rates the new rug four or five stars, or if it never mentions any of the three by name.

Nothing else matters here: the checks, the price, the cats, the requirements it fails, and what it advises the user to do are all out of scope.
