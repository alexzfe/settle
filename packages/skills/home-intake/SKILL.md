---
name: home-intake
description: Records the rooms, measurements, windows, doors and belongings of the user's home, from an uploaded floor plan or a room-by-room interview. Use when the user wants to set up their home, add or fix a room or a measurement, ask what is recorded about a room, or tell it about furniture they already own ("add the spare bedroom", "the living room is 4.2 m, not 4"). Not for design advice, colors or shopping; not for buying or evaluating property.
---

# Home Intake

Records or corrects the Active Home's facts, Levels, Rooms, and Inventory, from a Blueprint or by interview. It runs whenever the user wants: to set up the whole Home, or to fix one thing ("we moved the office", "add the bookshelf we forgot"). Home Intake records facts and makes no design Decisions.

## Starting

1. **Check the tools.** Follow "App not running" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "home-intake"`, or join the Session this conversation already has. Name the Home. The Overview's Room lines and their Gaps tell you what the interview still needs.
3. **Read-back.** When the user asks what is recorded, read the relevant Room Sheet or use `find_items` for Inventory. Summarise its recorded facts and Gaps, keeping estimates visibly approximate. Answer without changing the Home's facts or starting the interview. Offer a correction or further intake as an optional next step.
4. **Pick the work.** Handle the fact, correction, or Item the user came with first. For a wider intake, ask what they want help with next if they have not said. Recommend a first Room from the Overview and explain why. Agree this Session's scope; use the Gaps to find missing facts within it.

## Throughout the interview

**Facts along the way.** When the user states a fact about their situation that advice must obey ("we have two cats", "the piano stays where it is", "my grandmother's cabinet stays"), propose it as a Constraint: read the exact wording back and ask. Add it with `set_constraints` only once the user agrees. Softer context ("we might get a dog", "the cat scratches fabric") becomes a Note: save it with `save_note` and say so.

## The interview

Use the stages below for the work agreed for this Session. Begin a new Home with its Level and Room list, recording any Home facts the user gives along the way. Save after every round. Collect the facts that the next task needs first; the remaining stages can wait.

**Enough for now.** After the Room list and each later round, offer to stop when the agreed work is recorded. For Design Direction, prioritise how the Home is used, Constraints, what stays, and the main Rooms' light. For Color, prioritise existing finishes and kept Items, light, and times of use. For a Purchase, prioritise the place it goes, nearby obstacles and Items, and access. Unknowns stay open; the next Skill can ask when an answer matters. Follow "Hand-off and parking" when the user wants to switch now.

1. **Home facts.** The web UI created the Home with its name, country, and city. Ask for what the Overview lacks: the Levels (a new Home has only Ground), Tenure, planned stay, building type and era, whether there is a lift, and the narrowest point on the way in, for getting furniture in. Save them with `save_home`.
   - **Rented Homes.** The reply that records a rented Tenure does two things:
     - It proposes a Constraint, word for word, for each permission the user has already stated, and asks them to agree: "I'd add this Constraint: *Rented: no drilling into the walls*. Agree?"
     - It asks one question about the permissions not yet given: may they paint, drill or hang things on the walls, change light fittings, change the flooring?

     Word each later answer as a Constraint the same way. Add the Constraints with `set_constraints` in one batch, once the user agrees to their wording.
   - Done when the Levels and every Home fact the user knows are saved, and the rented-permissions Constraints are either added with the user's agreement or declined.
2. **Blueprint**, when the Overview lists one. Read it in four stages, in this order, with one reply per Level for each stage: show what you read on that Level's pages, ask the user to confirm or correct it, and save what they confirm before going on. When the user has already agreed to what a stage would propose ("record the rooms with the plan's sizes"), save it in that reply and say what you saved, rather than asking again. For north, follow "Where north is", including when the user has already said to use the arrow. Without a Blueprint, skip to Remaining Gaps; a user who has a plan can upload it on the Home's page in the app.
   - **Fetching pages.** Call `view_images` with the Blueprint's slug and the pages you need: one Level's pages at a time, at most six per call. Its text block, before the images, names each page and its Level once mapped. When a dimension string is too small to read, call it again for that page with `crop` set to the quarter that holds it; never guess a digit.
   - **Pages to Levels.** When the text block gives a page no Level, say which Level you think it shows (from its title, e.g. "GROUND FLOOR") in that Level's Room-list reply. Once the user agrees, record it with `save_home`'s `blueprintPages`, adding the Level first if the Home lacks it. Map every page before reading its dimensions.
   - **Printed text only.** Fill in from the Blueprint only what is printed on it as text: Room labels, dimension strings, and printed figures such as "Ceiling height 2.45 m throughout". Save such a value with `provenance: "blueprint"` and `source: { blueprint, page, printed }`, where `printed` is the figure exactly as the plan prints it: `12'6"`, or `3.62` from *3.62 m x 4.00 m*. Nothing else on the drawing is a Blueprint value: Windows, Doors, and the north arrow are drawn symbols, and a length scaled off the drawing or its scale bar is Estimated. Ask the user for these, or propose them for the user to confirm.
   1. **The Room list.** Every Room the plan labels, as a numbered list with names and functions (see "Rooms"). Apply the Room test to open-plan areas: a kitchen and dining area with no wall between them is one Room, even when the plan labels them separately, and a borderline archway is the user's call. Ask about any space the plan draws but doesn't label. Propose only Rooms supported by the plan. Record a missing Room the user describes as their correction to the plan, without inventing its dimensions or openings. Save the confirmed Rooms with `save_room`.
   2. **Dimensions.** Quote the printed string, identify the Walls its dimensions refer to, and show that mapping for confirmation. Copy a dimension to the opposite Wall only when the Room is rectangular and the drawing supports the same span. If the mapping is unclear, keep the text in a Note and leave the Wall lengths open. Agree Wall 1 as in "Walls". A printed size of a Room that isn't rectangular is its overall extent, not two Wall lengths: ask which Walls it gives. A Room with no printed size keeps its Wall lengths open unless the user supplies them. If the user asks for a scaled estimate, first check that the drawing is to scale and has a usable reference. A not-to-scale or distorted drawing cannot supply that estimate. Explain the basis of a supported estimate, ask the user to confirm saving it, and keep its Provenance Estimated.
   3. **Windows and Doors.** Propose each Window and Door you see drawn: its Room, its Wall, and for a Door the Room on the other side. Save only the openings the user confirms, with a size only when it is printed or the user gives it. Record each Door once (see "Doors").
   4. **Where north is.** Confirm your reading for each page whose orientation you will use, even when several pages show the same Level. Ask as soon as the user brings up north or its arrow. Say which way you read the arrow and name a Wall as a check: "The arrow seems to point to the top of the page, so the Kitchen's window wall would face N. Is that right?" Save facings only after the user confirms that reading, and only for Walls you can map from it. Leave uncertain Walls open. An already-confirmed reading need not be asked again unless the page or its interpretation changes.
   - Done for the agreed scope when its pages are mapped and the Room list, dimensions, openings, and north have been confirmed or left open by the user, with confirmed facts saved. Earlier agreement counts; a separate reply for each stage is not required when its facts are already settled.
3. **Remaining Gaps.** Room by Room, one Room at a time.
   - First the Room list, Level by Level: each Room's name, Level, and functions (see "Rooms"). Save each with `save_room`.
   - Work through the chosen Room's missing facts in the order the next task needs. Record times of use and Items here when they matter now. For an outdoor Room, use "Outdoor Rooms" rather than the indoor checklist.
   - Save after every round. Use the receipt's remaining Gaps to identify missing facts, not as a requirement to ask them all now.
   - **Shared answers.** When the user may have one answer for several Rooms, name those Rooms and ask once, including any exceptions. Apply only what they confirm. A measurement taken in one Room remains Measured there; a value assumed to match in another is Estimated there. Read each existing Room's Sheet before updating it, as in "Keeping context focused".
   - Done when the agreed facts are recorded, or the user chooses to leave the rest for later.
4. **Items.** By interview, Room by Room: the user describes what they own in the Room.
   - Start with the larger Items and the pieces the user says must stay. To jog their memory, offer a short list of categories suited to this Room's uses, including lamps and textiles, and ask what else they own. Treat that list as prompts, not Inventory. Add only Items the user names; keep ownership separate from "it stays", which follows "Facts along the way".
   - Gather it into one numbered list with each Item's name, category, quantity, and whatever else the user gave (where it sits, size, colors, materials, condition). Show the list in one reply and ask the user to confirm or correct it.
   - Call `save_items` only after the user confirms, with exactly the entries they confirmed: their corrections in, what they struck out left out.
   - Done when each Room's list is confirmed and saved, or the user has skipped that Room.
5. **Times of use.** Ask when a Room is mostly used as soon as this matters to the next task. Offer morning, daytime, evening, and night as answer choices, with the recorded times already filled in. Leave unrecorded times blank; Room functions do not tell you the user's routine. For a whole-Home pass, gather the remaining answers in one optional table. Save only what the user answers or confirms; skipped Rooms keep their Gaps.

## Rooms

- **The Room test.** A wall with a doorway divides two Rooms, whether or not a door hangs in it. A missing or partial wall does not, so an open-plan kitchen and living area is one Room, and a borderline archway is the user's call. Hallways, stairs, walk-in closets, utility rooms, and garages are Rooms. A staircase belongs to the Level you enter it from. A built-in cupboard is a Feature. An off-site storage unit is not part of the Home.
- **Functions:** kitchen, dining, living, bedroom, office, bathroom, hallway, stairs, storage, utility, garage, other. A Room may have none yet: choosing a use is a Decision, not a fact to record.
- **Outdoor Rooms.** A balcony you can step onto, a terrace, a patio, or a garden is an outdoor Room. Gardens and patios sit on the ground Level. A railing-only (Juliet) balcony is not a Room: it is a glazed Door to outside. An outdoor Room needs only its floor Surface and times of use, and its Walls are optional.
- **Walls.** Agree with the user which Wall is Wall 1 (the one with the entrance door is a good default), then number the rest clockwise as seen from above: a rectangular Room has 4 Walls, an L-shaped one 6. Wall lengths are the Room's dimensions. The current model assumes square corners. If the user reports a sloping or curved Wall or a non-square corner, save that limitation as a Note and leave unsupported geometry open; this record cannot establish a precise fit there. For a Wall with outside or an outdoor Room beyond it, ask which way it faces (8-point compass) and how much sky it sees (open, partly, or heavily blocked, and whether deciduous trees do the blocking).
- **Windows** sit in a Wall, or in the roof for a skylight.
- **Doors** are named by the Room on the other side, or outside. One Door is shared by the two Rooms it joins, so record it once; `save_room` finds an existing Door between the same two Rooms and says so in its receipt. When two Doors join the same pair of Rooms, keep separate Door slugs and use the Room Sheet or receipts to identify which one you are updating. Ask which opening the user means if it is unclear.
- **Daylight.** A Room's daylight comes from its Windows and from glazed Doors leading outside or onto a balcony, and the record counts both. So a Room whose only glazing is a balcony door is **not** windowless: mark a Room windowless only when it has neither, and the Room Sheet's Daylight line will say where the light comes from. Ask about unknown facing and sky obstruction for any Wall holding one, including balconies or overhangs and nearby buildings. Record the user's observations; windowless does not mean dark. Use the Home's location when explaining why the information matters, without assuming the Room receives direct sun from its facing alone.
- **Features:** radiator or heater, fireplace or chimney breast, built-in storage, fitted kitchen or bathroom units, beam or column, light point or downlight, tiling or panelling, other (with a description). A tiled splashback or panelling is a Feature, not a Surface.
- **Surfaces:** walls, ceiling, floor, and woodwork (skirting, door frames, doors, window frames), each with its material, color, and finish. A feature wall is a whole-Wall exception to the Room's wall Surface. The floor may hold several materials, each with a note of where it is ("tiles, kitchen end").

## Items

- **Categories:** seating, tables, beds, storage, lighting, rugs, textiles (curtains, cushions, throws), art and mirrors, decor, plants, appliances, electronics, outdoor, other.
- An Item is something the user would take with them on moving out. Identical pieces are one Item with a quantity ("six dining chairs").
- An Item in no Room (still boxed, or in off-site storage) is Unplaced: save it without a Room.
- "It stays", about an Item, is a Constraint, proposed as in "Throughout the interview".

## Measurements and Provenance

- Tools take every length in millimetres. Convert what the user says (3.62 m is 3620, 12'6" is 3810) and say values back in the user's own units.
- Record Provenance for each value from how it was obtained. Measured means the user measured that value; Blueprint means text printed on the Blueprint, with its source; a rough, inferred, or scaled value is Estimated. Ask "measured or roughly?" only for values whose source is unclear, grouping the question when they share a source. One answer applies to a batch only when the user says it covers every value in that batch.
- A color is Measured only when identified exactly (a paint code from the tin, or a match against the maker's card); otherwise it is Estimated. Never ask for an LRV.
- A user confirming an Estimated value doesn't make it Measured.
- A value you propose is Estimated, whatever it rests on: a figure scaled off the drawing, a rough reading of the Room, or a typical size for this kind of building. Say which it rests on, and save it only if the user takes it.
- **Measure for the next task.** When placement or delivery is next, ask for the dimensions that could change the fit: the usable Wall, nearby openings and obstacles, sill height, relevant ceiling or beam clearance, and the Item's size. Measure a Window or Door offset from the Wall's start corner to its near edge. For delivery, ask for the Door's clear opening, and the lift door width and car depth when relevant. Record tight turns and other route limits the user describes as Notes when no field fits. A Room with no listed Gaps may still lack these details.
- When a value you save meets a stronger one already recorded, follow "Refused writes".

## Staying in scope

Home Intake records the Home. When the user asks for design advice, colors, or shopping, follow "Hand-off and parking": those belong to other Skills. Whatever is parked goes in the summary, and the interview carries on.

## Intake summary

Follow "Closing" in the Session protocol. Close when the user is done. In `open`, list the Rooms whose Gaps remain; in `next`, suggest the next work the user wants, including another Skill when appropriate. Before suggesting a first Design Direction, call `find_decisions` with `kind: "design-direction"`: if the Home has no Design Direction yet (none, or only Rejected ones), suggest settling it next in Design Direction, naming the Skill, since it fires only when asked for.
