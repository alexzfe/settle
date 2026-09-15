---
type: regex
# Any text the assistant writes in the turn, since it names the Home before saving and may not
# repeat it at the end. The open_session result also says "Fixture Loft", so a text block that
# starts with "Session: " (that result) doesn't count.
target: trace
flags: i
---

"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*"(?!Session: )(?:[^"\\]|\\.)*Fixture Loft
