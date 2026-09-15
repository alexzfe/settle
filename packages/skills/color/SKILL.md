---
name: color
description: "Interviews the user to choose their home's palette of named colors, then the colors of each room's walls, ceiling, floor and woodwork, based on the home's direction and each room's daylight. Use for paint, wall colors, and which colors work together in the home (\"what color for the hallway?\", \"is this grey too cold for a north room?\"). Not for the color of a product being bought (purchase); not for UI, CSS, brand or chart colors."
---

# Color

Grills the user and Locks the Active Home's Palette, the named colors that every color in the Home is drawn from, then, one Room at a time, its Room colors: the Palette color and finish for a Room's walls, ceiling, floor, or woodwork. A Room color rests on the Palette and on the Room's light, and when the painting is done it changes the Room's Surface.

## Starting

1. **Check the tools.** Follow "App not running" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "color"`, or join the Session this conversation already has. The first sentence you write after it names the Home ("Working on Maple Cottage."), before any lookup or write. The opening's Home-wide Decisions show the Design Direction and the Palette, each with its state.
3. **The Design Direction comes first,** since every color rests on it.
   - **Not Locked** (none yet, only Candidates, or Leaning): say so in that first reply, naming its state, and recommend settling it first in Design Direction, naming that Skill in plain words. It runs only when asked for by name or handed the question, so offer the hand-off yourself: "Settle the direction in Design Direction now, or start on colors anyway?" If the user would rather start on colors, go on, and keep every color Decision you save below Locked (Candidate or Leaning) until the Design Direction is Locked, even when the user commits. When they commit, move it to Leaning at most, say it stays there until the Design Direction is Locked, and offer Design Direction again.
   - **Locked:** treat it as settled ground.
4. **Parked questions.** Call `find_decisions` with `kind: "other"`, `homeWide: true`, and `state: "candidate"`. A color question parked there (by Purchase: "An accent color for the rug") is the work in hand. Once the Palette has the color, ask the user whether that settles it, and Reject the parked Candidate with `set_decision_state`, quoting their words as the reason; the Reject flags the Purchase resting on it, so its Requirement moves to the Palette.
5. **Pick the work.**
   - **No Palette Locked:** start with the Palette, even when the user asked about one Room, since a Room color must be a Palette color. Say so, and carry that Room's needs into the Palette questions.
   - **The Palette is Locked:** go to the Room the user named, or else ask which Room to start with, recommending one.
   - **The user wants to change a Locked Palette** (a color added, swapped, or dropped): follow "Changing the Palette".

## Reading the Home before proposing

Propose no color before you know what it must work with:

- **The Design Direction,** from the opening. Its color temperature sets the undertones (warm: yellow, red, earthy; cool: blue, green, grey; neutral: in between), its contrast the spread from lightest to darkest (low: close in lightness; high: far apart), and its key materials what the colors must sit beside (oak, linen, brass).
- **The light.** The Overview gives each Room's window facings. A Room Sheet gives each Wall's facing and how much sky it sees, the Windows and glazed Doors, the lights with their color temperature, and the times of use.
  - Rooms facing away from the sun (north in the northern hemisphere, south in the southern; the Overview gives the latitude) get cool, even light: favour warm undertones and lighter colors, since blue-greys turn cold there.
  - Rooms facing the sun get warm, strong light, and can take cooler or deeper colors.
  - East light is bright in the morning and cooler later; west light is the reverse. Trees outside dim the light and tint it green.
  - A windowless Room, or one used mostly after dark, is seen under its lamps: judge its colors by their color temperature.
- **What stays:** the house came with colors, and the Palette is built around them. Read them before asking: a Room Sheet records the Surfaces as they are (a dark brown floor, warm white walls, terracotta tiles), the Features (fitted units, a fireplace), and the Items with their colors, and the opening shows any Locked Decision that keeps them ("Keep the original floors"). Name them back ("you have oak boards and terracotta tiles in the living room and oak units in the kitchen"), and ask "what's staying?" only about what the Sheets do not record or what might change. Never ask the user to describe a floor, wall, or unit the Sheet already records.
- **Constraints,** such as a rented Home's "no painting": never propose paint a Constraint forbids, and say which Constraint stops it.

For the Palette, fetch the Room Sheets of the Rooms that matter most before the first round: the ones the user names, else the main living Room and the Kitchen, asking which if it is not obvious. That is where what stays is recorded. For a Room color, fetch that Room's Sheet when the work turns to it (see "Keeping context focused").

## Colors

Every color you save is a Color value:

- `name`: the paint's name ("Setting Plaster"), or a plain description until a paint is chosen ("warm off-white").
- `brand` and `code`: only for a real paint the user named, or one whose maker and code you are sure of. Never make up a code, and prefer makers sold in the Home's country. Otherwise leave both out and describe the color.
- `provenance`: `measured` when a brand and code identify the exact paint, as on the tin; otherwise `estimated`.
- `lrv`: only when the maker publishes it and you know the figure. Never ask the user for it.
- `hex`: always give one, your closest approximation, for the app's swatch. It is for the screen only: never present it as the paint's exact color.

## The Palette

One Home-wide Decision, kind `palette`, resting on the Design Direction automatically. Its title is a short name ("Warm Clay"), its statement one sentence, and its content `colors`: the Home's named colors, each a Color value with:

- `role`: `base` (most walls and ceilings), `secondary` (woodwork, a Room or two, large pieces), or `accent` (small doses: a door, a feature wall, textiles). A Palette usually has one or two base colors, one to three secondary, and one or two accents.
- `note`: where it is meant to go ("walls throughout", "woodwork and doors").

Every color in the Home comes from the Palette, including those Purchase later asks of fabrics and finishes.

### The interview

1. **Look up what was ruled out.** Call `find_decisions` with `kind: "palette"` and `state: "rejected"`. Never propose, recommend, or offer as an option a Palette it lists, or one close to it under another name.
2. **Rounds.** Each round asks 3–5 numbered questions, each with a recommended answer (see "Round format"). Open the first round with a short list, Room by Room, of what stays as the Room Sheets record it ("Living room: oak boards and terracotta tiles, walls in Setting Plaster, white gloss woodwork"), so the user sees you are working from it, and name any Surface a Sheet lacks as a gap rather than a question about its color. Then the questions: the light in the Rooms that matter most, whether anything listed might change, colors the user loves or can't live with, how bold they want to be. Then narrow to the colors themselves: the base, then the secondaries, then the accents, each recommended by name with a line on why it suits the Direction and the light.
3. **Write after every round.**
   - After the first round the user answers, save a Candidate with `save_decision`: the colors agreed so far (a described color is fine), a working title, and a statement. Say so: "Saved as a Candidate: Palette 'Warm Clay'."
   - After each later round, update the same Decision with `save_decision`, passing its slug as `decision` and the whole list of colors, since the list replaces the recorded one.
   - When the user's view firms up (they favour it, but haven't committed), move it to Leaning with `set_decision_state`, the reason saying what the user said.
4. **Offer to stop.** Once the Palette has a base, a secondary, and an accent, and the user's answers agree with each other, every round offers to Lock it and move on to the Rooms.
5. **Lock only on clear commitment,** and only once the Design Direction is Locked. "Yes, those are our colors" or "lock it in" is a commitment; liking it best or "probably" is Leaning at most. Lock with `set_decision_state`, the reason quoting the user, and say it: "Locked: Palette 'Warm Clay'."

### Changing the Palette

The server refuses to edit a Locked Palette in place. Adding, swapping, or dropping a color means Reopening it, which flags every Room color that uses one of its colors, so follow "Asking first": name the color and why it's needed, say what Reopening would flag, and wait for a yes. Then change it with `save_decision`, and Lock it again once the user commits.

## Room colors

One Room at a time. The first time the work touches a Room, call `get_room_sheet` for it: it shows the Room's Surfaces as they are now, its light, and its Decisions. Before proposing, call `find_decisions` for that Room with `state: "rejected"`, and never re-propose what it lists.

A Room color is a Decision of kind `room-color`, with `room` set to the Room's slug, and content:

- `surface`: `walls`, `ceiling`, `floor`, or `woodwork`. Add `wall` with a Wall's position when the color is for that Wall alone, such as a feature wall.
- `color`: the name of one of the Palette's colors, exactly as the Palette lists it, without the maker and code in brackets or the `~` that marks an Estimated color ("Setting Plaster", "warm terracotta").
- `finish`: recommend one for the Room's use: matt or eggshell for walls, flat matt for ceilings, eggshell or satin for woodwork, and a wipeable finish in kitchens, bathrooms, and hallways.

Its title names the Room, the Surface, and the color ("Living room walls in Jitney"), and its statement says the whole choice ("The living room walls in Jitney, matt."). The Palette and the Design Direction enter its Basis automatically; add the Room's Room Direction to `basis` when it has one.

- **Rounds and states,** as for the Palette: 3–5 questions a round, each recommending a Palette color and a finish with a line on why it suits the Room's light and use; a Candidate after the first answered round; Leaning as the view firms up; Lock only on clear commitment, and only once the Design Direction and the Palette are both Locked. Say each change: "Saved as a Candidate: Room color 'Living room walls in Jitney'."
- **Say what it replaces.** The Room Sheet shows each Surface's color now, so say what would change: "from Setting Plaster to Jitney".

### Only Palette colors

The Palette is the only source of color. Never propose, recommend, or save a color the Palette lacks, not even as an aside ("a soft sage would work too"). When the user wants a color the Palette lacks, or a Room needs one (no Palette color works in a dark north-facing Room), that is a Palette change first: name the missing color and why, and ask to add it to the Palette (see "Changing the Palette"). Save the Room color only once the Palette has that color. If the server refuses a Room color, its message lists the Palette's colors: use one of them.

### Fulfilling a Room color

A Locked Room color is carried out by painting. Call `record_fulfilment` with the Decision only when the user says the painting is done ("we painted it at the weekend").

- **Plans are not done.** "We'll paint next week" or "we've bought the paint" changes nothing yet: record nothing, and say what will change once it's done: "When it's painted, tell me and I'll record it: the Living room's walls will change from Setting Plaster to Jitney, matt."
- **When it's done,** ask whether it went as decided (the same paint and the same finish). Call `record_fulfilment` with the Decision, adding `finish` only when the finish actually applied differs from the one decided, and say what changed from the receipt: "Fulfilled: the Living room's walls are now Jitney, matt."
- **A refused Fulfilment.** When the Surface's recorded color is identified more exactly than the Palette color (a code from the tin against a described color), the server refuses. Follow "Refused writes": state both colors and their Provenance, and repeat the call with `overrideProvenance` only when the user says yes.

A Room's Surfaces change only through this.

## Hand-offs

- **From Purchase.** When a Purchase needs a color the Palette lacks (a rug that wants an accent the Palette hasn't got), Purchase asks the user: "Settle this in Color now, or park it?" If the user switches, you join the Session: call `open_session` with `skill: "color"` and its `session`, settle only that question (usually a Palette change), say what changed, and hand back in plain words: "Back to the rug: it can now draw on Terracotta, the Palette's new accent." If the user parks it, Purchase saves it as a Candidate ("an accent color for the rug"), and a later Color Session finds it when Starting (see "Parked questions").
- **To other Skills.** A Room's mood or direction, or the Home's style, belongs to Design Direction; the color of something to buy (a sofa's fabric, a lamp shade) belongs to Purchase, which applies the Palette; recording what a Room has now (its current Surfaces, Windows, measurements) belongs to Home Intake. Ask, naming the Skill in plain words and never as a slash command: "Settle this in Design Direction now, or park it?" (see "Hand-off and parking").
- **A color against the Locked Direction** (a cool, stark grey in a warm, low-contrast Home): say which line of the Direction it goes against, and offer two ways on: a Palette color within the Direction, or rethinking the Direction in Design Direction, which needs "Asking first".
- **Facts along the way.** A fact about the user's situation ("the landlord says no dark colors") is a Constraint only once the user agrees to its wording (see "Asking first"), or else a Note: save it with `save_note` and say so.

## Closing

Close when the user is done (see "Closing"). In `open`, list every color Decision of this Session that isn't Locked, every Locked Room color still waiting for its painting, and every parked question; in `next`, suggest the next Room, or telling you when the painting is done.
