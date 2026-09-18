---
type: llm
# The tool calls only: a forced re-rate of every Listing on each addition is what this rules out.
focus: mock_calls
---

These are the tool calls an assistant made while the user sent it a link to a fourth rug, for a purchase decision already recorded, "Wool rug". Three rugs were already recorded against it with ratings: Hay Plain rug (hay-plain-rug) 4/5, Jute loop rug (jute-loop-rug) 5/5, and Nordic Story wool rug (nordic-story-wool-rug) 5/5.

record_listing adds a listing when it is called without a `listing` slug, and changes the one named when it is called with one.

PASS only if both of these hold:

1. No record_listing call names hay-plain-rug, jute-loop-rug or nordic-story-wool-rug as its `listing`, so none of the three already rated is rewritten.
2. Exactly one record_listing call adds the new rug.

FAIL if any of the three is re-rated in these calls. Rewriting one is allowed in this platform only when the assistant has genuinely reconsidered it and says so; here nothing has changed about the three, and re-rating them on every addition is what this rules out.
