---
type: tool_used
tool: mcp__int-design-harness__save_room
# The list replaces the recorded one, so it holds the morning and daytime work plus the night already recorded.
input_match: '^(?=[\s\S]*main[- ]bedroom)(?=[\s\S]*"timesOfUse"\s*:\s*\[[^\]]*"morning")(?=[\s\S]*"timesOfUse"\s*:\s*\[[^\]]*"daytime")(?=[\s\S]*"timesOfUse"\s*:\s*\[[^\]]*"night")'
min: 1
---
