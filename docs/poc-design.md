# PoC Design

The settled shape of the proof of concept, agreed in the design grilling of 2026-09-13. Treat everything here as settled unless the user reopens it. Vocabulary lives in [CONTEXT.md](../CONTEXT.md); architecture reasoning in [ADR 0001](adr/0001-ai-runs-in-users-own-agent.md) and [ADR 0002](adr/0002-one-local-app-serves-ui-and-mcp.md).

## Finish line

Run on the user's own real home:

1. Home Intake from a Blueprint and an interview (Photos optional) produces correct Rooms and Inventory.
2. A Design Direction Session ends with the Direction Locked.
3. A Color Session Locks a palette resting on the Direction.
4. A purchase grilling produces Requirements that trace back to the palette and the Rooms, plus a Quick Guide and a Full Guide.
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
- State changes follow the rules in CONTEXT.md (Locked, Rejected, Reopen, Conflict). Every state change is logged with its Session and a reason.
- The AI makes state changes on its own judgment and says plainly what it changed. Before a Reopen, Rejecting a Locked Decision, reviving a Rejected one, or adding or removing a Constraint, it asks the user in the conversation. There are no confirmation dialogs. The server enforces only what it can check from data (ADR 0004).
- The AI creates a Constraint only from a fact the user states. It reads the Constraint back before saving it, and removes one only on the user's explicit instruction.
- At Session start the AI gets the Home Overview (the Home's facts, Constraints, Design Direction, and one line per Room with its Gaps) and the Locked Decisions. It fetches a Room Sheet, with that Room's Items, only when the Session needs that Room. Notes, Photos, Blueprints, and Archived Items are left out, and the AI looks them up only when one seems relevant.
- The AI has no tool to see or switch Homes. Each Home has a Home Folder that the web UI sets up. Every Session started in that folder belongs to its Home, whatever the web UI is showing.
- Skills name the Active Home at Session start, and warn while the Design Direction is not yet Locked.
- Home Intake gathers Items mainly by interview. It can also propose Items from an uploaded Photo. Either way, the user confirms them before they are saved.

## Web UI

- The user can view everything; edit Rooms, Items, Notes, and Constraints through forms; Lock, Reopen, or Reject Decisions; resolve Conflicts and review flags; switch which Home the UI shows; and set up a Home Folder for each Home. The UI updates live when the Agent writes.
- A Shopping section shows two groups, the Shopping List and Considering. Each entry opens its Quick Guide, with the Full Guide one tap away. Every non-Rejected Purchase Decision has Guides. The AI writes them during Sessions, personalised to that Purchase Decision.
- Exports are rendered from stored data only: the Shopping List as a printable page and CSV, the Shopping Guides as a printable page and Markdown. The Quick Guide export must read well on a phone, since that is how it gets into the store during the PoC.

## Deferred topics

Each of these gets its own research and grilling session.

- Home model detail. Spec: [specs/home-model.md](specs/home-model.md). Brief: [handoff/home-model.md](handoff/home-model.md)
- Skill set. Spec: [specs/skill-set.md](specs/skill-set.md). Brief: [handoff/skill-set.md](handoff/skill-set.md)
- Agent context budget: what the Agent is given, when, and at what size, so it never carries context it doesn't need. Brief: [handoff/agent-context.md](handoff/agent-context.md)
- Budget module
- 2D Floor Plan editor, then maybe 3D
- Hosting and Docker, which also gets the Guides onto the user's phone
- In-browser chat, built as another client of the core operations (ADR 0001)
- Codex and other Agents
- Tidy Skill, which proposes merges and archives for the user to approve
- Room Brief export for painters and contractors
- To-do list for non-purchase Decisions that need action
- Shared library of category guides
