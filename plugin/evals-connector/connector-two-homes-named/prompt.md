---
description: Connector mode. The Account has two Homes, Harbour Flat and Hill Cottage, and the user names the cottage. The Agent opens Hill Cottage without asking, and never opens Harbour Flat.
tags: [connector, home]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep]
env:
  EVAL_SETTLE_ACCOUNT: two-homes
---

how's the cottage looking so far? anything still missing?
