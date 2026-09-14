# Interior Design Harness

A workspace that keeps a persistent, detailed model of a user's Home and uses AI-led Sessions to help them make interior design and purchasing Decisions for it. Buying or evaluating real estate is out of scope.

## Language

### The Home

**Home**:
A dwelling the user designs and furnishes — a house, apartment, or similar. A user may have several.
_Avoid_: Property, house, apartment, space, unit

**Active Home**:
The one Home a Session can see: the Home whose Home Folder the Agent is running in. Everything about the user's other Homes is invisible to it.
_Avoid_: Current home, selected home, default home

**Home Folder**:
A folder on the user's computer, one per Home, in which the user runs their Agent. Every Session started there belongs to that Home.
_Avoid_: Workspace, project, project folder

**Tenure**:
Whether the user owns or rents a Home. Never a restriction on its own: what the user may change is recorded as Constraints.
_Avoid_: Ownership, rental status

**Level**:
The part of a Home at one height in the building, numbered from the ground (0) upward, so a fifth-floor flat is a single Level numbered 5.
_Avoid_: Floor, storey, story

**Room**:
A named space on one Level of a Home, divided from its neighbours by walls with doorways, whether or not a door hangs in them: an open-plan kitchen and living area is one Room, and a hallway, staircase, or any balcony you can step onto is a Room too. Its functions (kitchen, living, office…) record how it is used now; a Room may have none yet, and choosing one is a Decision.
_Avoid_: Space, area, zone

**Wall**:
One side of a Room, in clockwise order around it, with a length, the compass direction it faces, and what lies beyond it (another Room or outside). A Room's Wall lengths are its dimensions.
_Avoid_: Side, edge

**Window**:
A window or skylight of a Room, recorded in the Wall it is in (or in the roof). Windows bring daylight, so the way their Walls face shapes color and lighting advice.

**Door**:
A doorway in a Wall, between two Rooms or between a Room and outside, whether or not a door hangs in it. One Door is shared by the two Rooms it joins, and a glazed Door (e.g. French doors) also lets in daylight.

**Blueprint**:
A source document (image or PDF) of a Home's plan, supplied by the user for the AI to read.
_Avoid_: Floor plan, layout

**Floor Plan**:
The structured 2D model of a Home's Rooms and their geometry, derived from a Blueprint or entered by hand.
_Avoid_: Layout, blueprint, map

**Item**:
Something the user owns and would take with them on moving out — furniture, decor, an appliance, a lamp.
_Avoid_: Possession, thing, object, product, fixture

**Unplaced**:
Said of an Item in the Inventory that is in no Room, e.g. still boxed after a move or kept in off-site storage.

**Inventory**:
Every Item of a Home that is not Archived, whether in a Room or Unplaced.

**Feature**:
A part of the building within a Room that stays when the user moves out — a radiator, fireplace, built-in wardrobe, beam, or ceiling light point. A Purchase Decision may replace a Feature as well as an Item.
_Avoid_: Fixture, fitting

**Surface**:
One of a Room's walls, ceiling, floor, or woodwork, described by its material, color, and finish. Surfaces are part of the Room's current state and change when a Decision is Fulfilled.
_Avoid_: Finish, decoration

**Photo**:
A dated picture of one Room or of a single Item, kept by the platform. Inspiration images are not Photos.
_Avoid_: Image, picture

**Provenance**:
Where a measurement or color came from: **Measured** by the user, printed on a **Blueprint**, or **Estimated** by eye (from a Photo, scaled off a drawing, or guessed). For a color, Measured means identified exactly, e.g. by a paint code from the tin. Confirming an Estimated value does not make it Measured.
_Avoid_: Source, confidence

**Note**:
A free-form fact about a Home or the people living in it that doesn't fit a structured record (e.g. "the cat scratches fabric furniture", "we might get a dog"). Background context that the AI deliberately gives little weight to: a Note can support a Decision but is never on its own enough to change a Decision's state. A Note becomes a Constraint only when the user confirms it as fact.
_Avoid_: Memory, fact

**Constraint**:
A fact about the user's situation that the AI must obey as strictly as a Locked Decision, but which is not a design choice (e.g. "rental: no painting or drilling", "two cats").
_Avoid_: Rule, requirement, limitation

### Deciding

**Decision**:
A choice about a Home as a whole or about one of its Rooms: a design choice, a purchase, or work to be done. Always in exactly one state: Candidate, Leaning, Locked, or Rejected.
_Avoid_: Choice, option, recommendation

**Candidate**:
A Decision state: under consideration, with no commitment.
_Avoid_: Possible option, idea

**Leaning**:
A Decision state: favoured but not committed; later Evidence may strengthen or weaken it.
_Avoid_: Tentative

**Locked**:
A Decision state: committed. The AI treats it as settled ground for later Decisions; it may Lock when the user clearly commits, but only moves a Decision out of Locked on the user's explicit instruction.
_Avoid_: Final, locked in

**Rejected**:
A Decision state: ruled out. The AI must not propose it again, and only revives it on the user's explicit instruction.

**Reopen**:
To move a Locked Decision back to Leaning, on the user's explicit instruction ("let's rethink the couch"). Contrast with rejecting it ("let's give up on the green couch"). Either one flags, but never changes, every Decision with it in its Basis.
_Avoid_: Unlock

**Design Direction**:
The Home's overall design philosophy (style references, mood, color temperature, key materials, guiding principles). It names no specific colors; those belong to the Palette. It is a Home-wide Decision, settled by the Design Direction Skill, that is automatically part of the Basis of every other Decision. It frames every later Session, Decision, and Shopping Guide.
_Avoid_: Style, design philosophy, aesthetic, theme

**Room Direction**:
A refinement of the Design Direction for one Room (e.g. "playful" for a kids' room within a "warm minimalism" Home). It may refine the Design Direction but never contradict it.
_Avoid_: Room style, room theme

**Palette**:
The Home's set of named colors, each with a role (base, secondary, accent), from which every color choice in the Home is drawn. A Home-wide Decision resting on the Design Direction; unlike the Design Direction, it enters the Basis only of Decisions that use one of its colors.
_Avoid_: Color scheme, color story, colorway

**Basis**:
The Decisions a Decision rests on. When a Decision is reopened or rejected, every Decision with it in its Basis is flagged for review.
_Avoid_: Dependencies, parents

**Evidence**:
A Note, Session, or other Decision recorded as supporting or undermining a Decision.

**Conflict**:
A flagged contradiction between new Evidence and a Locked Decision, which only the user can resolve by keeping, reopening, or rejecting the Decision.

**Flag**:
A mark on a Decision saying that something it rests on has changed and it needs review: a Decision in its Basis was reopened, rejected, or Fulfilled with a Deviation from a *must* Requirement, or a value one of its Requirements' reasons points at has changed. Unlike a Conflict, the platform raises it; the user clears it by keeping, reopening, or rejecting the Decision.
_Avoid_: Alert, warning

**Fulfilled**:
Said of a Locked Decision that needed action (buying, painting, installing, moving) once that action has been carried out. Fulfilling it updates the Home, e.g. by adding the bought Item to the Inventory, Archiving the Item it replaced, or changing a Room's Surface. What was actually done may differ from what was decided, and the Home records what was actually done. Not a Decision state.
_Avoid_: Done, purchased, completed

**Deviation**:
A recorded difference between what a Decision asked for and what was actually done when it was Fulfilled (e.g. a sofa taller than its Requirement, paint a shade darker). A Deviation from a *must* Requirement flags every Decision with the Fulfilled Decision in its Basis.
_Avoid_: Mismatch, discrepancy

**Archived**:
Said of anything retired from active use but kept: a Note, Session, Decision, or Constraint, or a recorded part of the Home such as a Room, Wall, Feature, or Item. Anything referenced (as Evidence, in a Basis, or by a Requirement's reason) is Archived, never deleted, so removing a Constraint or a Room Archives it. An Item is Archived when replaced, sold, given away, or broken.
_Avoid_: Deleted, pruned, hidden

### Purchasing

**Purchase Decision**:
A Decision to acquire something for the Home, possibly replacing an existing Item.
_Avoid_: Order, wish, buy

**Requirement**:
One attribute a Purchase Decision asks for (e.g. "under 85 cm tall"), marked *must* or *prefer*, with a reason linking to where it came from — a Decision, Constraint, Note, or a recorded part of the Home (a Room, Wall, Window, Feature, Item…).
_Avoid_: Spec, criterion, filter

**Listing**:
A specific real-world product (name, link, price, dimensions, photo) being considered for a Purchase Decision and checked against its Requirements.
_Avoid_: Product, offer, match

**Shopping List**:
Every Locked Purchase Decision that is not yet Fulfilled. Downloadable.
_Avoid_: Wishlist, cart

**Considering**:
Every Candidate or Leaning Purchase Decision: things the user might buy but hasn't committed to.
_Avoid_: Wishlist, maybe list

**Shopping Guide**:
Guidance for buying the thing a Purchase Decision is about when no exact match exists: what to look for and why, so the user can make a reasoned choice while browsing. Comes in two depths, the Quick Guide and the Full Guide.
_Avoid_: Spec sheet, buying guide

**Quick Guide**:
The glanceable, bullet-point form of a Shopping Guide, for use while actually shopping.
_Avoid_: Summary, cheat sheet

**Full Guide**:
The in-depth form of a Shopping Guide, explaining the reasoning and background, to be read ahead of time.
_Avoid_: Long guide, detailed guide

**Budget**:
Money the user plans to spend on a Home. Distinct from a Constraint, and handled as its own module.
_Avoid_: Spending limit, allowance

### AI

**Agent**:
The external AI client (e.g. Claude Code, Codex) in which the user runs Sessions, using their own subscription.
_Avoid_: Harness, assistant, bot

**Session**:
An AI-led grilling interview about the Active Home, held in one Agent conversation, whose outcome is changes to the Home's record or new or changed Decisions of any kind. It may use several Skills. The platform keeps a record of each Session (the Skills it used, the Rooms and Decisions it touched, and a summary), not its transcript. A Session ends when the user wraps up and it is given a summary; one that never gets a summary simply stays unsummarised.
_Avoid_: Chat, conversation, grilling session, purchase session

**Skill**:
A packaged area of design expertise or procedure — e.g. Home Intake, Color, Purchase — that the AI applies during a Session.
_Avoid_: Mode, agent, tool

**Home Intake**:
The Skill that records or corrects a Home's Rooms and Inventory from a Blueprint or an interview. It can be run at any time, not only when a Home is first added.
_Avoid_: Onboarding, setup, import

**Home Overview**:
The compact picture of the Active Home that every Skill is given at Session start: the Home's own facts, its Constraints, a count of Unplaced Items, and one line per Room with its Gaps. The rest of the Home is fetched only when needed.
_Avoid_: Summary, context, snapshot

**Room Sheet**:
Everything recorded about one Room — its Walls, Windows, Doors, Features, Surfaces, lights, Items, and its Decisions that are Candidate, Leaning, or Locked but not yet Fulfilled — which the AI fetches only when a Session needs that Room.
_Avoid_: Room brief, room detail, room file

**Gap**:
A fact missing from a Room that advice needs, such as its ceiling height or which way its windows face. Gaps show in the Home Overview so that Skills ask only for what is missing.
_Avoid_: Missing field, todo
