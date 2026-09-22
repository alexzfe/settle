---
status: accepted
---

# The Locked state is renamed Settled, everywhere

The committed Decision state was called **Locked**. On 2026-09-21, during the UI overhaul grilling, it became **Settled**. The verb that moves a Decision there is **Settle** (it was **Lock**). **Reopen** and **Revive** keep their names.

The rename is total. It covers the glossary, the web UI, MCP tool inputs and descriptions, Skill instructions, trigger and eval prompts, exports, and the stored state value, which changes through a migration. It ships as its own slice, before the UI overhaul.

Why:

- The name matches the app (Settle) and its mark. The full disc is the circle whose water has settled, drawn in the accent, the one state the accent marks.
- "Settled ground for later Decisions" was already how the glossary described the state.
- A partial rename would have left the Agent reading "Settled" in its Skill but sending `locked` to the tool. That mismatch is the kind that makes an Agent misfire.

We considered renaming only what people and the Agent read and keeping `locked` in storage and tool inputs. We rejected that for the mismatch above: the change is mechanical, so it's cheap to do whole.

## Consequences

- Anything written before 2026-09-21 says Locked: handoffs, reviews, research notes, build-plan entries. Those docs are history and stay as written. Read "Locked" there as Settled.
- New text, code and prompts must never say Locked. When any new mention turns up (a leftover string, an old eval prompt, a Skill copy that missed the rename), it's a bug to fix, not a synonym.
- The glossary lists Locked under Settled's _Avoid_.
