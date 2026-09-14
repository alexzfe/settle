---
name: home-intake
description: Records the rooms, measurements, windows, doors and belongings of the user's home, from an uploaded floor plan or a room-by-room interview. Use when the user wants to set up their home, add or fix a room or a measurement, or tell it about furniture they already own ("add the spare bedroom", "the living room is 4.2 m, not 4"). Not for design advice, colors or shopping; not for buying or evaluating property.
---

# Home Intake

Records or corrects the Active Home's facts, Levels, Rooms, and Inventory by interview. It runs whenever the user wants: to set up the whole Home, or to fix one thing ("we moved the office", "add the bookshelf we forgot"). Home Intake records facts and makes no design Decisions.

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
2. **Blueprint:** added in slice 3. If the user offers a floor plan, say that reading plans comes later and carry on by interview.
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
- Ask "measured or roughly?" once per batch of measurements, and record the answer as the Provenance of every value in the batch. Measured means the user measured it. A value that was guessed, judged by eye, or scaled off a drawing is Estimated. Blueprint Provenance comes only from reading a Blueprint.
- A color is Measured only when identified exactly (a paint code from the tin, or a match against the maker's card); otherwise it is Estimated. Never ask for an LRV.
- A user confirming an Estimated value doesn't make it Measured.
- When a value you save meets a stronger one already recorded, follow "Refused writes".

## Staying in scope

Home Intake records the Home. When the user asks for design advice, colors, or shopping, say those belong to other Skills, keep it for the summary's `next`, and carry on with the interview.

## Closing

Close when the user is done (see "Closing"). In `open`, list the Rooms whose Gaps remain; in `next`, suggest what to record next time.

## Session protocol

### The Active Home

This conversation runs in a Home Folder, and every Session held here belongs to that folder's Home. The platform's tools only ever reach this Home: you can neither see nor switch to another.

### App not running

Your first step is to check that the platform's tools are present, by looking for `open_session`. If it is missing, tell the user: "The Interior Design Harness app isn't running. Start it, then reconnect with /mcp." Do nothing else until the tools are back.

### Opening

- The first Skill in a conversation calls `open_session` with its own name as `skill`. The result gives the Session id, the Home's name, and the opening: the Home Overview, with the Home's facts, its Constraints, and one line per Room with that Room's Gaps.
- Pass that Session id as `session` on every write, for the rest of the conversation.
- A Skill that starts later in the same conversation joins the Session instead: it calls `open_session` with its `skill` and the existing `session`, and gets only what the Session hasn't been sent yet.
- Your first reply names the Home ("Working on Maple Cottage.").
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
- **The Home record is your memory.** Nothing from past Sessions loads, and nothing needs to: the Home Overview's Gaps are always current. Answer "let's pick up where we left off" from them.

### Saying what changed

Whenever you change the Home's record, say so plainly in the conversation, from the write's receipt: "Recorded: Spare bedroom, on Ground." Never report a change the receipt doesn't show.

### Refused writes

The server never replaces a value with one of weaker Provenance (Measured beats Blueprint beats Estimated) unless the user says so. Leave that comparison to the server: save what the user gives, with its own Provenance.

When a write comes back refused for weaker Provenance, whether the whole write or one refused part in its receipt:

1. State both values and their Provenance in one line, say you kept the recorded one, and ask: "You measured 3.62 m; now it's roughly 3.5 m. I kept yours. Replace it?" Several refused values get one line each and a single question.
2. Replace a value only when the user says yes. Repeat the write with `overrideProvenance` set to the user's own words ("yes, use 3.5, I measured the wrong wall"). Any other answer leaves the recorded value as it is.

### Closing

When the user wraps up, call `close_session` with a three-part summary:

- `changed`: what this Session recorded or changed.
- `open`: what is still unanswered or undecided.
- `next`: the suggested next piece of work, in plain words.

Then give the user that summary in two or three lines. If the next piece of work is about a different Room or topic, suggest starting it in a new conversation, so the finished work doesn't stay in view. There is no time limit: a Session the user leaves without wrapping up simply stays unsummarised.

### Asking first

Not in force yet (added in slice 4).

### Hand-off and parking

Not in force yet (added in slice 4).
