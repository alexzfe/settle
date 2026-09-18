---
type: llm
# The tool calls only: every Rating sent has its ratingNote, and the note says something.
focus: mock_calls
---

These are the tool calls an assistant made while the user sent it a link to a rug, for a purchase decision already recorded, "Wool rug", whose requirements are:

1. must: At least 2.0 × 1.4 m
2. prefer: Wool, low pile: loops catch the cats' claws
3. must: No longer than 3.4 m, to keep the walk past the west window clear
4. prefer: Warm terracotta, the Palette's accent, or close to it

The rug's page states: Alfombra Venice Ivory 244x305cm, by Crate & Barrel — wool, hand-woven, beige/ivory, 244 cm wide by 305 cm long, for a living room. It meets both musts and is real wool; its pile height is not stated; its colour is not the terracotta asked for.

record_listing takes a `rating` of 1 to 5 whole stars and a `ratingNote`, the one line that says what the stars rest on. The note is written the way a shop note is: a fragment, numbers and facts first, naming what is good and what is not, so that a 4 meaning "lovely but pricey" reads differently from a 4 meaning "fine, nothing special". Examples of the form: "Slub visible, but 40% over budget"; "Right size, real wool, but £120 over the others".

PASS only if all of these hold:

1. record_listing is called for the wool-rug decision with a `rating`.
2. Every record_listing call that carries a `rating` also carries a `ratingNote`.
3. Each such ratingNote names something concrete about this rug — its wool, its hand weaving, its size, or its ivory colour — so the stars can be argued with.

FAIL if a rating is sent without a ratingNote, or if a ratingNote is only a verdict with nothing behind it ("Great rug", "Excellent quality", "Very good value", "Highly recommended"), or if it is a sentence of praise rather than a fragment of what was found.

What number of stars it gives does not matter here.
