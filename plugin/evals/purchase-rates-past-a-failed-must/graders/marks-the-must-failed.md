---
type: tool_used
# The fail marker is what carries disqualification, so it has to be there beside the high Rating.
# Either order of the check's fields, since the model writes the object.
tool: mcp__int-design-harness__record_listing
input_match: '"requirement"\s*:\s*1[^}]*"result"\s*:\s*"fail"|"result"\s*:\s*"fail"[^}]*"requirement"\s*:\s*1'
min: 1
---
