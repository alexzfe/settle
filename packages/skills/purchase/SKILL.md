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
5. **Choose the path.** For a new choice, use the interview. For a Listing without a Purchase, read the relevant Home records, propose the Requirements needed to judge it, and save the agreed ones as a Candidate before recording checks. The Listing's features are evidence to check, not Requirements to copy. For something already bought without a Purchase, record the user's actual choice as a Candidate, with only Requirements supported by prior records or confirmed by the user. Say which expectations were already settled and which are being assessed now. Then use Fulfilment; buying is the commitment to Lock. Ask only for missing details needed for that path.

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

Each Requirement is one attribute, with:

- `text`: a check to read at a glance in the shop, since the Quick Guide shows it word for word. Write a fragment, numbers first, in under about eight words ("At most 2.10 m wide", "Washable cover", "In Jitney, or close to it", "Hem clears the floor by 1 cm"). Leave out the reasoning: the `reason` carries the source, and the Full Guide explains it. Not "softens the afternoon glare through the west glass door (the solar film does most of the heat work)", but "Semi-sheer — softens west-door glare". This is about voice, not a length limit: a check that needs ten words keeps them.
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

**Explain a derived Requirement.** Its reason names the recorded fact that most directly constrains it. In the Full Guide, name any other facts it depends on and explain your calculation or design allowance. Distinguish recorded facts, the user's agreed needs, and your recommendation. A source link is not proof of the conclusion. When the user changes a contributing fact during the Session, review the affected Requirements even if no flag appears. Do not promise automatic flags for facts the reason does not reference.

Save Requirements with `save_decision`, in `requirements`: each new one with `text`, `strength`, and `reason`; an existing one changed by its `position`, or dropped with its `position` and `archive: true`. A Requirement keeps its position for life: the Guides, Listing checks, and Deviations refer to it by that number. The receipt lists each Requirement with its reason.

**Say where each comes from.** Whenever you propose or save Requirements, list them `must` first, each with its source in plain words: "must: at most 2.10 m wide, from the living room's Wall 2, whose usable run is 2.30 m", "prefer: warm terracotta, the Palette's accent".

**Too many musts.** Past about eight `must`s on one Purchase, say so in the reply that saves or lists them: that many non-negotiables for one curtain or one lamp usually means some are really preferences, or two things are being bought as one. Offer both ways out, with your recommendation: demote to `prefer` the ones it would still be a good buy without (name them), or split the Purchase in two (the curtain and its track). Change nothing until the user chooses. The Quick Guide shows every `must` however many there are, so this is settled in the conversation, never by leaving musts out.

**Prose Requirements.** When a Purchase you work on has Requirement text written as a sentence rather than a check, offer to rewrite it shop-first, by position and keeping its meaning, then rewrite the Guides. On a Locked Purchase, that change follows "Asking first" like any other.

**Performance before a material name.** Say what the piece has to do for the household: support the way they sit, clean up as they need, resist the wear they describe, or suit the exposure where it will live. Ask only what the record leaves open. Make a particular material a `must` only when a settled choice or a necessary property requires it; otherwise recommend it as a `prefer` and explain acceptable alternatives. A fiber name alone proves neither durability nor easy care. For an outdoor piece, check the recorded exposure and ask about any missing shelter, storage, or maintenance facts that change the choice.

### Sizes and access

Until there is a Skill for placing furniture, derive sizes and clearances from the Room: the Wall or alcove the thing stands against, a sill it sits under, a radiator it must clear, a Door's swing, the ceiling height for anything tall, and the Items it sits with (a coffee table about as high as the sofa's seat).

- **Usable size.** Recommend a size or range for the piece in use, not just against the Wall. Check its depth and height as well as width, the Items beside it, opened doors or drawers, pulled-out chairs, and the route people need through the Room. In a Room with several functions, check the route between them. Show the short calculation behind a numerical limit, naming what is recorded and what you have allowed for use. A rule of thumb is a proposed allowance, not a measured fact. When position, swing, or a needed dimension is missing, say which check remains open and ask for that fact before presenting a precise limit as settled. For a rug, state which dimension runs across the furniture and calculate the exposed border.
- **Access.** For anything large (a sofa, a bed, a wardrobe, a big table, anything carried in whole), add a `must` that its delivery pieces fit the whole route into the Room. Read the Home's access, lift dimensions when there is a lift, and the Room's Door. Name the known limiting point and use that record and field as the reason ("must: goes through 0.76 m, the front door", reason `home`, `accessWidth`). Compare the seller's packed sizes, or confirmed sizes after removable parts are taken off, with the openings and the space to turn beyond them. Door width and lift depth are separate checks. Ask only for missing route dimensions that could change the choice, and offer to record measurements. When no access is recorded, use `home`, `accessWidth` as the reason and keep the Requirement provisional. A Listing's delivery check stays `unknown` until there is enough evidence for the whole route; ask the seller or delivery team to confirm any unresolved turn or handling question.
- **Measure first.** A `must` resting on an Estimated value (`~`) is only as good as the guess, and one resting on an unrecorded value has nothing under it yet. For each, the Quick Guide puts a "Measure first" line above the musts, by itself ("Measure first: hallway/wall-4 length (~1.20 m)"). Every reply that saves such a `must` says so, naming the value, and in the same breath offers to record the real measurement: "Measure first: the alcove is only estimated, at ~1.20 m. Measure it and tell me, and I'll record it." Telling the user to measure is not enough on its own: always offer to record what they measure. Never write a Measure-first line into the Quick Guide's own lines.
- **Recording a measurement.** When the user gives one they measured, record it as Measured: the Home's way in with `save_home` (`accessWidth` with `accessNote`, or the lift's), a Wall, Door, or Window with `save_room`. Say what changed from the receipt, then change any Requirement whose text quoted the old value. On a Locked Purchase, changing a Requirement means Reopening it first: follow "Asking first". Record nothing the user hasn't measured.

### Lamps and bulbs

Until there is a Skill for lighting, you also cover lamps and bulbs: color temperature and dimming from the Direction and the Room's lights, and brightness for the Room's use.

### Colors

The Palette is the only source of color: Purchase applies it and never extends it.

- The color of a fabric, finish, or shade is a Requirement naming a Palette color exactly as the Palette lists it, without the maker and code or the `~` ("in Jitney, or close to it"), with the Palette as its reason. Make it a `must` when the color is the point of the piece, else a `prefer`, since fabrics rarely match paint exactly.
- **Apply the color to the piece.** Keep the Palette's exact name in the Requirement, and explain in the Guide how its role, lightness, and contrast work at this piece's size beside what stays. Include pattern and sheen when they change that effect. Recommend a physical sample beside the relevant finishes, in the Room's daylight and the light used at night. A seller's color name or a photo does not establish a close match. If an existing Palette color works better, recommend it and say why; changing the Palette still belongs to Color.
- Never propose, recommend, or save a color the Palette lacks, not even as an aside.
- **A color the Palette lacks** (the user wants a green rug and the Palette has no green, or no Palette color suits the piece) is a question for Color, as is any color at all when there is no Palette yet. Save no Palette change yourself. Name the missing color and why it's needed, and ask: "Settle this in Color now, or park it?", recommending Color (see "Hand-off and parking"). If the user parks it, save the parked question as a Candidate with `save_decision` (kind `other`, Home-wide, e.g. "An accent color for the rug"), say so, point the color Requirement's reason at that Decision instead of the Palette, and add that Decision to the Purchase's `basis`.
- **Kept off the Palette** on purpose ("this poster stays"): see "Kept off the Palette" in the Session protocol.

## The interview

1. **Rounds.** Each round asks the questions that are ready, each with a recommended answer drawn from the Home (see "Round format"). Open the first round with what you read: the space the thing goes in, what is around it, and the Palette colors and Direction lines that apply ("Wall 6 is 3.90 m and the sofa on it is 2.10 m wide; the Palette's Jitney and warm terracotta suit a rug"). Then say in a line what you would buy ("a three-seater about 2.10 m wide, tight back, in a tightly woven wool, on oak legs"), and state what follows from the record as proposed Requirements rather than questions ("must: goes through 0.76 m, the front door"). Then ask only what the record can't answer: what it's for and who uses it, what's wrong with the one it replaces, the budget, anything the user loves or can't stand. When a wish works against a Constraint, the Room, the Direction, or the Palette (loop pile with two cats, a 2.40 m sofa on a wall that takes 2.20 m), push back (see "Pushing back") and say what you would buy instead.
2. **Write after every round.** After the first round the user answers, save a Candidate Purchase with `save_decision` holding the Requirements agreed so far, and say so: "Saved as a Candidate: Purchase 'Living room rug', with 3 Requirements." After each later round, add or change Requirements by position. When the user favours it but hasn't committed, move it to Leaning with `set_decision_state`.
3. **Offer to stop.** Once the Requirements cover size and access, material, color, and use, every round offers to write the Guides and stop there.
4. **Lock only on clear commitment** ("yes, that's what we'll buy", "lock it in"). A Locked Purchase goes on the Shopping List. Lock with `set_decision_state`, the reason quoting the user, and say it: "Locked: Purchase 'Living room rug'."

## The Guides

Write both Guides with `save_guides` once the user agrees the Requirements, whether or not the Purchase is Locked, and again whenever a Requirement changes afterwards, since that marks the Full Guide out of date. Say so: "Saved the Quick Guide and the Full Guide for 'Living room rug'."

- **The Quick Guide** is a companion to the Full Guide, which the user reads ahead of time. It is glanced at in a shop, in front of one candidate, or with a seller. Every line is a fragment, numbers first, and the whole of it fits one phone screen. The app assembles it: your looking-for line, the Measure-first lines, every `must`, the `prefer`s, then your own lines grouped by kind. Because the Requirements are read live, it can't go stale. You write two parts of it:
  - **The looking-for line,** in `lookingFor`: what the user is hunting for, in about 80 characters of fragments joined by " · " ("Semi-sheer · warm cream · made-to-measure · 2–2.5× fullness"). It is the most-read line on the page, a filter to scan a shop floor with. Don't write a sentence, and don't reword the Decision's statement.
  - **Your own lines,** in `quickLines`: at most eight in all, each a fragment with its `kind`. All three kinds share the eight, so write only the lines this product needs:
    - `avoid`: a version that rules a candidate out on sight ("Flat shiny polyester — want visible slub"). Write these first. A guide with no `avoid` is suspect: most products have a common wrong version worth naming, so look again before leaving them out.
    - `test`: what to do in the shop and what to notice ("Press the pile: springs back").
    - `ask`: what only the seller can confirm ("Lead time for made-to-measure?"), about three at most.

  Put a why in a Quick Guide line only when it changes a judgment in the shop, and then in five words or fewer ("Pure white — reads cold by the wall"). Every other explanation goes in the Full Guide. Never repeat a Requirement or a Measure-first line in `quickLines`, since the app already shows them.
- **The Full Guide,** in `fullGuide`, is Markdown to read ahead of time, under headings you pick for the product (a sofa: size and access, frame and seat, cover, color; a lamp: light, shade, placement). **Every `must` explains why:** name it, say why the thing would be wrong without it, and name the record it comes from ("At most 2.10 m wide: the measured usable run is 2.30 m, and this leaves the agreed 0.20 m beside the piece"). The reasoning left out of each Requirement's text belongs here. A `prefer` may explain in a line. Say what to look for when no exact match exists, and how to weigh the likely trade-offs.
- **Tests that teach.** Choose the few checks most likely to decide this purchase: comfort in the user's usual position, construction and moving parts, care and repair, or light at the task. In the Quick Guide, a `test` gives the action and what to notice. In the Full Guide, explain what that observation tells them and what it cannot prove. Care instructions or construction details that inspection cannot establish become an `ask`. Keep claims about lifespan and durability conditional on the evidence. Within each kind, put the most useful line first; use fewer than eight lines when that is enough.
- To read or revise a Full Guide already written, call `get_decision` with `includeFullGuide: true`.
- **Taking it to the shop.** When the user is about to go, say how the Quick Guide gets onto their phone, from the `Phone:` line `get_decision` gives for the Purchase: with a LAN address, open the Purchase's page in the app and scan the QR code, or type that address on the phone; without one, the app has to be started with `IDH_LAN=1` first, or the page opens on this computer. Then give the guide's gist in a few lines. Never paste the whole Quick Guide or Full Guide into the reply as a substitute for the page.

## Checking a Listing

When the user brings a specific product (a link, a pasted description, a label's details), check it against every Requirement of the Purchase, from what the Listing states:

- `pass` when the Listing shows the Requirement is met, `fail` when it shows it isn't, and `unknown` when it doesn't say. Never pass a guess: a depth the Listing leaves out is `unknown`, and a color judged from a photo is `unknown` with a note.
- Record it with `record_listing`: its `name`, `url`, `price` with the currency, `dimensions` as stated (whole millimetres), and `checks`, one for every Requirement by its position, each with its `result` and a short `note`. To re-check a Listing already recorded, pass its slug as `listing`.
- Say the verdict plainly, from the receipt: any failed `must` rules it out ("It fails a must: 2.30 m wide, and the limit is 2.10 m"); each `unknown` becomes what to ask the seller or check in the shop; then the `prefer`s.
- **Ready to buy.** Recommend a Listing as meeting the `must`s only when each is verified. With an unknown `must`, say it is a possible choice pending that check, and name who can resolve it. A failed `must` remains a failure under the current Requirements even if the user accepts the compromise; changing a Locked Purchase follows "Asking first". For price, use the user's currency and distinguish the item price from delivery and assembly. Ask whether a stated purchase limit is firm or preferred, save the answer as a Note when needed, and trace a price Requirement to it. Report unknown extra costs rather than assuming they are included.
- A Listing never changes the Decision's state by itself. The user saying "that's the one we'll buy" is a commitment: Lock as in "The interview".

## Fulfilment

A Locked Purchase is Fulfilled when the thing is bought. Call `record_fulfilment` only when the user says it is bought ("I bought the chair", "the rug arrived"). A plan is not a purchase: "we're ordering it tomorrow" or "it's in the basket" changes nothing yet, so record nothing and say what you will record once it's bought.

- **Not Locked yet:** buying it is a clear commitment. Lock it with `set_decision_state`, the user's words as the reason, say so, then record the Fulfilment.
- **Confirm what was bought.** Reuse recorded Listing details once the user confirms the same product and variant. Ask in one round for the missing details that matter and what happened to the old Item or Feature. Use `replacesItem` or `replacesFeature` only when the old one is retired; something kept elsewhere remains in the Inventory.
- **Check the differences.** Compare what is known with every Requirement. Name each confirmed Deviation and ask why the user accepted it ("only size in stock", "over budget, but the last one"), in this round if its details are already known, otherwise in the next. Keep their words as the Deviation's `reason` when given; a compromise with its reason reads as a considered one later. Missing evidence remains an open check, not a pass or a Deviation: name it, save a Note with `save_note`, add it to the Purchase's `evidence`, and include it in the closing summary. Record the actual purchase with known details and confirmed Deviations rather than inventing missing facts. Before recording a Deviation from a `must`, explain that it flags every Decision resting on this Purchase; afterwards name the flags from the receipt.
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

Close when the user is done, following "Closing" in the Session protocol below. In `open`, list every Purchase of this Session that isn't Locked, every Locked one not yet bought, every Measure-first line still waiting for a measurement, and every parked question; in `next`, suggest taking the Quick Guide shopping, telling you what was bought, or the next thing to buy.
