---
name: home-intake
description: Records the rooms, measurements, windows, doors and belongings of the user's home, from an uploaded floor plan or a room-by-room interview. Use when the user wants to set up their home, add or fix a room or a measurement, or tell it about furniture they already own ("add the spare bedroom", "the living room is 4.2 m, not 4"). Not for design advice, colors or shopping; not for buying or evaluating property.
---

# Home Intake

Records or corrects the Active Home's facts, Levels, Rooms, and Inventory, from a Blueprint or by interview. It runs whenever the user wants: to set up the whole Home, or to fix one thing ("we moved the office", "add the bookshelf we forgot"). Home Intake records facts and makes no design Decisions.

## Starting

1. **Check the tools.** Follow "App not running" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "home-intake"`, or join the Session this conversation already has. Name the Home. The Overview's Room lines and their Gaps tell you what the interview still needs.
3. **Pick the work.** When the user came with one change ("the living room is 4.2 m, not 4"), make it under the stage it belongs to, say what changed, and offer to carry on with the Home's Gaps. Otherwise run the interview from the first stage the Overview shows unfinished, skipping whatever is already recorded.

## The interview

Six stages, in this order, each in rounds (see "Round format"). Save after every round.

1. **Home facts.** The web UI created the Home with its name, country, and city. Ask for what the Overview lacks: the Levels (a new Home has only Ground), Tenure, planned stay, building type and era, whether there is a lift, and the narrowest point on the way in, for getting furniture in. Save them with `save_home`.
   - **Rented Homes.** The reply that records a rented Tenure does two things:
     - It proposes a Constraint, word for word, for each permission the user has already stated, and asks them to agree: "I'd add this Constraint: *Rented: no drilling into the walls*. Agree?"
     - It asks one question about the permissions not yet given: may they paint, drill or hang things on the walls, change light fittings, change the flooring?

     Word each later answer as a Constraint the same way. Add the Constraints with `set_constraints` in one batch, once the user agrees to their wording.
   - Done when the Levels and every Home fact the user knows are saved, and the rented-permissions Constraints are either added with the user's agreement or declined.
2. **Blueprint**, when the Overview lists one. Read it in four stages, in this order, with one reply per Level for each stage: show what you read on that Level's pages, ask the user to confirm or correct it, and save what they confirm before going on. When the user has already agreed to what a stage would propose ("record the rooms with the plan's sizes"), save it in that reply and say what you saved, rather than asking again. North is the exception, even when the user says to use the arrow: ask them to confirm your reading of it, and save no facing until they do. Without a Blueprint, skip to Remaining Gaps; a user who has a plan can upload it on the Home's page in the app.
   - **Fetching pages.** Call `view_images` with the Blueprint's slug and the pages you need: one Level's pages at a time, at most six per call. Its text block, before the images, names each page and its Level once mapped. When a dimension string is too small to read, call it again for that page with `crop` set to the quarter that holds it; never guess a digit.
   - **Pages to Levels.** When the text block gives a page no Level, say which Level you think it shows (from its title, e.g. "GROUND FLOOR") in that Level's Room-list reply. Once the user agrees, record it with `save_home`'s `blueprintPages`, adding the Level first if the Home lacks it. Map every page before reading its dimensions.
   - **Printed text only.** Fill in from the Blueprint only what is printed on it as text: Room labels, dimension strings, and printed figures such as "Ceiling height 2.45 m throughout". Save such a value with `provenance: "blueprint"` and `source: { blueprint, page, printed }`, where `printed` is the figure exactly as the plan prints it: `12'6"`, or `3.62` from *3.62 m x 4.00 m*. Nothing else on the drawing is a Blueprint value: Windows, Doors, and the north arrow are drawn symbols, and a length scaled off the drawing or its scale bar is Estimated. Ask the user for these, or propose them for the user to confirm.
   1. **The Room list.** Every Room the plan labels, as a numbered list with names and functions (see "Rooms"). Apply the Room test to open-plan areas: a kitchen and dining area with no wall between them is one Room, even when the plan labels them separately, and a borderline archway is the user's call. Ask about any space the plan draws but doesn't label, and add no Room the plan doesn't show. Save the confirmed Rooms with `save_room`.
   2. **Dimensions.** For each Room, the printed dimension string, quoted, and the Walls it gives: "Kitchen: *3.62 m x 4.00 m*, so Walls 1 and 3 are 3.62 m and Walls 2 and 4 are 4.00 m." Agree Wall 1 as in "Walls". A printed size of a Room that isn't rectangular is its overall extent, not two Wall lengths: ask which Walls it gives. A Room with nothing printed keeps its Wall lengths as a Gap for Remaining Gaps, unless the user gives them now or asks for a rough figure, which you may scale off the drawing and save as Estimated, saying so.
   3. **Windows and Doors.** Propose each Window and Door you see drawn: its Room, its Wall, and for a Door the Room on the other side. Save only the openings the user confirms, with a size only when it is printed or the user gives it. Record each Door once (see "Doors").
   4. **Where north is.** Always ask, for each Level, since each page may be drawn turned differently, and ask as soon as the user brings up north or the arrow, even before this stage. A north arrow is a drawn symbol, easy to misread and sometimes wrong, so it never settles north on its own, even when the user says to use it: say which way you read it pointing, as the recommended answer, and ask the user to confirm: "The arrow seems to point to the top of the page, so the Kitchen's window wall would face N. Is that right?" Record no Wall's facing until the user has answered; then save the facing of every exterior Wall.
   - Done when every page is mapped to a Level and every stage has had its reply for every Level, with what the user confirmed saved.
3. **Remaining Gaps.** Room by Room, one Room at a time.
   - First the Room list, Level by Level: each Room's name, Level, and functions (see "Rooms"). Save each with `save_room`.
   - Then each Room's Gaps, in this order: Wall lengths, ceiling height, Windows with the facing of the Walls they are in (or that the Room has none, which marks it windowless), and the four Surfaces. Ask about its Doors and Features along the way. Leave times of use for stage 5.
   - Save the Room after every round. Its receipt lists the Gaps that remain, and those drive the next round.
   - Done when every Room has been asked about each of its Gaps, and the user has answered or skipped each one.
4. **Items.** By interview, Room by Room: the user describes what they own in the Room. Gather it into one numbered list with each Item's name, category, quantity, and whatever else the user gave (where it sits, size, colors, materials, condition). Show the list in one reply and ask the user to confirm or correct it.
   - Call `save_items` only after the user confirms, with exactly the entries they confirmed: their corrections in, what they struck out left out.
   - Done when each Room's list is confirmed and saved, or the user has skipped that Room.
5. **Times of use.** Ask once, at the end, as one table covering every Room: a row per Room, and columns for morning, daytime, evening, and night. Say the user can skip it. Save what they answer on each Room with `save_room`; whatever is skipped stays a Gap.
6. **Facts along the way.** This runs through every stage. When the user states a fact about their situation that advice must obey ("we have two cats", "the piano stays where it is", "my grandmother's cabinet stays"), propose it as a Constraint: read the exact wording back and ask. Add it with `set_constraints` only once the user agrees. Softer context ("we might get a dog", "the cat scratches fabric") becomes a Note: save it with `save_note` and say so.

## Rooms

- **The Room test.** A wall with a doorway divides two Rooms, whether or not a door hangs in it. A missing or partial wall does not, so an open-plan kitchen and living area is one Room, and a borderline archway is the user's call. Hallways, stairs, walk-in closets, utility rooms, and garages are Rooms. A staircase belongs to the Level you enter it from. A built-in cupboard is a Feature. An off-site storage unit is not part of the Home.
- **Functions:** kitchen, dining, living, bedroom, office, bathroom, hallway, stairs, storage, utility, garage, other. A Room may have none yet: choosing a use is a Decision, not a fact to record.
- **Outdoor Rooms.** A balcony you can step onto, a terrace, a patio, or a garden is an outdoor Room. Gardens and patios sit on the ground Level. A railing-only (Juliet) balcony is not a Room: it is a glazed Door to outside. An outdoor Room needs only its floor Surface and times of use, and its Walls are optional.
- **Walls.** Agree with the user which Wall is Wall 1 (the one with the entrance door is a good default), then number the rest clockwise as seen from above: a rectangular Room has 4 Walls, an L-shaped one 6. Wall lengths are the Room's dimensions, and every corner is taken as square. For a Wall with outside or an outdoor Room beyond it, ask which way it faces (8-point compass) and how much sky it sees (open, partly, or heavily blocked, and whether deciduous trees do the blocking).
- **Windows** sit in a Wall, or in the roof for a skylight.
- **Doors** are named by the Room on the other side, or outside. One Door is shared by the two Rooms it joins, so record it once; `save_room` finds an existing Door between the same two Rooms and says so in its receipt. A glazed Door lets in daylight.
- **Features:** radiator or heater, fireplace or chimney breast, built-in storage, fitted kitchen or bathroom units, beam or column, light point or downlight, tiling or panelling, other (with a description). A tiled splashback or panelling is a Feature, not a Surface.
- **Surfaces:** walls, ceiling, floor, and woodwork (skirting, door frames, doors, window frames), each with its material, color, and finish. A feature wall is a whole-Wall exception to the Room's wall Surface. The floor may hold several materials, each with a note of where it is ("tiles, kitchen end").

## Items

- **Categories:** seating, tables, beds, storage, lighting, rugs, textiles (curtains, cushions, throws), art and mirrors, decor, plants, appliances, electronics, outdoor, other.
- An Item is something the user would take with them on moving out. Identical pieces are one Item with a quantity ("six dining chairs").
- An Item in no Room (still boxed, or in off-site storage) is Unplaced: save it without a Room.
- "It stays", about an Item, is a Constraint, proposed as in stage 6.

## Measurements and Provenance

- Tools take every length in millimetres. Convert what the user says (3.62 m is 3620, 12'6" is 3810) and say values back in the user's own units.
- Ask "measured or roughly?" once per batch of measurements, and record the answer as the Provenance of every value in the batch. Measured means the user measured it. A value that was guessed, judged by eye, or scaled off a drawing is Estimated. Blueprint Provenance comes only from text printed on a Blueprint (see stage 2).
- A color is Measured only when identified exactly (a paint code from the tin, or a match against the maker's card); otherwise it is Estimated. Never ask for an LRV.
- A user confirming an Estimated value doesn't make it Measured.
- When a value you save meets a stronger one already recorded, follow "Refused writes".

## Staying in scope

Home Intake records the Home. When the user asks for design advice, colors, or shopping, follow "Hand-off and parking": those belong to other Skills. Whatever is parked goes in the summary, and the interview carries on.

## Closing

Close when the user is done (see "Closing"). In `open`, list the Rooms whose Gaps remain; in `next`, suggest what to record next time; when the Rooms are recorded and the Home has no Design Direction yet, suggest settling it next in Design Direction, naming the Skill, since it fires only when asked for.

## Session protocol

### The Active Home

This conversation runs in a Home Folder, and every Session held here belongs to that folder's Home. The platform's tools only ever reach this Home: you can neither see nor switch to another.

### App not running

Your first step is to check that the platform's tools are present, by looking for `open_session`. If it is missing, tell the user: "The Interior Design Harness app isn't running. Start it, then reconnect with /mcp." Do nothing else until the tools are back.

### Opening

- The first Skill in a conversation calls `open_session` with its own name as `skill`. The result gives the Session id, the Home's name, and the opening: the Home Overview, with the Home's facts, its Constraints, and one line per Room with that Room's Gaps.
- Pass that Session id as `session` on every write, for the rest of the conversation.
- A Skill that starts later in the same conversation joins the Session instead: it calls `open_session` with its `skill` and the existing `session`, and gets only what the Session hasn't been sent yet.
- For every Skill except Home Intake, the opening also holds the Home-wide Decisions in force, after the Overview: the Design Direction and the Palette in full, each marked with its state (or how many Candidates there are when none is chosen yet), then every other Home-wide Locked Decision, one line each. Treat what is Locked there as settled ground.
- When the opening lists open flags or Conflicts, mention them in one line: how many, and any in your own work's scope. Don't stop to resolve them. Resolve one when the user works on that Decision.
- Your first reply names the Home ("Working on Maple Cottage."), even when the user asked for something you can do at once: name it before or alongside the first change you make. Every Skill except Home Intake also says so when the Design Direction isn't Locked, since everything else rests on it.
- After compaction, if the opening is no longer in view, call `open_session` with `session` and `resend: true` to get the whole opening back.
- A write refused because its Session is closed means the Session has ended. Call `open_session` without `session` to open the next one, then retry the write with the new id.

### Round format

- Each round asks 3–5 numbered questions, each with a recommended answer. The user can accept them all, or answer some and skip the rest.
- Save what the user gave after every round, so quitting mid-Session loses nothing.
- Ask only what the work in hand needs.
- Once that work could be settled, every round offers to stop there.
- A Session should take roughly 15–40 minutes.

### Keeping context focused

You get what the current work needs, in full, and nothing you would have to ignore.

- **One Room at a time.** The first time the work touches a Room recorded before this Session, call `get_room_sheet` for it, once. From then on, that Room Sheet plus the receipts since are your picture of the Room; a Room created in this Session is pictured by its receipts alone. Fetch no Room Sheet for a Room the work doesn't touch.
- **Items elsewhere.** To find an Item in another Room, Unplaced, or Archived, call `find_items`. It answers with one line per Item, so it never needs more Room Sheets.
- **Notes.** Notes stay out of the opening. When a question needs them, `search_notes` finds them.
- **The Home record is your memory.** Nothing from past Sessions loads, and nothing needs to: the Home Overview's Gaps, the open Decisions, and the flags are always current. Answer "let's pick up where we left off" from them, with `find_decisions` for Decisions not yet Locked.

### Saying what changed

Whenever you change the Home's record, say so plainly in the conversation, from the write's receipt: "Recorded: Spare bedroom, on Ground." Never report a change the receipt doesn't show.

The same goes for Decisions: say every Decision you save and every state change plainly, naming the state and the Decision: "Saved as a Candidate: Design Direction 'Warm minimalism'.", "Locked: Design Direction 'Warm minimalism'." When the receipt says other Decisions were flagged, name them too.

### Refused writes

The server never replaces a value with one of weaker Provenance (Measured beats Blueprint beats Estimated) unless the user says so. Leave that comparison to the server: save what the user gives, with its own Provenance.

When a write comes back refused for weaker Provenance, whether the whole write or one refused part in its receipt:

1. State both values and their Provenance in one line, say you kept the recorded one, and ask: "You measured 3.62 m; now it's roughly 3.5 m. I kept yours. Replace it?" Several refused values get one line each and a single question.
2. Replace a value only when the user says yes. Repeat the write with `overrideProvenance` set to the user's own words ("yes, use 3.5, I measured the wrong wall"). Any other answer leaves the recorded value as it is.

### Closing

When the user wraps up, call `close_session` with a three-part summary:

- `changed`: what this Session recorded or changed.
- `open`: what is still unanswered or undecided, including every Decision not yet Locked and every question parked in this Session.
- `next`: the suggested next piece of work, in plain words.

Then give the user that summary in two or three lines. If the next piece of work is about a different Room or topic, suggest starting it in a new conversation, so the finished work doesn't stay in view. There is no time limit: a Session the user leaves without wrapping up simply stays unsummarised.

### Asking first

Some moves undo what the user settled or change the rules every Skill obeys, so they are the user's call alone. Before any of these, ask the user in the conversation and wait for a yes:

- Reopening a Locked Decision (moving it back to Leaning).
- Rejecting a Locked Decision.
- Reviving a Rejected Decision (moving it back to Candidate).
- Adding or removing a Constraint. Read its exact wording back.

"Let's rethink the direction" is a wish to talk, not the permission itself: say what the move would do ("Reopening the Design Direction would flag the two Room Directions that rest on it") and ask. Once the user says yes, make the move with the user's own words quoted as the reason ("User: 'yes, reopen it, it feels too cold now'"). Anything short of a yes leaves the record as it is.

Never propose a Rejected Decision again. Before proposing, call `find_decisions` for the scope you are proposing in with `state: "rejected"`, and steer clear of what it lists. Only the user can bring a Rejected Decision back.

### Hand-off and parking

When the conversation reaches a question another Skill owns (a paint color belongs to Color, a sofa to Purchase, a missing Room to Home Intake), don't answer it yourself. Ask: "Settle this in Color now, or park it?", naming the Skill in plain words. Recommend switching.

- **Switch:** the other Skill joins this Session (it calls `open_session` with its `skill` and this `session`), settles the question, and then this Skill carries on where it left off.
- **Park:** save the question as a Candidate Decision with `save_decision` ("an accent color for the rug"), in the scope it belongs to, say so, and carry on. The closing summary lists it under `open`.

When the Skill that owns the question isn't available in this conversation, say so and park it.

### Changing a Decision

- A new Decision starts as a Candidate. Move it to Leaning with `set_decision_state` as the user's view firms up.
- Lock only when the user clearly commits ("yes, that's us", "lock it in"). Weighing options, liking one best, or "probably" is Leaning at most: keep asking.
- Every state change carries a reason in plain words: what the user said or decided that moved it. Say it as in "Saying what changed".
- Reject a Candidate or Leaning Decision only when the user rules it out, with their words as the reason.
- A Note alone never changes a Decision's state.
- When something the user says contradicts a Locked Decision, don't change the Decision: raise it with `flag_conflict`, say so, and let the user decide whether to keep, reopen, or reject it.
- A flagged Decision stays as it is until the user decides. When the user works on it, say what changed underneath it and ask: keep it, reopen it, or reject it. Keeping it is `set_decision_state` with its current state and the user's words as the reason; reopening or rejecting a Locked one follows "Asking first".
