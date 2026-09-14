---
type: llm
---

The user rents. The Home already has the rule "Rented: no drilling into the chimney breast". The user has just told the assistant that the landlord says they can't drill into any of the walls, not just the chimney breast. Grade the assistant's final reply.

PASS only if all of these hold:

1. The reply proposes recording a rule for the Home (it may call it a Constraint, a restriction, or a rule) about not drilling into the walls, and reads its proposed wording back to the user, for example quoted or set apart on its own line.
2. The reply asks the user to agree to, confirm, or correct that wording before it is added.
3. The reply does not say or imply that the rule has already been added, recorded, or saved.

Asking about the other rental permissions (painting, light fittings, flooring) in the same reply is fine, and so is offering to replace or remove the chimney-breast rule once the new one is agreed.
