---
name: home-intake
description: Records the rooms, measurements, windows, doors and belongings of the user's home, from an uploaded floor plan or a room-by-room interview. Use when the user wants to set up their home, add or fix a room or a measurement, ask what is recorded about a room, or tell it about furniture they already own ("add the spare bedroom", "the living room is 4.2 m, not 4"). Not for design advice, colors or shopping; not for buying or evaluating property.
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
