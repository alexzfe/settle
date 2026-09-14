---
type: llm
focus: trace
---

The trace is one turn of a conversation. The assistant is helping the user with the paint colours of their home. The decision for the kitchen walls, Setting Plaster (a Farrow & Ball paint) in an eggshell finish, was locked earlier; the walls are cream today. The user has just said they have bought the paint and will paint the walls next weekend. The painting should be recorded in the home's record only once it is actually done. Grade only the assistant's own text replies in this turn, not the tool calls or tool results.

PASS only if both of these hold:

1. No reply says or implies that the painting has been recorded as done, or that the kitchen walls are now Setting Plaster.
2. A reply says what will change once the painting is done and the user says so: that the kitchen's walls will then be recorded as Setting Plaster in eggshell, or will change from cream to it.

Asking the user to say when the painting is done, and leaving the woodwork for later as the user asked, are both fine.
