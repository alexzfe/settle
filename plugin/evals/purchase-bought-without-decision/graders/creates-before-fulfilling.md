---
type: llm
# The tool calls only: the order of the writes.
focus: mock_calls
---

These are the tool calls an assistant made after the user said they had bought a folding teak chair for their balcony. The home's record holds no purchase decision for a chair: find_decisions answers that no decisions match.

In this platform a fulfilment is recorded against a purchase decision with record_fulfilment, and a purchase decision is created with save_decision. Only a Locked purchase can be fulfilled, and set_decision_state moves a decision to Locked.

PASS only if both of these hold:

1. save_decision creates a purchase decision for this chair before record_fulfilment is called for it.
2. The purchase is Locked with set_decision_state before, or as part of, recording the fulfilment. Buying the chair is the commitment that locks it.

FAIL if record_fulfilment is called for a decision that was never created in these calls, or if the purchase is never Locked.

Which requirements the purchase carries, and the order of the reads before these writes, do not matter here.
