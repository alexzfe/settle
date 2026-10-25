---
description: Connector mode. The Account has one Home, Fixture Home. The Agent opens it without asking which Home, and names it.
tags: [connector, home]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep]
env:
  EVAL_SETTLE_ACCOUNT: fixture-home
---

what do you have on my place so far?
