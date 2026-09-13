# Skill set spec

**Status: draft, grilling in progress.** Sections marked _open_ are not settled yet. Vocabulary lives in [CONTEXT.md](../../CONTEXT.md), and settled PoC shape in [poc-design.md](../poc-design.md). Research behind this spec is in [docs/research/](../research/).

## The PoC Skills

Four Skills: Home Intake, Design Direction, Color, and Purchase. Each Skill is one `SKILL.md`, and the domain Skill and the packaged Skill are the same unit. There is no router Skill.

### Home Intake

- **Purpose:** record or correct the Active Home's Rooms and Inventory from a Blueprint, Photos, or an interview. It can be run again at any time ("we moved the office", "add the bookshelf we forgot").
- **Boundaries:** it records facts and makes no design Decisions. It runs in an ordinary Session, with the same Home binding, logging, and summary as any other Skill.
- **Trigger description:** _open_
- **Procedure:**
  1. **Blueprint first**, if there is one. The AI proposes each Level's Rooms, Walls and dimensions, with Provenance, as a table. The user confirms or corrects it in one reply per Level.
  2. **No Blueprint:** an interview, Room by Room. It asks for the required fields, then the Gaps: the Home model's "enough for advice" list.
  3. **Photos, Room by Room.** The AI proposes a numbered list of Items, Features and Surfaces. The user confirms or corrects in one reply per Room ("all but 3; 5 is oak, not pine"). Only what the user confirms is saved.
  4. **Facts along the way.** Facts the user states become Constraints (with confirmation, see Rule enforcement) or Notes.
  - How Blueprints and Photos reach the platform is _open_.
- **MCP tools:** _open_
- **Outputs:** Rooms, Items, and any Constraints or Notes the user states along the way.

### Design Direction

- **Purpose:** grill and Lock the Home's Design Direction, and each Room Direction.
- **Boundaries:**
  - It owns temperature, mood, contrast level, key materials, style references, and guiding principles. It never names specific colors; those belong to Color.
  - It owns every Room Direction and checks that it refines the Design Direction without contradicting it. Other Skills may suggest that a Room needs one, but never write it.
- **Trigger description:** _open_
- **MCP tools:** _open_
- **Outputs:** the Design Direction Decision and Room Direction Decisions.

### Color

- **Purpose:** grill and Lock the Palette, then per-Room color Decisions (for example the living room walls in the Palette's base color, eggshell). Those rest on the Palette and on the Room's light, and change a Surface when Fulfilled.
- **Boundaries:**
  - The Palette is the only source of color. Adding or changing a Palette color is always a Color question, even when a Purchase raises it (for example a rug that needs an accent the Palette lacks).
  - The Palette enters the Basis only of Decisions that use one of its colors.
- **Trigger description:** _open_
- **MCP tools:** _open_
- **Outputs:** the Palette Decision and per-Room color Decisions.

### Purchase

- **Purpose:** it owns the whole life of a Purchase Decision:
  - grill it
  - write Requirements with reasons
  - write the Quick Guide and Full Guide
  - check any Listing the user brings, recording pass, fail or unknown for each Requirement
  - record Fulfilment and any Deviations
- **Boundaries:**
  - It applies the Palette but never extends it. The color of a fabric or finish is a Purchase Requirement whose reason is the Palette.
  - Until Layout exists, it derives size and clearance Requirements from the Room. Until Lighting exists, it handles bulb and lamp specifications.
  - Fulfilment can also be recorded through a form in the web UI.
- **Trigger description:** _open_
- **MCP tools:** _open_
- **Outputs:** Purchase Decisions, Requirements, Quick and Full Guides, Listings, Fulfilment and Deviations. Guide structure is _open_.

### Later Skills

Not in the PoC.

| Skill | What it does | Takes over from the PoC Skills |
|---|---|---|
| Lighting | Fixtures, bulbs, lamp placement, daylight strategy | Bulb and lamp specifications, from Purchase |
| Layout | Furniture placement and clearances | Size and clearance derivation, from Purchase |
| Storage | Storage needs and solutions | Storage furniture needs, from Purchase |
| Review | Walks the user through open flags, Conflicts and Deviations | Nothing. In the PoC the web UI resolves these |
| Tidy | Proposes merges and archives for the user to approve | Nothing |

## Sessions and the shared protocol

- **Session scope.** A Session is one sitting in one Agent conversation. It opens when the first Skill starts and is bound to the Home active at that moment. Every Skill loaded later in the same conversation joins that Session. Two terminals each hold their own Session.
- **Protocol source.** The shared protocol is written once in source and inlined into each `SKILL.md` at build time, so every packaged Skill is self-contained. Rejected alternatives:
  - cross-Skill links and `${CLAUDE_PLUGIN_ROOT}`, which Codex doesn't expand
  - server-delivered protocol text, which Agents treat as data
  - a separate protocol Skill that must load alongside the others
- **Round format.**
  - Each round asks 3–5 numbered questions, each with a recommended answer. The user can accept them all, or answer some and skip the rest.
  - Writes happen after every round, so quitting mid-Session loses nothing.
  - Depth varies by Skill: Design Direction digs deep, and a Purchase for a lamp takes one or two rounds.
  - Once the current Decision could be Locked, every round offers to stop there. The target is 15–40 minutes.
- **Opening.** The first Skill opens the Session and gets back:
  - the Home Overview, with Locked Decisions alongside (how they are tiered belongs to the [Agent context brief](../handoff/agent-context.md))
  - the Active Home's name
  - whether the Design Direction is Locked
  - open flags and Conflicts

  The Skill names the Home and warns if the Design Direction isn't Locked. It mentions flags and Conflicts in one line: a count, plus any in its own scope. It does not resolve them.
- **Closing.** When the work is done or the user wraps up, the Agent writes a three-part summary: what changed, what's still open, and a suggested next Skill.
- **No time limit.** A Session is never closed for inactivity. How a Session that never gets a summary is treated is _open_.

## Rule enforcement

**Principle.** The server enforces everything it can check from data, refusing with an actionable error. The Skills own every judgment about what the user meant. There are no hooks in the PoC: hooks only work in Claude Code, and Codex runs them only after the user trusts them. The server `instructions` carry a summary of the core rules, under 512 characters, as a backstop.

| Server enforces (refuses) | Server supplies, the Skill says it | Skill instructions only |
|---|---|---|
| Writes need an open Session bound to its Home | Active Home name, and whether the Design Direction is Locked, at Session open | Lock only on clear commitment |
| Every state change carries its Session and a non-empty reason | Notes are left out of the Home Overview; a search tool finds them | Never re-propose a Rejected Decision (look up Rejected ones in scope first) |
| Only legal transitions | Open flags and Conflicts at Session open | A Note alone never changes a Decision's state |
| The Design Direction is automatically in every Basis; Basis and Evidence entries must exist in this Home | | A Room Direction refines, never contradicts, the Design Direction |
| No deletion of anything referenced: Archive instead | | Spotting Conflicts (the server provides a flag-Conflict tool) |
| Flags cascade automatically on Reopen, Reject, and a Deviation from a *must* Requirement | | A Constraint only from a fact the user states |

**User confirmation** (_pending confirmation_):
- **Confirmed by the user, not the Agent:** Reopen, Rejecting a Locked Decision, reviving a Rejected Decision, creating a Constraint (the dialog is the read-back), and removing a Constraint. The server asks the user directly, through an elicitation dialog with a required `confirm` field.
- **The Agent's word is enough:** Lock, and moves between Candidate, Leaning and Rejected. The user's words are quoted as the reason.
- **When the client can't show the dialog:** _open_.

## Auto-selection and hand-off

- **Four separate Skills.** Each description states what the Skill does and when to use it, and names what it is not for (UI, CSS, brand or chart colors; real estate). Drafts are _open_.
- **Hand-off.** When one Skill hits another's question, it asks: "settle this in Color now, or park it?" The default is to switch.
  - **Switching** stays in the same Session, and the first Skill resumes afterwards.
  - **Parking** records the need as a *prefer* Requirement with the reason "Palette pending", and the Session summary lists it under "still open".
  - Skills name each other in plain words, never as slash commands, so they work in Codex too.

## MCP tool surface

_Open._

## Packaging

- **Scope.** The plugin is installed at project scope in a dedicated folder, so it costs nothing in unrelated Claude Code sessions. Whether Codex can enable a plugin per project is unverified.
- **Server `instructions`.** Kept under 512 characters.
- **Measuring.** Context cost is measured with `claude plugin details` and `/skill-doctor`.
- **Still _open_:** how a folder relates to a Home, the manifest layout, the MCP config, who starts the server, and versioning.

## Testing

1. **Trigger evals per Skill.** About 10 prompts that should fire it and 10 near misses (a CSS palette, a real-estate listing, "what goes with navy?"), graded on whether the Skill fired. **The user reviews and revises every prompt set before it's committed.**
2. **Behaviour evals.**
   - Each case replays a saved transcript up to one user turn, with the MCP tools mocked, and grades the next turn. Examples: "no Lock call without commitment", "read-back before creating a Constraint".
   - A rubric grader checks that Requirements trace to their sources and that the Guides are good.
   - Every rule that lives only in Skill instructions gets at least one case.
3. **Server tests.** Ordinary TypeScript tests cover every server-enforced rule, with no model involved.
4. **Live smoke suite.** Runs against the real localhost server, once a pilot shows the eval harness can reach it.
5. **Acceptance.** The PoC finish line, run manually on the user's real home.

## Questions for the Home-model session

1. ~~**Color values:** do Surface colors share the Palette's color representation, including Provenance?~~ Answered yes in [home-model.md](home-model.md): one Color value shape everywhere.
2. ~~**Requirement reasons:** can a reason point at a Wall or a Feature?~~ Answered yes: it can point at any recorded part, and a change to that value flags the Purchase Decision.
3. ~~**Interview minimum:** which fields must the interview collect?~~ Answered by the Gap list: the required fields, then the Gaps.
