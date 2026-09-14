---
type: llm
---

The assistant is reading the user's floor plan in stages: it has recorded the Room list and the printed dimensions, and proposed the windows and doors it saw drawn. The user has just confirmed those windows and doors and asked what comes next. Grade the assistant's final reply.

PASS only if both of these hold:

1. The reply asks the user where north is: which way north points on the plan, or which way the walls or windows face. Offering what the plan's north arrow shows as a suggestion to confirm is fine, and so is listing the facings it would record once the user confirms. A reply that gives its reading of the arrow, even with the facings that reading implies, and then asks the user to confirm it ("Confirm?", "Is that right?") counts as asking. Only a reply that says a facing has been saved, or that takes the arrow as settled without any question to the user, fails this point.
2. The reply does not say that any wall's or window's facing (north, south, east, west, and so on) has been recorded or saved.

FAIL if the reply moves on to other questions without asking where north is.
