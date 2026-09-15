# PoC Design

The settled shape of the proof of concept, agreed in the design grilling of 2026-09-13. Treat everything here as settled unless the user reopens it. Vocabulary lives in [CONTEXT.md](../CONTEXT.md); architecture reasoning in [ADR 0001](adr/0001-ai-runs-in-users-own-agent.md) and [ADR 0002](adr/0002-one-local-app-serves-ui-and-mcp.md).

## Finish line

Run on the user's own real home:

1. Home Intake works through a Blueprint, then interviews for the remaining Gaps, and produces correct Rooms and Inventory.
2. A Design Direction Session ends with the Direction Locked.
3. A Color Session Locks a palette resting on the Direction.
4. A Purchase Session produces Requirements that trace back to the palette and the Rooms, plus a Quick Guide and a Full Guide.
5. The user takes the Quick Guide shopping.
6. The user Fulfils with something slightly different, and the Deviation flags a dependent Decision.

## Architecture

- Local-first and single-user, with all data scoped per Home so hosting later isn't a rewrite. Docker is the expected next packaging step.
- One local app: TypeScript, the official MCP TypeScript SDK, one Node server, SQLite, and a React UI (ADR 0002).
- The platform makes no LLM calls (ADR 0001). Claude Code is the only PoC Agent. Skills use the portable `SKILL.md` format so that supporting Codex later is a packaging task.
- The web UI and the MCP tools call the same core operations.
- Home detail grows in stages: a Room list in v1, a 2D Floor Plan as the real target, maybe 3D one day.

## AI behaviour

- Skills are chosen automatically, and the user can also invoke one by name.
- State changes follow the rules in CONTEXT.md (Locked, Rejected, Reopen, Conflict). Every state change the Agent makes is logged with its Session and a reason; web UI changes are logged as coming from the web UI ([skill-set.md](specs/skill-set.md#rule-enforcement)).
- The AI makes state changes on its own judgment and says plainly what it changed. Before a Reopen, Rejecting a Locked Decision, reviving a Rejected one, or adding or removing a Constraint, it asks the user in the conversation. There are no confirmation dialogs. The server enforces only what it can check from data (ADR 0004).
- The AI creates a Constraint only from a fact the user states. It reads the Constraint back before saving it, and removes one only on the user's explicit instruction.
- The AI gets what the current work needs, in full, and nothing it would have to ignore ([home-model.md](specs/home-model.md#context-tiers)). At Session start every Skill gets the Home Overview (the Home's facts, Constraints, and one line per Room with its Gaps) and open flags and Conflicts. Every Skill except Home Intake also gets the Home-wide Decisions in force, with the Design Direction and Palette in full. A Skill fetches a Room Sheet, with that Room's Items and open Decisions, only when the Session needs that Room. Everything else, history included, is looked up only when a question needs it.
- The AI has no tool to see or switch Homes. Each Home has a Home Folder that the web UI sets up. Every Session started in that folder belongs to its Home, whatever the web UI is showing.
- Skills name the Active Home at Session start. Every Skill except Home Intake warns while the Design Direction is not yet Locked.
- Home Intake gathers Items by interview, and the user confirms them before they are saved. Photos are scaffolding in the PoC: the platform stores them and the web UI uploads them, but the AI doesn't use them ([skill-set.md](specs/skill-set.md#blueprints-and-photos)).

## Web UI

- The user can view everything; create a Home; upload Blueprints onto a Home and Photos onto a Room or an Item; Lock, Reopen, or Reject Decisions; resolve Conflicts and review flags; switch which Home the UI shows; and set up a Home Folder for each Home once it exists. The UI updates live when the Agent writes.
- Everything is ideally done through the Agent. Form-based editing of Rooms, Items, Notes, and Constraints exists for completeness and is expected to be used very little, so it is built in the web UI design session, after the PoC finish line (decided in the build-plan grilling of 2026-09-14). Until then the browser is a viewer plus the actions above, and the PoC's plain UI is judged on the AI and the Home record, not on its look.
- A Shopping section shows two groups, the Shopping List and Considering. Each entry opens its Quick Guide, with the Full Guide one tap away. Every non-Rejected Purchase Decision has Guides. The AI writes them during Sessions, personalised to that Purchase Decision.
- Exports are rendered from stored data only: the Shopping List as a printable page and CSV, the Shopping Guides as a printable page and Markdown. The Quick Guide export must read well on a phone, since that is how it gets into the store during the PoC. To get it there, the app has an opt-in LAN mode: a flag makes the server also listen on the machine's LAN address, where it serves only the Quick Guide pages by an unguessable per-Purchase token (never the web app, the API, or the MCP endpoint), and the Decision page shows that URL as a QR code. No auth on those pages, since it is the user's own network.

## Deferred topics

Each of these gets its own research and grilling session.

- Home model detail: done. Spec: [specs/home-model.md](specs/home-model.md). Brief: [handoff/home-model.md](handoff/home-model.md)
- Skill set: done. Spec: [specs/skill-set.md](specs/skill-set.md). Brief: [handoff/skill-set.md](handoff/skill-set.md)
- Agent context: done. What the Agent is given and when, so that it stays focused. Outcome in [specs/home-model.md](specs/home-model.md#context-tiers) and [specs/skill-set.md](specs/skill-set.md). Brief: [handoff/agent-context.md](handoff/agent-context.md)
- Photos as a working feature: the AI viewing them and proposing Items from them (scaffolding only in the PoC)
- Budget module
- 2D Floor Plan editor, then maybe 3D
- Hosting and Docker, which also gets the Guides onto the user's phone
- In-browser chat, built as another client of the core operations (ADR 0001)
- Codex and other Agents
- Tidy Skill, which proposes merges and archives for the user to approve
- Room Brief export for painters and contractors
- To-do list for non-purchase Decisions that need action
- Web UI form for recording Fulfilment (in the PoC, only the Agent records it)
- Undo from the change log (in the PoC, the log is shown read-only)
- Web UI design session, after the finish line: the look and flow of the whole UI, plus form-based editing of Rooms, Items, Notes, and Constraints
- Shared library of category guides
