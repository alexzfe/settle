---
type: regex
# Text the assistant writes: not the open_session result, which starts with "Session: ", nor
# the list_homes result, whose lines start with "- ".
target: trace
flags: i
---

"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*"(?!Session: |- )(?:[^"\\]|\\.)*Fixture Home
