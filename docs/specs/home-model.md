# Home model spec

**Status: settled, confirmed by the user on 2026-09-13.** This spec covers what the platform records about a Home, its Rooms, and its Items, as agreed in the Home-model grilling of 2026-09-13. Vocabulary lives in [CONTEXT.md](../../CONTEXT.md), and the settled PoC shape in [poc-design.md](../poc-design.md). The research behind it is in [docs/research/](../research/): designer intake, daylight and lighting, floor-plan formats, and Blueprint extraction.

## Principles

- **Nearly everything is optional.** Only a handful of fields are required, so a Room can be saved from one sentence. What advice needs but is missing is reported as a Gap rather than demanded up front.
- **Handle edge cases when they arise.** Anything the model has no field for goes into an "other" kind with a description, or a Note. Sloped ceilings, sockets, and similar cases wait until a real Home needs them.
- **The AI gets what the current work needs, in full, and nothing it would have to ignore** (see [Context tiers](#context-tiers)).
- **v1 is a Room list, but it is shaped so the 2D Floor Plan extends it rather than replacing it.** Walls exist from day one, and windows and doors point at them.

## Conventions

- **Units:** every length is stored in millimetres. The user picks metric or imperial once for the whole app, and that setting only changes how values are shown.
- **Provenance:** every length and every color carries a Provenance: Measured, Blueprint, Listed, or Estimated.
  - **Measured** means the user measured it. For a color, it means the color was identified exactly (a paint code from the tin, or a match against the paint maker's card).
  - **Blueprint** means the figure was *printed* on a Blueprint. The value also stores which Blueprint, the page, and the text exactly as printed (e.g. `12'6"`).
  - **Listed** means taken from the product's Listing: the maker's or shop's figures. Only an Item's sizes and colors can be Listed, plus the three register facts a Fulfilment copies from the Listing bought (see [Item](#item)); a Room, Wall, Window, Door, Feature, or Surface never is, and the server refuses it there.
  - **Estimated** means judged by eye: by the AI from a Photo, scaled off a drawing, or guessed by the user. Confirming an Estimated or Listed value does not make it Measured.
- **Identifiers:** every record the AI or the web UI can name (a Level, Room, Wall, Window, Door, Feature, Item, Constraint, Note, Blueprint, Photo, Session, or Decision) has a slug, unique within its Home, that the platform derives from its name when it is created ("living-room", "sofa", "sofa-2"). A slug never changes afterwards, even if the name does, and the user never edits it. Slugs are the identifiers in tool calls and renderings; database ids stay internal. Walls are named by their Room and position ("living-room/wall-1").
- **The Source column** in the tables below says who supplies each field:
  - *User*: stated by the user, through the AI or a UI form.
  - *Provenance*: the value carries a Provenance, as above.
  - *AI*: the AI fills it in during a Session.
  - *Platform*: the platform assigns or derives it.
- **The Required column** in the tables below:
  - *Req*: the record can't be saved without it.
  - *Opt*: optional.
  - *Gap*: optional, but its absence shows as a Gap.

## Records

### Home

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| name | The user's label for the Home | text | User | Req |
| country | Country the Home is in; also sets the market for Listings | country | User | Req |
| city | City or town. No street address and no coordinates, for privacy | text | User | Req |
| latitude | Derived from the city, rounded to 0.1° (about 11 km). Sets the hemisphere, so compass advice flips correctly | degrees | Platform, from the bundled GeoNames `cities15000` table; the create-Home form asks for it directly when the city isn't found | Req |
| Tenure | Owned, rented, or other. Never implies a restriction on its own; what the user may change is recorded as Constraints | enum | User | Opt |
| planned stay | How long the user expects to live there. Tempers investment advice | under 1 yr / 1–3 / 3–10 / indefinitely | User | Opt |
| building type | | house / apartment / other | User | Opt |
| building era | Approximate age, e.g. "1890s terrace". Hints at period features | text | User | Opt |
| lift | Whether the building has a lift | none / yes | User | Opt |
| lift door width, lift car depth | For getting furniture in | mm | Provenance | Opt |
| narrowest access point | Narrowest point on the way into the Home: its width and what it is (e.g. "turn in the communal stair") | mm + text | Provenance | Opt |

The web UI creates a Home from its name, country, and city, and the platform derives the latitude. A Home Folder can be set up only once its Home exists. The Home stores no Home Folder path: the platform may be hosted and cannot see the user's disk, and a Home has one folder per computer ([ADR 0006](../adr/0006-home-folder-files-fetched-not-written.md), 2026-09-19).

There is no Home-level orientation: compass direction is recorded on each Wall. There is no structured household either: people and pets who impose rules are Constraints, and softer context is Notes.

### Level

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| name | e.g. "Ground", "Loft" | text | User | Req |
| storey | Storey in the building: 0 for ground, −1 for basement, 5 for a fifth-floor flat. Also sets the order of Levels | integer | User | Req |

Every Home has at least one Level. Gardens and patios sit on the ground Level.

### Room

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| name | The user's name for it, e.g. "Mia's room" | text | User | Req |
| Level | The Level it is on. A staircase belongs to the Level you enter it from | Level | User | Req |
| functions | How it is used now; may be empty (use undecided). Choosing a use is a Decision, and Fulfilling it updates this field | zero or more of the [function list](#fixed-lists) | User | Opt |
| outdoor | A balcony of any size you can step onto, a terrace, patio, or garden. A railing-only (Juliet) balcony is not a Room: it is a glazed Door to outside | yes / no, default no | User | Opt |
| ceiling height | Full ceiling height | mm | Provenance | Gap |
| times of use | When the Room is mostly used; drives daylight versus lamplight advice. *rarely* answers it for a Room used too seldom to name a time | any of morning / daytime / evening / night / rarely | User | Gap |
| windowless | Marks a Room confirmed to have no Windows **and** no glazed Door leading outside or onto an outdoor Room, so the missing daylight opening isn't reported as a Gap. A Room whose only glazing is a balcony door is not windowless, and recording a daylight opening clears the flag | yes / no | User | Opt |
| Surfaces | Walls, ceiling, floor, and woodwork (see [Surface](#surface)) | | | Gap |
| Walls | Ordered list (see [Wall](#wall)) | | | Gap |

**The test for a Room:** a wall with a doorway divides two Rooms, whether or not a door hangs in it. A missing or partial wall does not. So an open-plan kitchen-living area is one Room, and a borderline archway is the user's call. Hallways, stairs, walk-in closets, utility rooms, and garages are Rooms. A built-in cupboard is a Feature. An off-site storage unit is not part of the Home, and Items kept there are Unplaced.

### Wall

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| position | Order in the clockwise list around the Room (viewed from above). Stable, so wall *i* becomes the edge between corners *i* and *i+1* in the 2D Floor Plan | integer | Platform | Req |
| length | Wall lengths *are* the Room's floor dimensions; there is no separate length × width. Every angle is assumed square until the 2D Floor Plan | mm | Provenance | Gap |
| facing | Compass direction the Wall faces outward. Exterior Walls only. No Provenance, because a guess is precise enough; north on a Blueprint is always confirmed with the user | 8-point compass | User | Gap if it has a daylight opening |
| beyond | What is on the other side. A Wall with an outdoor Room beyond it (a balcony) counts as exterior, so facing and obstruction apply | a Room / outside / unknown (default) | User | Opt |
| label | e.g. "window wall", "chimney wall" | text | User | Opt |
| obstruction | How much sky outside is blocked. Exterior Walls only. One answer per side of the building | open / partly / heavily, plus a deciduous-trees flag | User | Opt |
| Surface | A whole-Wall exception to the Room's wall Surface, such as a feature wall | Surface | | Opt |

A rectangular Room starts with 4 Walls and an L-shaped one with 6. Walls are optional for outdoor Rooms. Adjacency between Rooms is derived from `beyond` and from Doors.

### Window

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| Wall | The Wall it is in, or the roof for a skylight | Wall / roof | User | Req |
| roof facing | For a roof window, the direction the roof slope faces | 8-point compass | User | Opt |
| kind | | standard / bay / roof | User | Opt |
| width, height | | mm | Provenance | Opt |
| sill height | Above the floor. Decides what fits beneath (a radiator, storage, seating) | mm | Provenance | Opt |
| offset | From the Wall's start corner (clockwise order) to the Window's near edge | mm | Provenance | Opt |
| glass | | clear (default) / obscured, tinted, or filmed | User | Opt |

### Door

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| side A | A Room and its Wall | Room + Wall | User | Req |
| side B | The other Room and its Wall, or outside. An outdoor Room without Walls is named without a Wall | Room + Wall / outdoor Room / outside / unknown | User | Opt |
| clear width | For getting furniture in | mm | Provenance | Opt |
| height | | mm | Provenance | Opt |
| glazed | A glazed door (e.g. French doors) counts as a light source | yes / no | User | Opt |
| no door | A doorway with nothing hanging in it | yes / no | User | Opt |
| offset | Along the side-A Wall, as for Windows | mm | Provenance | Opt |

A Door is one record shared by both Rooms it joins. `save_room` names a Door by the other Room's slug and, optionally, an existing Door slug. When no slug is given and a Door already joins those two Rooms, the server updates it and says so in the receipt. Two Doors between the same pair of Rooms need explicit slugs.

### Surface

Every Room has four Surfaces: walls, ceiling, floor, and woodwork (skirting, door frames, doors, and window frames). Surfaces are the Room's current state, and Fulfilment updates them.

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| material | e.g. plaster, wallpaper, oak boards, carpet | text | User / AI | Opt |
| color | See [Color value](#color-value) | Color value | Provenance | Opt |
| finish | Paint sheen or surface finish | e.g. matt / eggshell / satin / gloss / n/a | User | Opt |

- A single Wall can carry its own wall Surface.
- A partial treatment, such as a tiled splashback or panelling, is a Feature.
- The floor Surface can hold several materials, each with a short note of where it is (e.g. "tiles, kitchen end"), until the 2D Floor Plan gives areas shapes.

### Color value

A color value has one shape everywhere: in Surfaces, Palette colors, and Items.

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| name | "Setting Plaster", or "warm grey" for a fabric | text | User / AI | Req |
| brand, code | The paint maker and their code | text | User | Opt |
| LRV | Light reflectance value, when the maker publishes it. Never asked of the user | 0–100 | AI | Opt |
| approx. hex | For showing the color on screen only | hex | AI | Opt |
| Provenance | Measured when identified exactly; Estimated when judged from a Photo | | | Req |

### Feature

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| Room | | Room | User | Req |
| kind | | [Feature kinds](#fixed-lists) | User | Req |
| description | Required when the kind is "other" | text | User | Opt |
| Wall | The Wall it is on or against | Wall | User | Opt |
| position note | e.g. "under the window" | text | User | Opt |
| size | width × height × depth | mm | Provenance | Opt |
| light | [Light attributes](#light-attributes), for a Feature that gives light (e.g. a downlight) | | | Opt |
| archived | When and why: removed, or replaced by a new Feature (a Purchase Decision may replace a radiator) | date + reason + optional replacing Feature | Platform / User | Opt |

### Item

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| name | | text | User / AI | Req |
| category | | [Item categories](#fixed-lists) | User / AI | Req |
| quantity | Identical pieces kept as one Item (six dining chairs). The set is split when one piece diverges (moved or reupholstered) | integer, default 1 | User | Opt |
| Room | Empty means Unplaced | Room | User | Opt |
| Wall, position note | Where it sits. No Wall means free-standing | Wall + text | User | Opt |
| width × depth × height | | mm | Provenance | Opt |
| colors | | Color values | Provenance | Opt |
| materials | | text list | User / AI | Opt |
| condition | | good / worn / damaged | User | Opt |
| brand, model, link | Stated by the user, or the link copied from the Listing bought at Fulfilment | text / URL | User / AI | Opt |
| bought on | The day of Fulfilment, or when the user says it was bought | `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`, shown at that precision | User / Platform | Opt |
| bought from | The shop. At Fulfilment, the Listing URL's host without `www.`, unless the AI gives a nicer name | text | User / AI | Opt |
| price paid | Free text, as the user says it ("S/ 1,299", "about 400 soles"). At Fulfilment, the Listing's price | text | User / AI | Opt |
| warranty until | The web form also takes a length ("2 years"), counted from *bought on* at its precision | same as *bought on* | User | Opt |
| serial number, manual link | The link can hold the maker's warranty or registration page | text / URL | User | Opt |
| light | [Light attributes](#light-attributes), for an Item that gives light | | | Opt |
| archived | When and why: replaced by another Item, sold, given away, or broken | date + reason + optional replacing Item | Platform / User | Opt |

- **The register** is *bought on*, *bought from*, *price paid*, *warranty until*, *serial number*, and *manual link*. The AI records these when the user mentions them and never asks for them. `find_items` prints them when filled; the Room Sheet leaves them out.
- **Listed register facts.** When a Fulfilment names the Listing bought, *bought from*, *price paid*, and *link* are copied from it and tagged Listed; anything the AI gives explicitly wins untagged. Editing one of them removes its tag. *Bought on* is never tagged. Sizes are never parsed from a Listing's free-text dimensions: the AI gives them, as Listed.
- **The web can edit an Item** through the edit pencil on its page: the register, sizes (Measured or Estimated only), brand, model, link, condition, colors, materials, and position note. Name, category, quantity, Room, Wall, archiving, and replacing are Session work. A web edit is the same write as the AI's, logged with origin `web`, and always overrides Provenance, since the pencil is the user saying so.
- There is no "keep or replace" field: replacing an Item is a Purchase Decision.
- An attachment like "it's my grandmother's, it stays" is a Constraint.
- Archived Items stay out of the Inventory and out of the AI's context, but anything that references them keeps working.

### Light attributes

Light attributes sit on whichever Item or Feature actually gives the light: a pendant shade on a ceiling point carries them on the Item, and a recessed downlight carries them on the Feature. A Room with no lights recorded is "unknown", not "dark".

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| role | | ambient / task / accent | User / AI | Opt |
| color temperature | | kelvin, or warm / neutral / cool | User | Opt |
| brightness | From the bulb box. Light level matters more to how a Room feels than color temperature | lumens | User | Opt |
| dimming | Only dim-to-warm and tunable change the color | none / standard / dim-to-warm / tunable | User | Opt |
| CRI | How faithfully the light shows colors. The AI assumes 80 when unknown | number | User | Opt |

### Photo

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| file | A copy kept by the platform, so later Sessions can look again | image | User | Req |
| subject | A Room (possibly showing some of its Items) or a single Item. Exactly one of the two | Room / Item | User | Req |
| taken | Taken from the file where possible, else the upload date. Tells the AI whether a Photo predates a change such as a repaint | date | Platform | Req |
| caption | | text | User | Opt |

Inspiration images are not Photos.

In the PoC, Photos are scaffolding: the platform stores them and the web UI uploads and shows them, but the AI neither sees nor uses them ([skill-set.md](skill-set.md#blueprints-and-photos)).

### Blueprint

| Field | Meaning | Unit / values | Source | Required |
|---|---|---|---|---|
| file | A copy kept by the platform. A Home may have several Blueprints | image / PDF | User | Req |
| label | e.g. "estate agent plan" | text | User | Opt |
| page Levels | Which Level each page shows | page → Level | User / AI | Opt |

No scale is stored, because values are never measured off the drawing: a value scaled off a drawing is Estimated.

## Fixed lists

- **Room functions:** kitchen, dining, living, bedroom, office, bathroom, hallway, stairs, storage, utility, garage, other. Being outdoors is the Room's `outdoor` field, not a function, so a balcony can also be "dining".
- **Item categories:** seating, tables, beds, storage, lighting, rugs, textiles (curtains, cushions, throws), art and mirrors, decor, plants, appliances, electronics, outdoor, other.
- **Feature kinds:** radiator or heater, fireplace or chimney breast, built-in storage, fitted kitchen or bathroom units, beam or column, light point or downlight, tiling or panelling, other.

## Rules the Home model owns

- **No weaker overwrites.** A value is never replaced by one with weaker Provenance (Measured > Blueprint > Listed > Estimated) unless the user explicitly says so. The server refuses such a write and says why. The weaker value is not stored. The user's say-so travels as an optional `overrideProvenance` reason on the write: the server then accepts the weaker value, requires the reason to be non-empty (the Skill quotes the user), and logs the override. The override exists because the stronger value can be wrong: a mis-typed measurement, a wall that has since changed, or a guess once recorded as Measured.
- **Change log.** Every change to a Home record is logged with what changed, when, and whether it came from the web UI or from which Session. The log exists for undo and audit, and it is never loaded into the AI's context. The Home itself holds only current state. Earlier states survive in Fulfilled Decisions, Deviations, and dated Photos.
- **Requirement reasons can point at any recorded part:** a Room, Wall, Window, Door, Feature, Surface, or Item, and optionally one field of it ("living-room/wall-2, length"). When a field is named, only a change to that field flags the Purchase Decision, and so does Archiving or restoring the record; when none is named, any change to the record does, except a change to an Item's register (*bought on*, *bought from*, *price paid*, *warranty until*, *serial number*, *manual link*), which flags only a reason that names that field. A field must be one the record's receipts name (`length` of a Wall, `room` of an Item), and the server lists them when it refuses one. The platform detects the change and raises the flag.
- **Archiving, not deleting.** Anything a Requirement's reason can point at (a Room, Wall, Window, Door, Feature, or Item, as well as a Constraint) is Archived rather than deleted, so every reference keeps working. Removing a Room or a Constraint Archives it. Archived records leave the Home's current state.
- **windowless is cleared by a daylight opening.** Recording a Window, or a glazed Door leading outside or onto an outdoor Room, makes the flag false by definition, so `save_room` clears it and says so in the receipt. Where a row written before this rule still carries a stale flag, the Room Sheet and the Overview render the contradiction rather than hiding it behind the Daylight line: a flag nobody can see is one nobody can correct.
- **Gaps.** A Room's Gaps are worked out against the "enough for advice" list:
  - Wall lengths
  - ceiling height
  - a daylight opening (a Window, or a glazed Door leading outside or onto an outdoor Room), with the facing of the Wall it is in, or the Room marked windowless
  - times of use
  - the four Surfaces

  Outdoor Rooms are checked only for the floor Surface and times of use.

## Context tiers

Revised in the [Agent-context grilling](../handoff/agent-context.md) of 2026-09-13. **The AI gets what the current work needs, in full, and nothing it would have to ignore.** The aim is an Agent that stays focused and gives good advice, not one that saves tokens, so there are no token budgets.

- **At Session start:** only what every Session needs, whatever its topic. That means what any Skill could break (Constraints and Home-wide commitments), open Flags and Conflicts, and a map of the Rooms.
- **History never loads at start.** Fulfilled Decisions, past Sessions, and anything Archived are fetched only when a question reaches into the past, so a Home used for years opens as cleanly as a new one.
- **Don't starve it.** Once something is in play, it comes whole: a Room being worked on gets its full Room Sheet, not a trimmed one.

| Tier | What | When |
|---|---|---|
| Home Overview | The Home's facts (location, Tenure, planned stay, access, Levels), Constraints, a count of Unplaced Items, and one line per Room: name, Level, functions, size, ceiling height, window facings, times of use, Item count, and Gaps | Session start, for every Skill, together with open Flags and Conflicts |
| Home-wide Decisions in force | The Design Direction and the Palette in full. For each, whichever one is furthest along (Settled or Leaning), marked with its state, or a count of Candidates when none is chosen. Every other Home-wide Decision that is Settled and not Fulfilled, one line each | Session start, for every Skill except Home Intake, which makes no design Decisions |
| Room Sheet | Everything about one Room: Walls, Windows, Doors, Features, Surfaces, lights, one line per Item, and one line per Decision scoped to the Room that is Candidate, Leaning, or Settled but not yet Fulfilled | Fetched the first time a Session's work touches that Room |
| On request | Blueprint pages as images; the printed text behind Blueprint values; Items anywhere in the Home, Unplaced, or Archived; Decisions in any state, Fulfilled and Rejected ones included; one Decision in full, with its Full Guide only when asked for; Notes | When a question needs them |
| Never | The change log. Session records, except as Evidence lines inside a Decision. Photos, in the PoC | |

- **Room lines stay full.** Every field in a Room line serves some Skill's work across Rooms. A Palette is chosen for the whole Home and needs every Room's light; without facings and times of use in the map, Color would have to fetch every Room Sheet.
- **Fulfilled Decisions drop out** because the Home record already holds what was done. Living-room walls painted "Setting Plaster" in June show up as the wall Surface, not as a Decision.
- **The tools behind each tier** are listed in the [skill-set spec](skill-set.md#mcp-tool-surface).

Rendering rules:
- Leave out empty fields.
- Mark Estimated values with `~` ("~3.6 m"). Measured and Blueprint values render plain.
- Use readable identifiers, not raw database ids.
- A Decision renders as one line: title, state, and a one-line statement. Its full content comes from `get_decision`. The Design Direction and Palette at Session start are the exception.

## v1 versus the 2D Floor Plan

**v1 records** everything in this spec: a Room list with ordered Walls, Windows and Doors attached to Walls (with optional offsets), Features and Items placed by Wall and position note, Surfaces, lights, Photos, and Blueprints.

**The 2D Floor Plan adds:**
- real geometry: corner coordinates, non-square angles, and curved walls
- wall thickness, and Walls shared between neighbouring Rooms
- door swing
- areas within open-plan Rooms, and a floor Surface's several materials given real shapes
- numeric positions and rotations for Items and Features
- sockets and switches
- the floor area a bay window adds
- sloped ceilings and the other edge cases deferred here

**Seams to keep:**
- an importer for Apple RoomPlan scans, which record walls, windows linked to walls, dimensions, and confidence
- an IFC exporter

The model follows the wall-reference pattern of Floorplanner, react-planner, and IFC rather than adopting any existing format ([ADR 0003](../adr/0003-v1-records-walls-in-own-schema.md), [floor-plan-formats.md](../research/floor-plan-formats.md)).

## Answers to the Skill-set session

1. **Palette and Surface colors:** yes. One [Color value](#color-value) shape serves Surfaces, Palette colors, and Items, with Provenance.
2. **Requirement reasons:** yes. A reason can point at a Wall, Window, Door, Feature, Surface, or Item as well as a Room, and a change to the pointed-at value flags the Purchase Decision.
3. **Home Folder:** the Home record stores the Home Folder's path (see [Home](#home)), so the web UI can show it and set it up again. The path is never given to the AI. **Superseded 2026-09-19:** no path is stored ([ADR 0006](../adr/0006-home-folder-files-fetched-not-written.md)).

## Questions for the Skill-set session

1. **Measure before buying:** when a *must* Requirement rests on a value that isn't Measured, should Purchase tell the user to measure before buying?
2. **Rented Homes:** when Tenure is rented, should Home Intake ask what the user may change and record the answers as Constraints?
3. **Times of use:** should Home Intake ask the times of use for every Room?
4. **Blueprint confirmation:** the [research](../research/blueprint-extraction-reliability.md) suggests auto-filling only printed text (Room labels, dimension strings, total area) and confirming in stages: the Room list with open-plan merges first, then dimensions, then Windows and Doors, and always asking where north is. Does Home Intake follow that?
5. **PDF Blueprints:** Agents that can't read PDFs (Codex) need a PDF turned into images first. Whose job is that?
6. **Inspiration images:** they aren't Photos. Where do they live? Possibly as Evidence for the Design Direction.
7. **Access checks:** should Purchase check the lift, the narrowest access point, Door widths, and stairs before recommending a Listing?
8. **Flags from Home changes:** when a Home value a Requirement's reason points at changes, who handles the flag, and how is the user told?
9. **Refused writes:** when the server refuses a write because its Provenance is weaker, what does the Skill tell the user?
10. **Undecided Rooms:** which Skill owns deciding an undecided Room's use (e.g. spare room: office or storage)?
11. **Fetching Room Sheets:** which tools deliver the Home Overview and Room Sheets, and when does a Skill fetch a Room Sheet?
