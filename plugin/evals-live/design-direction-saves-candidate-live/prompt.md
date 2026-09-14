---
description: Live smoke. Design Direction opens a Session on the real server and saves a first Candidate Design Direction from what the user says.
tags: [live, design-direction]
max_turns: 20
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill]
plugins: ["../..", "../../test-support/live-server"]
---

Help me work out the style for our home. We know roughly what we want: warm minimalism. Calm and uncluttered, warm rather than cool, low contrast, lots of oak and linen, a bit Japandi, and fewer but better things. Please save that as a first idea for the direction; we'll refine it later.
