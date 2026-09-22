---
description: Live smoke. Color opens a Session on the real server, on a second fixture Home whose Design Direction is Settled, and saves a first Candidate Palette from what the user says.
tags: [live, color]
max_turns: 20
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill]
plugins: ["../..", "../../test-support/live-server"]
# scripts/plugin-eval-live.sh seeds this Home's Settled Design Direction. It is not the fixture
# Home, where a Settled Direction would change what design-direction-saves-candidate-live sees.
env:
  EVAL_SETTLE_HOME: fixture-flat
---

Let's choose the colour palette for our flat. We already know the colours we like: Farrow & Ball's Setting Plaster (No. 231) as the main wall colour, their Pointing (No. 2003) for the ceilings and woodwork, and a warm terracotta as an accent for the front door. Please save that as a first idea for the palette; we'll refine it later.
