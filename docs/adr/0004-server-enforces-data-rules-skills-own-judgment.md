---
status: accepted
---

# The server enforces data rules; Skills own every judgment about what the user meant

The MCP server enforces every rule it can check from the data alone. It refuses the write, with an error that says what to fix, when:

- the write falls outside the Session's Home
- a state change comes without its Session and a reason
- the state transition is illegal
- a Basis or Evidence entry doesn't exist
- the write deletes something that is referenced
- a value would be replaced by one with weaker Provenance

The server also cascades flags itself.

Every rule that depends on what the user meant lives only in Skill instructions:

- when to Lock
- whether the user asked to Reopen or Reject
- whether a fact is a Constraint
- never re-proposing a Rejected Decision
- never changing a Decision's state on a Note alone

The AI makes these calls itself and says plainly what it changed. It asks the user in the conversation before Reopening, Rejecting a Locked Decision, reviving a Rejected one, or adding or removing a Constraint. The reason it records quotes the user's permission.

We considered two stronger mechanisms and rejected both:

- **Server-side confirmation dialogs** for those protected moves, using MCP elicitation. Claude Code supports it, but Codex can auto-accept with empty content. The user also trusts the AI's judgment and didn't want a dialog on every protected move.
- **Claude Code hooks** to police tool calls. They don't port to Codex, and Codex runs plugin hooks only after the user trusts them.

## Consequences

- Rules that live only in Skill instructions have no server safety net. Each one gets at least one behaviour eval.
- The server's `instructions` repeat the core rules in under 512 characters, as a backstop for when Skill text is lost to compaction.
- Server-side confirmation can still be added later for chosen moves without changing the data model. See [mcp-elicitation-and-instructions.md](../research/mcp-elicitation-and-instructions.md).
