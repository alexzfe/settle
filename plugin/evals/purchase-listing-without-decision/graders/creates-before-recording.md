---
type: llm
# The tool calls only: a Listing's checks are recorded against a Purchase's Requirements, by
# position, so the Purchase and its Requirements have to exist first.
focus: mock_calls
---

These are the tool calls an assistant made while the user asked whether a bookcase they found would fit their living room. The home's record holds no purchase decision for a bookcase: find_decisions answers that no decisions match.

In this platform, record_listing records a product against a purchase decision, with one check for every one of that decision's requirements, by position. A purchase decision with its requirements is created or changed with save_decision.

PASS if either of these holds:

1. record_listing is never called, or
2. every record_listing call comes after a save_decision call that created a purchase decision carrying requirements, in the same run.

FAIL if record_listing is called when no save_decision has created a purchase with requirements: there is nothing for its checks to point at.

How many requirements, and which, does not matter here.
