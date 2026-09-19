---
description: Live smoke. Purchase opens a Session on the real server, on a third fixture Home whose Design Direction and Palette 'Warm clay' are Locked, and saves a Candidate Purchase with a Requirement whose reason is the Palette.
tags: [live, purchase]
max_turns: 24
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill]
plugins: ["../..", "../../test-support/live-server"]
# scripts/plugin-eval-live.sh seeds this Home's Locked Design Direction and Palette. It is neither
# the fixture Home (the Design Direction case saves its first Direction) nor Fixture Flat (the Color
# case saves its first Palette).
env:
  EVAL_SETTLE_HOME: fixture-loft
---

We want a rug for the living room, in the palette's warm terracotta. It must be at least 2 m by 1.4 m. Please save that as a first idea for now; we'll refine it later.
