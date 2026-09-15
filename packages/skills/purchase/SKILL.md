---
name: purchase
description: "Interviews the user about something to buy for their home, turns the answers into must and prefer requirements traced to the rooms and earlier decisions, and writes a quick guide for the shop and a full guide to read ahead. Also checks product links against the requirements and records what was actually bought. Use for buying, replacing or choosing furniture, lamps, rugs, textiles or decor (\"I need a new sofa\", \"is this rug right for the living room?\", \"I bought the chair\"). Not for property."
---

# Purchase

Owns the whole life of a Purchase Decision for the Active Home: grilling the user about something to buy, writing its Requirements, each `must` or `prefer` with a reason pointing at the record it comes from, writing the Quick Guide and the Full Guide, checking any Listing the user brings against every Requirement, and recording what was actually bought, with any Deviations. It applies the Palette but never extends it. A lamp takes a round or two; a sofa or a bed takes more.

## Starting

1. **Check the tools.** Follow "App not running" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "purchase"`, or join the Session this conversation already has. The first sentence you write after it names the Home ("Working on Maple Cottage."), before any lookup or write. The opening's Home-wide Decisions show the Design Direction and the Palette, each with its state.
3. **The Design Direction.** When it isn't Locked, say so in that first reply, naming its state, since every Requirement about style, material, or color rests on it. Offer Design Direction by name ("Settle the direction in Design Direction now, or carry on with the rug?"), and carry on if the user would rather.
4. **Find the Decision.** The user may be carrying on with a Purchase already recorded: the opening's flags, the Room Sheet's Decisions, or `find_decisions` with `kind: "purchase"` show it. Work on that one, reading it with `get_decision` (its Requirements by position, Guides, and Listings), rather than creating a second. Otherwise the work is a new Purchase, a Listing to check, or something bought.

## Reading the Home before proposing

Propose no Requirement before reading what it would rest on:

- **The Room.** Call `get_room_sheet` for the Room the thing is for, once, the first time the work touches it: its Walls and their lengths, Windows and sills, Doors and their clear widths, Features (a radiator, a fireplace), Surfaces, lights, the Items already there, and its Decisions (a Room Direction, other Purchases). When the Room isn't clear, ask which Room it will live in.
- **The Palette and the Design Direction,** from the opening: the Palette's colors with their roles and notes, and the Direction's temperature, contrast, key materials, and principles.
- **Constraints,** from the opening (two cats, a rented Home's no drilling), and the **Notes** that bear on the thing: call `search_notes` with a word or two ("sofa", "cat").
- **What was ruled out.** Call `find_decisions` with `kind: "purchase"`, `state: "rejected"`, and the Room (or `homeWide: true` for a Home-wide Purchase). Never propose, recommend, or offer as an option a Purchase it lists, or one close to it under another name.
- **Items elsewhere.** When the thing replaces or goes with an Item in another Room or Unplaced, find it with `find_items`, not more Room Sheets.

In the Overview and a Room Sheet, a value with `~` before it is Estimated ("~3.70 m"), a `?` or a missing value is unrecorded, and any other value is Measured or printed on a Blueprint.

## The Purchase Decision

A Decision of kind `purchase`, with `room` set to the Room's slug, or Home-wide when it belongs to no one Room. Its title names the thing, with its Room when that helps ("Living room rug"); its statement says the whole choice in one line ("A large wool rug under the sofa, replacing the jute one."). It has no content: leave `content` out. Add the Room Direction, and any other Decision it rests on, to `basis`; the Design Direction joins automatically, and so does the Palette once a Requirement's reason is the Palette.

## Requirements

Each Requirement is one attribute in plain words ("at most 2.10 m wide", "a washable cover", "in Jitney, or close to it"), with:

- `strength`: `must` when the thing would be wrong without it (it wouldn't fit, get in, survive the cats, or suit a Locked Decision); `prefer` when it is better with it but still a good buy without it.
- `reason`: the record it comes from, never your own taste. Point at the narrowest record, and name the `field` when one field of it is what matters:

| It comes from | `reason` |
|---|---|
| The Palette, for any color | `kind: "decision"`, the Palette's slug |
| The Design Direction or a Room Direction, for a material, mood, or style | `kind: "decision"`, its slug |
| A Constraint ("Two cats") | `kind: "constraint"`, its slug |
| A Note | `kind: "note"`, its slug |
| The Home's way in | `kind: "home"`, with `field: "accessWidth"`, `"liftDoorWidth"`, or `"liftCarDepth"` |
| A Wall's length, a Window's sill, a Door's clear width, a Feature's size | `kind: "wall"`, `"window"`, `"door"`, or `"feature"`, its slug, and the field (`"length"`, `"sillHeight"`, `"clearWidth"`, `"height"`) |
| A Room's ceiling height | `kind: "room"`, its slug, `field: "ceilingHeight"` |
| A Surface ("living-room/floor") | `kind: "surface"`, its slug |
| An Item it goes with or replaces | `kind: "item"`, its slug, and the field when one matters (`"height"`) |

Prefer a recorded part whenever one explains the Requirement: a shallow cabinet that keeps a narrow Hallway passable rests on the Hallway, not on a Note. Only when a Requirement rests on nothing recorded, just a wish or fact the user stated ("we want to lie full length on it"), save that fact with `save_note` first, say so, and point the reason at the Note.

Save Requirements with `save_decision`, in `requirements`: each new one with `text`, `strength`, and `reason`; an existing one changed by its `position`, or dropped with its `position` and `archive: true`. A Requirement keeps its position for life: the Guides, Listing checks, and Deviations refer to it by that number. The receipt lists each Requirement with its reason.

**Say where each comes from.** Whenever you propose or save Requirements, list them `must` first, each with its source in plain words: "must: at most 2.10 m wide, from the living room's Wall 2 (2.10 m)", "prefer: warm terracotta, the Palette's accent".

### Sizes and access

Until there is a Skill for placing furniture, derive sizes and clearances from the Room: the Wall or alcove the thing stands against, a sill it sits under, a radiator it must clear, a Door's swing, the ceiling height for anything tall, and the Items it sits with (a coffee table about as high as the sofa's seat). Until there is a Skill for lighting, you also cover lamps and bulbs: color temperature and dimming from the Direction and the Room's lights, and brightness for the Room's use.

- **Access.** For anything large (a sofa, a bed, a wardrobe, a big table, anything carried in whole), add a `must` delivery Requirement from the narrowest point on the way in: the Overview's narrowest access, the lift's door width and car depth when there is a lift, and the clear width of the Room's own Door. Take the narrowest, say which it is, and point the reason at that record and field ("must: goes through 0.76 m, the front door", reason `home`, `accessWidth`). When that point isn't recorded, still add the `must`, pointing at the record and field that would hold it ("must: goes through the narrowest point on the way in", reason `home`, `accessWidth`).
- **Measure first.** A `must` resting on an Estimated value (`~`) is only as good as the guess, and one resting on an unrecorded value has nothing under it yet. For each, the Quick Guide puts a "Measure first" line at its top by itself ("Measure first: hallway/wall-4 length (~1.20 m)"). Every reply that saves such a `must` says so, naming the value, and in the same breath offers to record the real measurement: "Measure first: the alcove is only estimated, at ~1.20 m. Measure it and tell me, and I'll record it." Telling the user to measure is not enough on its own: always offer to record what they measure. Never write a Measure-first line into the Quick Guide's own lines.
- **Recording a measurement.** When the user gives one they measured, record it as Measured: the Home's way in with `save_home` (`accessWidth` with `accessNote`, or the lift's), a Wall, Door, or Window with `save_room`. Say what changed from the receipt, then change any Requirement whose text quoted the old value. On a Locked Purchase, changing a Requirement means Reopening it first: follow "Asking first". Record nothing the user hasn't measured.

### Colors

The Palette is the only source of color: Purchase applies it and never extends it.

- The color of a fabric, finish, or shade is a Requirement naming a Palette color exactly as the Palette lists it, without the maker and code or the `~` ("in Jitney, or close to it"), with the Palette as its reason. Make it a `must` when the color is the point of the piece, else a `prefer`, since fabrics rarely match paint exactly.
- Never propose, recommend, or save a color the Palette lacks, not even as an aside.
- **A color the Palette lacks** (the user wants a green rug and the Palette has no green, or no Palette color suits the piece) is a question for Color, as is any color at all when there is no Palette yet. Save no Palette change yourself. Name the missing color and why it's needed, and ask: "Settle this in Color now, or park it?", recommending Color (see "Hand-off and parking"). If the user parks it, save the parked question as a Candidate with `save_decision` (kind `other`, Home-wide, e.g. "An accent color for the rug"), say so, point the color Requirement's reason at that Decision instead of the Palette, and add that Decision to the Purchase's `basis`.
- **Kept off the Palette** on purpose ("this poster stays"): see "Kept off the Palette" in the Session protocol.

## The interview

1. **Rounds.** Each round asks 3–5 numbered questions, each with a recommended answer drawn from the Home (see "Round format"). Open the first round with what you read: the space the thing goes in, what is around it, and the Palette colors and Direction lines that apply ("Wall 6 is 3.90 m and the sofa on it is 2.10 m wide; the Palette's Jitney and warm terracotta suit a rug"). Then ask only what the record can't answer: what it's for and who uses it, what's wrong with the one it replaces, the budget, anything the user loves or can't stand.
2. **Write after every round.** After the first round the user answers, save a Candidate Purchase with `save_decision` holding the Requirements agreed so far, and say so: "Saved as a Candidate: Purchase 'Living room rug', with 3 Requirements." After each later round, add or change Requirements by position. When the user favours it but hasn't committed, move it to Leaning with `set_decision_state`.
3. **Offer to stop.** Once the Requirements cover size and access, material, color, and use, every round offers to write the Guides and stop there.
4. **Lock only on clear commitment** ("yes, that's what we'll buy", "lock it in"). A Locked Purchase goes on the Shopping List. Lock with `set_decision_state`, the reason quoting the user, and say it: "Locked: Purchase 'Living room rug'."

## The Guides

Write both Guides with `save_guides` once the user agrees the Requirements, whether or not the Purchase is Locked, and again whenever a Requirement changes afterwards, since that marks the Full Guide out of date. Say so: "Saved the Quick Guide and the Full Guide for 'Living room rug'."

- **The Quick Guide** fits one phone screen, for use in the shop. The app builds it from the Requirements (the Measure-first lines, then the `must`s, then the `prefer`s), so it can't go stale. You write only its own lines, in `quickLines`: at most eight short ones suited to the product, things to avoid and tests to do in the shop ("Avoid loop pile: claws catch in it", "Hold it next to the Jitney swatch in daylight"). Never repeat a Requirement or a Measure-first line there.
- **The Full Guide,** in `fullGuide`, is Markdown to read ahead of time, under headings you pick for the product (a sofa: size and access, frame and seat, cover, color; a lamp: light, shade, placement). **Every `must` explains why:** name it, say why the thing would be wrong without it, and name the record it comes from ("At most 2.10 m wide: it stands on Wall 2, which is 2.10 m, and anything wider blocks the door"). A `prefer` may explain in a line. Say what to look for when no exact match exists, and how to weigh the likely trade-offs.
- To read or revise a Full Guide already written, call `get_decision` with `includeFullGuide: true`.
- **Taking it to the shop.** When the user is about to go, say how the Quick Guide gets onto their phone, from the `Phone:` line `get_decision` gives for the Purchase: with a LAN address, open the Purchase's page in the app and scan the QR code, or type that address on the phone; without one, the app has to be started with `IDH_LAN=1` first, or the page opens on this computer. Then give the guide's gist in a few lines. Never paste the whole Quick Guide or Full Guide into the reply as a substitute for the page.

## Checking a Listing

When the user brings a specific product (a link, a pasted description, a label's details), check it against every Requirement of the Purchase, from what the Listing states:

- `pass` when the Listing shows the Requirement is met, `fail` when it shows it isn't, and `unknown` when it doesn't say. Never pass a guess: a depth the Listing leaves out is `unknown`, and a color judged from a photo is `unknown` with a note.
- Record it with `record_listing`: its `name`, `url`, `price` with the currency, `dimensions` as stated (whole millimetres), and `checks`, one for every Requirement by its position, each with its `result` and a short `note`. To re-check a Listing already recorded, pass its slug as `listing`.
- Say the verdict plainly, from the receipt: any failed `must` rules it out ("It fails a must: 2.30 m wide, and Wall 2 is 2.10 m"); each `unknown` becomes what to ask the seller or check in the shop; then the `prefer`s.
- A Listing never changes the Decision's state by itself. The user saying "that's the one we'll buy" is a commitment: Lock as in "The interview".

## Fulfilment

A Locked Purchase is Fulfilled when the thing is bought. Call `record_fulfilment` only when the user says it is bought ("I bought the chair", "the rug arrived"). A plan is not a purchase: "we're ordering it tomorrow" or "it's in the basket" changes nothing yet, so record nothing and say what you will record once it's bought.

- **Not Locked yet:** buying it is a clear commitment. Lock it with `set_decision_state`, the user's words as the reason, say so, then record the Fulfilment.
- **Ask what was actually bought,** in one round: its name, dimensions, colors and materials, price, and link, and whether it replaces an Item (sold, given away, thrown out) or a Feature. Then compare it with every Requirement.
- **Name each Deviation:** every Requirement the thing doesn't meet, and the difference ("88 cm tall, not under 85 cm"). Ask in the same round why they took it anyway ("only size in stock", "over budget, but the last one") and keep their words as the Deviation's `reason`; a compromise with its reason reads as a considered one later. Before recording, say that a Deviation from a `must` flags every Decision resting on this Purchase.
- Call `record_fulfilment` with the Decision and:
  - `bought`: what was bought, in one line ("Hay Plain rug, 200 × 300 cm, rust, £450");
  - `deviations`: each with the Requirement's `requirement` position, the difference as `text`, and the user's `reason` when they gave one;
  - `item`: the new Item, with its name, category, sizes, colors, materials, brand, price, and link, in the Purchase's Room unless the user says otherwise (`room`, or `unplaced: true` while it's boxed), plus `replacesItem` with the slug of the Item it replaces, which is Archived;
  - or, for a part of the building (a radiator, a light point), `feature` instead of `item`, and `replacesFeature`.
- Say what changed from the receipt, naming every Decision it flagged: "Fulfilled: Purchase 'Living room rug'. Added the Wool rug to the Living room; the jute rug is Archived."

## Flags

A Purchase is flagged when a value one of its Requirements points at changes (a Wall re-measured, a Door widened), or when a Decision in its Basis is Reopened, Rejected, or Fulfilled with a Deviation from a `must`. Mention flags at opening as the protocol says; when the user works on a flagged Purchase, say what changed underneath it and which Requirements rest on it, and ask: keep it, change the Requirements, reopen it, or reject it (see "Changing a Decision"). On a Locked Purchase, changing a Requirement means Reopening it first: follow "Asking first". After changed Requirements, rewrite the Guides.

## Hand-offs

- **Color,** for a color the Palette lacks: see "Colors". When Color hands back, carry on where you left off, and point the color Requirement at the Palette's new color.
- **Design Direction,** for a Room's direction or use, or the Home's style; **Home Intake,** for a Room or Items not yet recorded. Ask, naming the Skill in plain words and never as a slash command: "Settle this in Design Direction now, or park it?" (see "Hand-off and parking"). A single measurement is yours to record (see "Sizes and access").
- **Facts along the way.** A fact about the user's situation ("the dog sleeps on the sofa") is a Constraint only once the user agrees to its wording (see "Asking first"), or else a Note: save it with `save_note` and say so. A Requirement can then rest on it.

## Closing

Close when the user is done (see "Closing"). In `open`, list every Purchase of this Session that isn't Locked, every Locked one not yet bought, every Measure-first line still waiting for a measurement, and every parked question; in `next`, suggest taking the Quick Guide shopping, telling you what was bought, or the next thing to buy.
