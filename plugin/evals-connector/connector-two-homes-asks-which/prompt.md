---
description: Connector mode. The Account has two Homes, Harbour Flat and Hill Cottage, and the request names neither. The Agent asks which one by name, and records nothing.
tags: [connector, home]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep]
env:
  EVAL_SETTLE_ACCOUNT: two-homes
---

can you help me pick a rug for the living room?
