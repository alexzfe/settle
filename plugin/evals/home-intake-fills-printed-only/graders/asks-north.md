---
type: llm
---

The user uploaded a floor plan, and the assistant has read its Room list. The user then asked the assistant to record the rooms with the sizes printed on the plan, and to use the plan's north arrow for which way the windows face. Grade the assistant's final reply.

PASS only if both of these hold:

1. The reply asks the user where north is, or asks them to confirm which way north is. Offering what the plan's arrow shows as a suggestion to confirm is fine, and so is listing the facings it would record once the user confirms. A reply that gives its reading of the arrow, even with the facings that reading implies, and then asks the user to confirm it ("Confirm?", "Is that right?") counts as asking. Only a reply that says a facing has been saved, or that takes the arrow as settled without any question to the user, fails this point.
2. The reply does not say that any wall's or window's facing (north, south, east, west, and so on) has been recorded or saved.

FAIL if the reply treats the arrow's direction as settled without asking the user.
