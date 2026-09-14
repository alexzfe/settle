# Skill set spec

**Status:** settled in the Skill-set grilling of 2026-09-13 and confirmed by the user. The trigger descriptions are drafts until the user revises them.

**Related docs:**
- Vocabulary: [CONTEXT.md](../../CONTEXT.md)
- Settled PoC shape: [poc-design.md](../poc-design.md)
- What the platform records: [home-model.md](home-model.md)
- How rules are enforced: [ADR 0004](../adr/0004-server-enforces-data-rules-skills-own-judgment.md)
- Research behind this spec: [docs/research/](../research/)

## The PoC Skills

There are four Skills: Home Intake, Design Direction, Color, and Purchase. Each Skill is one `SKILL.md`, so a Skill in the domain and a packaged Skill are the same unit. There is no router Skill.

### Home Intake

- **Purpose:** records or corrects the Active Home's Home facts, Levels, Rooms, and Inventory, from a Blueprint, an interview, or optionally Photos. It can be run again at any time ("we moved the office", "add the bookshelf we forgot").
- **Boundaries:** it records facts and makes no design Decisions. It runs in an ordinary Session, with the same Home binding, logging, and summary as any other Skill.
- **Procedure:**
  1. **Home facts.** The web UI has already created the Home with its name, country, and city ([Home](home-model.md#home)). Record its Levels and any other Home fact the user gives. When Tenure is rented, ask one question about the usual permissions: paint, drill or hang, change lights, flooring. Propose the answers as a batch of Constraints, and add them once the user agrees.
  2. **Blueprint**, if the user uploaded one. Go through it in stages, with one reply per Level for each stage, auto-filling only text printed on the Blueprint:
     1. The Room list, with open-plan merges.
     2. Dimensions.
     3. Windows and Doors.
     4. Where north is. Always ask this.
  3. **Remaining Gaps.** Always, with or without a Blueprint: interview Room by Room for whatever is still missing. Without a Blueprint, start with each Room's required fields. Then cover its Gaps (the Home model's "enough for advice" list), such as ceiling height and Surfaces, except times of use, which step 5 covers.
  4. **Items.** Mainly by interview: the user describes what they own, Room by Room, and confirms the list in one reply per Room. Optionally, the user uploads a Photo and the AI proposes a numbered list of what it sees (Items, Features, Surfaces), which the user confirms in one reply ("all but 3; 5 is oak, not pine"). Only confirmed entries are saved.
  5. **Times of use.** Ask once at the end, as one table covering every Room. The user can skip it, and whatever is skipped stays a Gap.
  6. **Facts along the way.** Propose any fact the user states as a Constraint, and save it once the user agrees. Softer context becomes a Note.
- **Outputs:**
  - Home facts and Levels
  - Rooms, with Walls, Windows, Doors, Features, and Surfaces
  - Items
  - Constraints and Notes

### Design Direction

- **Purpose:** grills and Locks the Home's Design Direction, each Room Direction, and the use of any undecided Room (for example, is the spare room an office or storage?). A Room's use and its Room Direction are decided together ("a calm office").
- **Boundaries:**
  - It owns temperature, mood, contrast level, key materials, style references, and guiding principles. It never names specific colors; those belong to Color.
  - It owns every Room Direction and checks that each one refines the Design Direction without contradicting it. Other Skills may suggest that a Room needs a Room Direction, but never write one.
- **Inspiration images** are not stored in the PoC. The user shows them to the Agent during the Session. What the AI takes from them goes into the Design Direction's style references, and the Session is recorded as Evidence.
- **Outputs:**
  - the Design Direction Decision
  - Room Direction Decisions
  - Decisions on the use of undecided Rooms
  - Fulfilment of those Room-use Decisions, which updates the Room's functions

### Color

- **Purpose:** grills and Locks the Palette, then per-Room color Decisions (for example, the living room walls in the Palette's base color, eggshell). Those Decisions rest on the Palette and on the Room's light, and they change a Surface when Fulfilled.
- **Boundaries:**
  - The Palette is the only source of color. Adding or changing a Palette color is always a Color question, even when a Purchase raises it (for example, a rug that needs an accent the Palette lacks).
  - The Palette enters the Basis only of Decisions that use one of its colors.
- **Outputs:** the Palette Decision and per-Room color Decisions. Every color uses the Home model's Color value.

### Purchase

- **Purpose:** owns the whole life of a Purchase Decision:
  - grilling it
  - writing its Requirements with reasons
  - writing the Quick Guide and Full Guide
  - checking any Listing the user brings, recording pass, fail, or unknown for each Requirement
  - recording Fulfilment and any Deviations
- **Boundaries:**
  - It applies the Palette but never extends it. The color of a fabric or finish is a Purchase Requirement whose reason is the Palette.
  - Until Furniture Placement exists, it derives size and clearance Requirements from the Room. Until Lighting exists, it handles bulb and lamp specifications.
  - In the PoC, Fulfilment is recorded only through the Agent, by the Skill that owns the Decision (see `record_fulfilment`). A web UI form for it is deferred ([poc-design.md](../poc-design.md#deferred-topics)).
- **Requirements:** each one is plain text ("under 85 cm tall"), marked *must* or *prefer*, with a reason linking to any Decision, Constraint, Note, or recorded part of the Home. The PoC has no structured numeric fields; the AI does the Listing and Deviation checks.
- **Checks:**
  - **Measure first.** A *must* Requirement that rests on an Estimated value puts a "Measure first: alcove width (~1.2 m)" line at the top of the Quick Guide. Purchase offers to record the real measurement on the spot.
  - **Access.** For anything large (a sofa, bed, wardrobe, or big table), Purchase adds a *must* delivery Requirement based on the narrowest point on the way in: the lift, the narrowest access point, or a Door's clear width. Its reason points at that record. If that point is unknown, it becomes a "measure first" line instead.
- **Guides.** Different products need different emphasis, so the structure is mostly per product.
  - **Quick Guide** (one phone screen). The platform builds it from the Requirements plus a few lines the AI writes (things to avoid, in-store tests), so it can't go stale when a Requirement changes. The only fixed parts are "Measure first" at the top when needed, and *musts* before *prefers*. Which Requirements appear, their order, and any extra lines suit the product: a cupboard leads with sizes and material, a cushion with color, fill, and firmness.
  - **Full Guide** (read ahead of time). Markdown the AI writes, under headings it picks for the product. The one rule is that every *must* explains why. It is marked out of date when the Requirements change after it was written.
- **Flags from Home changes.** When a value that a Requirement's reason points at changes, the platform flags the Purchase Decision. The flag appears at Session open and in the web UI. Purchase handles it when the user next works on that Decision.
- **Outputs:**
  - Purchase Decisions and their Requirements
  - Quick and Full Guides
  - Listings
  - Fulfilment and Deviations

### Later Skills

These are not part of the PoC.

| Skill | What it does | What it takes over from the PoC Skills |
|---|---|---|
| Lighting | Lights (the Items and Features that give light), bulbs, lamp placement, daylight strategy | Bulb and lamp specifications, from Purchase |
| Furniture Placement | Where furniture goes, and clearances | Size and clearance derivation, from Purchase |
| Storage | Storage needs and solutions | Storage furniture needs, from Purchase |
| Review | Walks the user through open flags, Conflicts, and Deviations | Nothing. In the PoC the web UI and any Skill resolve these |
| Tidy | Proposes merges and archives for the user to approve | Nothing |

## Trigger descriptions

**Drafts.** The user revises these before they are frozen, and the trigger evals then test them.

Each description:
- says what the Skill does and when to use it, in the user's own words
- says what it is not for
- keeps to spec-only frontmatter, at most 1,024 characters
- puts the key use case first, because both Agents shorten descriptions when the Skill list overflows

```
home-intake: Records the rooms, measurements, windows, doors and belongings of the
user's home, from an uploaded floor plan, photos, or a room-by-room interview. Use
when the user wants to set up their home, add or fix a room or a measurement, or
tell it about furniture they already own ("add the spare bedroom", "the living
room is 4.2 m, not 4"). Not for design advice, colors or shopping; not for buying
or evaluating property.

design-direction: Interviews the user to settle their home's overall style: mood,
warmth, key materials, style references, guiding principles. Also settles each
room's direction and what an undecided room is for. Use when the user wants to
work out their style or how a room should feel or be used ("I don't know what
style I like", "make the bedroom calmer", "office or guest room?"). Not for
specific colors (color) or things to buy (purchase); not for app, web or brand
design.

color: Interviews the user to choose their home's palette of named colors, then
the colors of each room's walls, ceiling, floor and woodwork, based on the home's
direction and each room's daylight. Use for paint, wall colors, and which colors
work together in the home ("what color for the hallway?", "is this grey too cold
for a north room?"). Not for the color of a product being bought (purchase); not
for UI, CSS, brand or chart colors.

purchase: Interviews the user about something to buy for their home, turns the
answers into must and prefer requirements traced to the rooms and earlier
decisions, and writes a quick guide for the shop and a full guide to read ahead.
Also checks product links against the requirements and records what was actually
bought. Use for buying, replacing or choosing furniture, lamps, rugs, textiles or
decor ("I need a new sofa", "is this rug right for the living room?", "I bought
the chair"). Not for property.
```

## Sessions and the shared protocol

- **Home Folders.** Each Home has one Home Folder, which the web UI sets up, and the user runs their Agent inside it. Every Session started there belongs to that folder's Home, whatever the web UI is showing. The web UI's Home switcher only changes what the UI displays, and the AI can neither see nor switch Homes.
- **Session scope.** A Session lives in one Agent conversation, and one conversation can hold several Sessions, one after another.
  - It opens when the first Skill starts.
  - Every Skill loaded later in the same conversation joins it.
  - Two terminals each hold their own Session.
  - A resumed conversation (`claude --continue`) keeps its Session; a new conversation starts a new one.
- **Protocol source.** The shared protocol is written once in source, and a build step inlines it into each `SKILL.md`, so every packaged Skill is self-contained. Rejected alternatives:
  - cross-Skill links and `${CLAUDE_PLUGIN_ROOT}`, which Codex doesn't expand
  - protocol text delivered by the server, which Agents treat as data
  - a separate protocol Skill that has to load alongside the others
- **App not running.** A Skill's first step checks that the platform's tools are present. If they are missing, the Skill tells the user to start the app and then reconnect with `/mcp`, and does nothing else until the tools are back. Starting the app automatically is deferred to the Hosting and Docker topic.
- **Round format.**
  - Each round asks 3–5 numbered questions, each with a recommended answer. The user can accept them all, or answer some and skip the rest.
  - Writes happen after every round, so quitting mid-Session loses nothing.
  - Depth varies by Skill: Design Direction digs deep, while a lamp Purchase takes one or two rounds.
  - Once the current Decision could be Locked, every round offers to stop there.
  - A Session should take roughly 15–40 minutes.
- **Opening.** The first Skill calls `open_session`, which returns:
  - the Home Overview, with Locked Decisions alongside (how they are tiered belongs to the [Agent context brief](../handoff/agent-context.md))
  - the Home's name
  - whether the Design Direction is Locked
  - open flags and Conflicts

  The Skill names the Home and warns if the Design Direction isn't Locked. It mentions flags and Conflicts in one line, giving a count plus any in its own scope, and doesn't stop to resolve them. Any Skill may resolve a flag later, when the user works on that Decision, and so can the web UI.
- **Saying what changed.** Whenever the AI changes a Decision's state or the Home record, it says so plainly in the conversation ("Locked: Palette 'Warm Clay'").
- **Asking first.** Before these moves, the AI asks the user in the conversation and waits for a yes. The recorded reason quotes the user's permission.
  - Reopen
  - Rejecting a Locked Decision
  - Reviving a Rejected Decision
  - Adding or removing a Constraint (it reads the exact wording back)
- **Refused writes.** When the server refuses to replace a value with a weaker-Provenance one, the Skill states both values and their Provenance in one line ("You measured 3.62 m; the photo suggests ~3.5 m. I kept yours. Replace it?"). It overrides only if the user says yes.
- **Closing.** When the user wraps up, the Agent calls `close_session` with a three-part summary: what changed, what's still open, and a suggested next Skill.
  - There is no time limit. A Session that never gets a summary stays unsummarised. That is harmless, because its record is built from its writes, and the web UI lists such Sessions without treating them as errors.
  - After a summary the Session is closed. A write carrying its id is refused with an error telling the AI to call `open_session`, which starts the next Session in the same conversation.

## Rule enforcement

Decided in [ADR 0004](../adr/0004-server-enforces-data-rules-skills-own-judgment.md):
- **The server** enforces everything it can check from the data, refusing with an actionable error.
- **The Skills** own every judgment about what the user meant.
- **No hooks and no confirmation dialogs** in the PoC.
- **Agent writes only.** The Session rules below apply to writes from the Agent over MCP. Web UI changes need no Session and are logged as coming from the web UI.

| Server enforces (refuses the write) | Server supplies, the Skill says it | Skill instructions only |
|---|---|---|
| Agent writes need an open (not closed) Session belonging to the Home Folder's Home | Home name, and whether the Design Direction is Locked, at Session open | Lock only on clear commitment, then say so |
| Every Agent state change carries its Session and a non-empty reason | Notes stay out of the Home Overview; `search_notes` finds them | Ask first before a Reopen, Rejecting a Locked Decision, or reviving a Rejected one; the reason quotes the user's permission |
| Only legal transitions (see below) | Open flags and Conflicts at Session open | Constraints: only from a fact the user states, read back, and added or removed only once the user agrees |
| The Design Direction is automatically in every Basis; every Basis and Evidence entry must exist in this Home | | Never re-propose a Rejected Decision (use `find_decisions` to look up the Rejected ones in scope first) |
| Nothing referenced is deleted; it is Archived instead | | A Note alone never changes a Decision's state |
| Flags cascade automatically on Reopen, Reject, a Deviation from a *must* Requirement, and a change to a value a Requirement's reason points at | | A Room Direction refines, never contradicts, the Design Direction |
| No value is overwritten by one of weaker Provenance unless the user overrides | | Spotting Conflicts and raising them with `flag_conflict` |

**Legal transitions.** The server refuses any other.

| From | To |
|---|---|
| Candidate | Leaning, Locked, Rejected |
| Leaning | Candidate, Locked, Rejected |
| Locked | Leaning (Reopen), Rejected |
| Rejected | Candidate (revive) |

**Server `instructions`** repeat the core rules as a backstop in case compaction drops Skill text. They stay under 512 characters. Draft:

> Interior design platform for one Home. Call open_session first and pass its session id on every write. Say plainly what you changed. Before a Reopen, rejecting a Locked Decision, reviving a Rejected one, or adding or removing a Constraint, ask the user and quote their permission as the reason. Never re-propose a Rejected Decision. A Note alone never changes a Decision. A refused write says what to fix.

## Auto-selection and hand-off

- **Four separate Skills,** chosen automatically from their descriptions. The user can also invoke one by name.
- **Hand-off.** When one Skill hits another Skill's question, it asks "settle this in Color now, or park it?" (naming whichever Skill owns the question) and defaults to switching.
  - **Switching** stays in the same Session, and the first Skill resumes afterwards.
  - **Parking** creates a Candidate Decision for the parked question (for example, "an accent color for the rug"). A Requirement that needs the answer points its reason at that Decision, and the Session summary lists it under "still open".
  - Skills name each other in plain words, never as slash commands, so the text works in Codex too.

## Blueprints and Photos

- The user uploads files in the web UI: Blueprints onto the Home, Photos onto a Room or an Item.
- A Skill fetches them with `view_images`, a few images per call. Claude Code caps a tool result at about 25K tokens.
- The server converts HEIC to JPEG and PDF pages to PNG, because both Agents accept only PNG, JPEG, GIF, and WebP. This also covers Codex's inability to read PDFs.
- A tool result that carries images has no `structuredContent`, because Codex drops the images when it's present.
- Photos are optional in the PoC. Only Home Intake depends on them, proposing Items from one. Any Skill may look at a Photo when one seems relevant.

## MCP tool surface

There are eighteen tools, shaped around tasks. Read tools and write tools are separate, so Codex can auto-approve reads. Claude Code loads the full tool definitions only when they're needed. Every tool is available to every Skill; the "Used by" column shows which Skills rely on it.

| Tool | What it does | Used by |
|---|---|---|
| **Read** | | |
| `open_session` | Opens a Session, or joins one by id and records the joining Skill. Returns the Home Overview, Locked Decisions, whether the Design Direction is Locked, and open flags and Conflicts | All |
| `get_room_sheet` | One Room's Room Sheet, fetched the first time the Session's work touches that Room | All |
| `find_decisions` | One line per Decision, filtered by Room or Home-wide scope, kind, and state. Includes Rejected ones | All |
| `get_decision` | One Decision in full: Basis, Evidence, Requirements, Guides, Listings, flags | All |
| `search_notes` | Notes matching a query | All |
| `view_images` | A Blueprint's pages, or a Room's or Item's Photos, as images | Home Intake |
| **Write** (each call carries the Session id) | | |
| `save_home` | Home facts and Levels | Home Intake; Purchase (access measurements) |
| `save_room` | One Room with its Walls, Windows, Doors, Features, and Surfaces | Home Intake; any Skill recording a fact the user states or a new measurement |
| `save_items` | Several Items at once | Home Intake; any Skill recording a fact the user states |
| `set_constraints` | Adds or removes (Archives) a batch of Constraints | All |
| `save_note` | One Note | All |
| `save_decision` | Creates or edits a Decision: content (including Design Direction and Palette content), scope, kind, Basis, Evidence, and Requirements for a Purchase. New Decisions start as Candidate | Design Direction, Color, Purchase |
| `set_decision_state` | Lean, Lock, Reject, Reopen, or revive (to Candidate), with a reason, within the legal transitions. The server cascades flags | Design Direction, Color, Purchase |
| `save_guides` | The Quick Guide's AI-written lines and the Full Guide | Purchase |
| `record_listing` | A Listing, with pass, fail, or unknown for each Requirement | Purchase |
| `record_fulfilment` | What was actually done, any Deviations, and the resulting Home changes: a new Item, an Archived Item, a changed Surface, a Room's changed functions, or a replaced (Archived) Feature | Purchase; Color (for painting); Design Direction (Room use) |
| `flag_conflict` | Raises a Conflict against a Locked Decision | All |
| `close_session` | The three-part summary | All |

**Why eighteen is enough, and not too many:**
- It is under OpenAI's guideline of fewer than 20, and well below the 30–50 at which Claude's tool choice starts to degrade ([mcp-tool-design.md](../research/mcp-tool-design.md)).
- No two tools do the same job, which matters more than the count.
- Merging tools would mix reads with writes, or merge unrelated schemas. That makes tool choice worse, not better.

**What to watch is the size of the definitions, not the count.** Claude Code loads definitions only when they are needed, but Codex loads them all up front. The richer schemas (`save_room`, `save_decision`) are the ones to keep lean. Measure them with `/context` on the user's real Home. Size budgets for definitions and results belong to the [Agent context brief](../handoff/agent-context.md).

## Packaging

- **The plugin ships only the Skills.**
  - A build step inlines the shared protocol into each `SKILL.md` and writes the plugin into this repo.
  - Frontmatter uses only the spec fields, and each `name` matches its directory name.
  - Skills sit flat under `skills/`, and the manifest has no `skills` field.
- **Setting up a Home Folder.** The web UI's "Set up Home Folder" action, available once the Home exists ([Home](home-model.md#home)), writes two files into a folder the user chooses:
  - **`.claude/settings.json`** enables the plugin for this folder only and names its marketplace, so Claude Code offers to install it. The plugin therefore costs nothing in unrelated Claude Code sessions.
  - **`.mcp.json`** points to the server at `http://127.0.0.1:<fixed port>/mcp/homes/<home>`. That URL is how the server knows the folder's Home.
  - **Why the MCP config lives in the folder:** Codex doesn't expand variables, and MCP roots are deprecated, so there is no portable way for a plugin-level config to tell the server which Home a folder belongs to.
  - **To verify during the build:** that Claude Code asks once to approve the folder's server.
  - **Codex:** its equivalents join the same setup step when Codex is supported. Whether Codex can enable a plugin per project is unverified.
- **Distribution and versioning.**
  - The plugin and its marketplace file live in this repo. The marketplace file gives the plugin a relative `./` source, which both Claude Code and Codex read.
  - For the single-user PoC, the user adds the marketplace from its local path. Moving it to GitHub later is a one-line change.
  - `version` in `plugin.json` is bumped on every release, because without a bump installed copies never update.
  - During development, use `claude --plugin-dir` with `/reload-plugins`.
- **Measuring context cost:** `claude plugin details` and `/skill-doctor`.

## Testing

1. **Trigger evals per Skill.** About 10 prompts that should fire the Skill and 10 near misses (a CSS palette, a real-estate listing, "what goes with navy?"), graded on whether the Skill fired. **The user reviews and revises every prompt set before it is committed.**
2. **Behaviour evals.**
   - Each case replays a saved transcript up to one user turn, with the MCP tools mocked, and grades the next turn. Examples: "no Lock call without commitment", "asks before adding a Constraint", "says what it changed".
   - A rubric grader checks that Requirements trace back to their sources and that the Guides are good.
   - Every rule that lives only in Skill instructions gets at least one case.
3. **Server tests.** Ordinary TypeScript tests cover every server-enforced rule, with no model involved.
4. **Live smoke suite.** Runs against the real localhost server, once a pilot shows the eval harness can reach it.
5. **Acceptance.** The PoC finish line, run manually on the user's real home.

## Answers to the Home-model session

1. **Measure before buying:** yes. Any *must* Requirement resting on an Estimated value puts a "Measure first" line at the top of the Quick Guide, and Purchase offers to record the measurement.
2. **Rented Homes:** yes. Home Intake asks one permissions question and proposes the answers as a batch of Constraints, added once the user agrees.
3. **Times of use:** asked once at the end of Home Intake, in one table covering every Room. The user can skip it, and whatever is skipped stays a Gap.
4. **Blueprint confirmation:** yes, in the stages you listed, with one reply per Level for each stage. Home Intake always asks where north is.
5. **PDF Blueprints:** the server converts PDF pages to PNG, and HEIC to JPEG, before handing them to any Agent.
6. **Inspiration images:** not stored in the PoC. They are shown to the Agent in a Design Direction Session and summarised into the style references, and the Session is the Evidence.
7. **Access checks:** yes. Large purchases get a *must* delivery Requirement based on the narrowest point on the way in, or a "measure first" line if that point is unknown.
8. **Flags from Home changes:** the platform flags the Purchase Decision. The flag appears at Session open and in the web UI, and Purchase handles it when the user next works on that Decision.
9. **Refused writes:** the Skill states both values and their Provenance in one line, and overrides only if the user says yes.
10. **Undecided Rooms:** the Design Direction Skill decides a Room's use together with its Room Direction.
11. **Fetching Room Sheets:** `open_session` returns the Home Overview. `get_room_sheet` fetches a Room Sheet the first time a Session's work touches that Room.

## Questions for the Home-model session

1. ~~**Color values:** do Surface colors share the Palette's color representation, including Provenance?~~ Answered yes: one Color value shape everywhere.
2. ~~**Requirement reasons:** can a reason point at a Wall or a Feature?~~ Answered yes: any recorded part, and a change to that part flags the Purchase Decision.
3. ~~**Interview minimum:** which fields must the interview collect?~~ Answered by the Gap list: the required fields, then the Gaps.
4. ~~**Home Folder:** each Home now has a Home Folder that the web UI sets up (see CONTEXT.md). Does the Home record need to hold anything about it, such as its path?~~ Answered yes: the Home record stores the path for the web UI, and it is never given to the AI.
