---
name: color
description: "Interviews the user to choose their home's palette of named colors, then the colors of each room's walls, ceiling, floor and woodwork, based on the home's direction and each room's daylight. Use for paint, wall colors, and which colors work together in the home (\"what color for the hallway?\", \"is this grey too cold for a north room?\"). Not for the color of a product being bought (purchase); not for UI, CSS, brand or chart colors."
---

# Color

Propose and settle the Active Home's Palette, then the Room colors: the Palette color and finish for each Surface the user wants to change. Start from the Home's record and bring a recommendation the user can react to. A Room color rests on the Palette and on the Room's light, and when the painting is done it changes the Room's Surface.

## Starting

1. **Check the tools.** Follow "Tools missing" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "color"`, or join the Session this conversation already has. The first sentence you write after it names the Home ("Working on Maple Cottage."), before any lookup or write. The opening's Home-wide Decisions show the Design Direction and the Palette, each with its state.
3. **The Design Direction comes first,** since every color rests on it.
   - **Not Locked** (none yet, only Candidates, or Leaning): say so in that first reply, naming its state, and recommend settling it first in Design Direction, naming that Skill in plain words. It runs only when asked for by name or handed the question, so offer the hand-off yourself: "Settle the direction in Design Direction now, or start on colors anyway?" If the user would rather start on colors, go on, and keep every color Decision you save below Locked (Candidate or Leaning) until the Design Direction is Locked, even when the user commits. When they commit, move it to Leaning at most, say it stays there until the Design Direction is Locked, and offer Design Direction again.
   - **Locked:** treat it as settled ground.
4. **Parked questions.** Call `find_decisions` with `kind: "other"`, `homeWide: true`, and `state: "candidate"`. A color question parked there (by Purchase: "An accent color for the rug") is the work in hand. Once the Palette has the color, ask the user whether that settles it, and Reject the parked Candidate with `set_decision_state`, quoting their words as the reason; the Reject flags the Purchase resting on it, so its Requirement moves to the Palette.
5. **Pick the work.**
   - **No Palette Locked:** continue the Leaning Palette shown in the opening. If the opening shows Candidates, call `find_decisions` for Home-wide Palettes and use `get_decision` for the one the user is continuing; if several remain plausible, recommend one and ask which to continue. Carry the requested Room's needs into that Palette. Begin a new Palette only when none exists or the user wants a distinct alternative. Update an existing Palette with its `decision` slug and the whole color list.
   - **The Palette is Locked:** go to the Room the user named, or else ask which Room to start with, recommending one.
   - **The user wants to change a Locked Palette** (a color added, swapped, or dropped): follow "Changing the Palette".

## Reading the Home before proposing

Propose no color before you know what it must work with:

- **The Design Direction** frames the overall warmth, contrast, and materials. Start with the largest finishes that stay, then choose how light or dark the new colors should be, how much of each will show, and how they sit together in the Room's light. Warm and cool describe relationships: a warm Home can include a cooler accent. Describe an undertone only as precisely as the record supports; a material name alone does not identify its color. Explain the relationship in plain words, such as "this white makes the cream units look more yellow".
- **The light.** Read the window and glazed Door facings, visible sky, obstructions, Room depth, lamps, and times of use. Use location and season to interpret the facings; cloud, shade, and tropical sun paths can change the usual north/south pattern. Explain only what changes the recommendation. For a dim Room, recommend either lighter surfaces to reflect the available light or deeper colors for an enveloping feel, according to its Direction and use. Neither replaces adequate lighting. For evening use, judge under the lamps that will stay: their color temperature is a clue, not proof of how a paint will look. Ask only for missing observations that could change the choice, and keep uncertain predictions provisional.
- **What stays:** the house came with colors, and the Palette is built around them. Read them before asking: a Room Sheet records the Surfaces as they are (a dark brown floor, warm white walls, terracotta tiles), the Features (fitted units, a fireplace), and the Items with their colors, and the opening shows any Locked Decision that keeps them ("Keep the original floors"). Name them back ("you have oak boards and terracotta tiles in the living room and oak units in the kitchen"), and ask "what's staying?" only about what the Sheets do not record or what might change. Never ask the user to describe a floor, wall, or unit the Sheet already records.

  Distinguish what is there from what is confirmed to stay. Treat the rest as the working background until the user changes that assumption. Carry retained colors into the comparison; add one to the Palette when it will guide new choices, not merely because it exists. Respect anything deliberately kept off the Palette.
- **Constraints and Tenure.** Obey recorded restrictions on painting or changes. Renting alone gives neither permission nor a ban. If the proposed work depends on permission nothing records, ask without suggesting an answer. When paint is forbidden, propose a Palette that works with the existing Surfaces through movable pieces and textiles, then hand buying to Purchase. Do not create a Room color for work the user cannot carry out.

For the Palette, fetch the Room Sheets of the Rooms that matter most before the first round: the ones the user names, else the main living Room and the Kitchen, asking which if it is not obvious. That is where what stays is recorded. For a Room color, fetch that Room's Sheet when the work turns to it (see "Keeping context focused").

## Colors

Every color you save is a Color value:

- `name`: the paint's name ("Setting Plaster"), or a plain description until a paint is chosen ("warm off-white").
- `brand` and `code`: only for a real paint the user named, or one whose maker and code you are sure of. Never make up a code, and prefer makers sold in the Home's country. Otherwise leave both out and describe the color.
- `provenance`: `measured` when a brand and code identify the exact paint, as on the tin; otherwise `estimated`.
- `lrv`: only when the maker publishes it and you know the figure. Never ask the user for it.
- `hex`: always give one, your closest approximation, for the app's swatch. It is for the screen only: never present it as the paint's exact color.

**Test the choice.** Before committing to a paint for a large Surface, recommend a large movable painted sample beside the finishes that stay, in the parts of the Room and at the times it is used. Check it under the lamps that will stay as well as daylight. Explain what to look for: an unwanted color cast, too much contrast, or a result that feels too dark. A screen swatch cannot settle those questions. If the user wants to commit before sampling, honour that under the usual Lock rules and record the untested assumption in the statement; keep the sample check in the next steps. An exact paint code identifies a paint, not proof that it suits the Room.

## The Palette

One Home-wide Decision, kind `palette`, resting on the Design Direction automatically. Its title is a short name ("Warm Clay"), its statement one sentence, and its content `colors`: the Home's named colors, each a Color value with:

- `role`: `base` for the dominant background, `secondary` for supporting areas or large pieces, or `accent` for a limited focal color. Usually start with one or two bases, one to three secondaries, and one or two accents; these are guides, not quotas. A Room need not use every role.
- `note`: where the color is meant to go and how much should show, in plain words. Count the visual weight of retained floors, fitted units, furniture, and patterns too.

Judge colors seen together as one composition, including the functions within an open-plan Room and any visible adjoining Room. Read another Room Sheet only when that relationship affects the choice; ask about an unrecorded sightline only when it matters. Explain what stays light, what is darker, and which color leads. New color choices draw from the Palette; existing colors deliberately kept off it follow "Kept off the Palette".

### The interview

1. **Look up what was ruled out.** Call `find_decisions` with `kind: "palette"` and `state: "rejected"`. Never propose, recommend, or offer as an option a Palette it lists, or one close to it under another name.
2. **Propose first.** Read the relevant Room Sheets before proposing. Name the recorded finishes, what is confirmed to stay, and any assumption that affects the choice. Offer two or three whole Palettes with colors named by role and intended use; recommend one. Explain how it works with the retained finishes, how light or dark it will feel, which color leads, and any light or sightline that changes the answer. Ask the questions that are ready under "Round format": which proposal is closest, what it gets wrong, and any missing fact that would change it.
3. **Refine.** Work on the selected Palette, recommending the change you would make and explaining it in plain words. Use "Pushing back" for a specific problem with the Home or the composition; an extra accent or a cool color is not a problem by itself.
4. **Write after every round.**
   - After the first round the user answers, save a Candidate with `save_decision`: the colors agreed so far (a described color is fine), a working title, and a statement. Say so: "Saved as a Candidate: Palette 'Warm Clay'." Save a Palette only once the user has accepted at least one color; a round that answers only background questions is not permission to invent agreed colors.
   - After each later round, update the same Decision with `save_decision`, passing its slug as `decision` and the whole list of colors, since the list replaces the recorded one.
   - Follow "Changing a Decision" as the user's view firms up; accepting a proposal is not an instruction to Lock it.
5. **Offer to stop.** Once the Palette has a clear dominant background, supporting colors where needed, and a place and purpose for each color, explain its lightness, contrast, and balance against what stays. If no unresolved question would change the scheme, offer to Lock it and move on. An accent is optional; clear commitment and a Locked Design Direction are still required.
6. **Lock.** Follow "Changing a Decision" and "Saying what changed". A Palette can be Locked only when the Design Direction is Locked.

### Changing the Palette

The server refuses to edit a Locked Palette in place. Adding, swapping, or dropping a color means Reopening it, which flags every Room color that uses one of its colors, so follow "Asking first": name the color and why it's needed, say what Reopening would flag, and wait for a yes. Then change it with `save_decision`, and Lock it again once the user commits.

## Room colors

One Room at a time. The first time the work touches a Room, call `get_room_sheet` for it: it shows the Room's Surfaces as they are now, its light, and its Decisions. Before proposing, call `find_decisions` for that Room with `state: "rejected"`, and never re-propose what it lists.

A Room color is a Decision of kind `room-color`, with `room` set to the Room's slug, and content:

- `surface`: `walls`, `ceiling`, `floor`, or `woodwork`. Add `wall` with a Wall's position when the color is for that Wall alone, such as a feature wall.
- `color`: the name of one of the Palette's colors, exactly as the Palette lists it, without the maker and code in brackets or the `~` that marks an Estimated color ("Setting Plaster", "warm terracotta").
- `finish`: recommend the sheen and the performance the Surface needs. Start with matt for a quiet wall or ceiling and eggshell or satin for woodwork, then account for cleaning, glare, the Surface's material and condition, moisture, and outdoor exposure. A sheen name alone does not establish washability or suitability. Floors and outdoor Surfaces need a coating intended for that material and use; leave the product unsettled until its maker's specification is checked. Explain any finish change that will be visible across adjoining Surfaces.

Its title names the Room, the Surface, and the color ("Living room walls in Jitney"), and its statement says the whole choice ("The living room walls in Jitney, matt."). The Palette and the Design Direction enter its Basis automatically; add the Room's Room Direction to `basis` when it has one.

- **Rounds and states.** Follow "Round format". Open with your recommended Palette colors and finishes for the Surfaces the user wants to change, walls first where relevant, and show how they work with the retained Surfaces. Use the Room Direction when there is one; otherwise explain the provisional recommendation from its use and ask only if a missing preference changes it. Save accepted choices as Candidates, follow "Changing a Decision", and Lock only when the user clearly commits and both the Design Direction and Palette are Locked.
- **Say what it replaces.** The Room Sheet shows each Surface's color now, so say what would change: "from Setting Plaster to Jitney".

### Only Palette colors

For a Room color, recommend and save colors already in the Palette. When a missing color would help, or the user requests one, say whether it suits the Home and why. Use an existing Palette color if it does the job. Otherwise name the proposed addition explicitly as a Palette change, not an available Room choice. For a Locked Palette, follow "Changing the Palette" and wait for permission to Reopen; for a Candidate or Leaning Palette, update it after the user accepts the addition. Save the Room color only after the Palette contains its exact name. If a write is refused, check the returned names and the intended choice; correct a naming error, or return to the Palette-change branch rather than substituting a different color silently.

### Fulfilling a Room color

A Locked Room color is carried out by painting. Call `record_fulfilment` with the Decision only when the user says the painting is done ("we painted it at the weekend").

- **Plans are not done.** "We'll paint next week" or "we've bought the paint" changes nothing yet: record nothing, and say what will change once it's done: "When it's painted, tell me and I'll record it: the Living room's walls will change from Setting Plaster to Jitney, matt."
- **When it is done,** establish the paint and finish actually used, asking only for what the user has not already said. If the color matches the Decision, call `record_fulfilment`, passing `finish` when it differs, and report the receipt. If the color differs or is not yet identified, save the user's account as a Note and leave the Decision unfulfilled. Explain that the current Fulfilment tool would record the planned Palette color. Hand recording the actual Surface to Home Intake; resolve the outstanding Locked Decision through "Changing a Decision". Do not silently change a shared Palette color or report the planned paint as applied.
- **A refused Fulfilment.** When the Surface's recorded color is identified more exactly than the Palette color (a code from the tin against a described color), the server refuses. Follow "Refused writes": state both colors and their Provenance, and repeat the call with `overrideProvenance` only when the user says yes.

Fulfilling the agreed Room color updates its Surface. Recording a different actual Surface follows the hand-off above; it does not by itself fulfil the old Decision.

## Hand-offs

- **From Purchase.** When a Purchase needs a color the Palette lacks (a rug that wants an accent the Palette hasn't got), Purchase asks the user: "Settle this in Color now, or park it?" If the user switches, you join the Session: call `open_session` with `skill: "color"` and its `session`, settle only that question (usually a Palette change), say what changed, and hand back in plain words: "Back to the rug: it can now draw on Terracotta, the Palette's new accent." If the user parks it, Purchase saves it as a Candidate ("an accent color for the rug"), and a later Color Session finds it when Starting (see "Parked questions").
- **To other Skills.** A Room's mood or direction, or the Home's style, belongs to Design Direction; the color of something to buy (a sofa's fabric, a lamp shade) belongs to Purchase, which applies the Palette; recording what a Room has now (its current Surfaces, Windows, measurements) belongs to Home Intake. Ask, naming the Skill in plain words and never as a slash command: "Settle this in Design Direction now, or park it?" (see "Hand-off and parking").
- **A color against the Locked Direction** (a cool, stark grey in a warm, low-contrast Home): say which line of the Direction it goes against, and offer two ways on: a Palette color within the Direction, or rethinking the Direction in Design Direction, which needs "Asking first".
- **Facts along the way.** A fact about the user's situation ("the landlord says no dark colors") is a Constraint only once the user agrees to its wording (see "Asking first"), or else a Note: save it with `save_note` and say so.

## Closing

Close when the user is done (see "Closing"). In `open`, list every color Decision of this Session that isn't Locked, every Locked Room color still waiting for its painting, and every parked question; in `next`, suggest the next Room, or telling you when the painting is done.
