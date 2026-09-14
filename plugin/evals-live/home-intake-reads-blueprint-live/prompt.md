---
description: Live smoke. Home Intake looks at the uploaded Blueprint's page through view_images on the real server, and names the Level the page shows.
tags: [live, home-intake, blueprint]
max_turns: 16
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
plugins: ["../..", "../../test-support/live-server"]
---

I've uploaded our floor plan in the app. Which floor does it show, and which rooms are on it? Don't record anything yet.
