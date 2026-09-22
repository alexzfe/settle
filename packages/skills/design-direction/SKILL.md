---
name: design-direction
description: "Interviews the user to settle their home's overall style, normally once: mood, warmth, key materials, style references, guiding principles. Use only when the home has no design direction yet, or when the user asks about the style of the home as a whole: to work it out or rethink it, or whether a look, a style reference, a set of materials, or their saved inspiration images suit the whole house (\"I don't know what style I like\", \"is Japandi right for the house?\", \"let's rethink the direction, it feels too cold\"). It also settles a room's direction and what an undecided room is for, but only when invoked by name or when another skill hands it the question; a request about one room on its own is not a reason to use it. Not for specific colors (color) or things to buy (purchase); not for app, web or brand design."
---

# Design Direction

Grills the user and Settles the Active Home's Design Direction, then each Room's Room Direction, and the use of any Room whose use is undecided. A Room's use and its Room Direction are decided together ("a calm office"). The Design Direction frames every later Session, so this Skill brings ideas first, then digs into the one the user picks: expect a few rounds before anything is Settled.

## Starting

1. **Check the tools.** Follow "Tools missing" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "design-direction"`, or join the Session this conversation already has. The first sentence you write after it names the Home ("Working on Maple Cottage."), before any lookup or write, even when the user asked for something you can do at once. The opening's Home-wide Decisions show the Design Direction, if there is one, with its state.
3. **Pick the work from the user's request and the recorded state.**
   - For a question about whether a look, material, or inspiration fits the Home, assess it against the current Direction and the Home. Discussion alone changes no Decision. If the user contradicts a Settled Decision, follow "Changing a Decision"; changing it follows "Asking first".
   - When continuing an unfinished Direction, use the Direction in the opening, or call `find_decisions` for its Candidate and Leaning Decisions and `get_decision` for the one being continued. Keep its slug and agreed lines; propose anew only where the user wants alternatives or nothing usable exists.
   - With no Settled Direction, recommend settling it before Room work. If the user chooses the Room first, keep its Decisions below Settled until the Design Direction is Settled.
   - With a Settled Direction and a Room request, go to that Room. When the user asks what to do next, offer Rooms with no functions from the Overview; use `find_decisions` for Room Directions before claiming any are missing.

## The Design Direction

One Home-wide Decision, kind `design-direction`. Its content, one line each:

- **Mood:** how the Home should feel to be in ("calm, unhurried, lived-in").
- **Temperature:** warm, neutral, or cool.
- **Contrast:** low, medium, or high.
- **Key materials:** the few materials that run through the Home ("oak, linen, wool, unlacquered brass"). These establish the Home's material character; every Room need not contain all of them. Say where a material belongs when its use is limited.
- **Style references:** the styles, eras, places, or images it draws on ("Japandi; 1950s Danish; the user's saved images: pale timber, deep low sofas, paper lamps").
- **Principles:** a few rules that help choose between real alternatives in this Home, including its practical priorities and the balance of shape, texture, pattern, and display where these matter ("keep everyday clutter behind doors; leave room to display the collection").

Its title is a short name for the whole ("Warm minimalism"), and its statement one sentence.

**Color choices belong to Color.** Keep the Design Direction's content about mood, temperature, contrast, materials, references, and principles. Choose no paint, color, code, or Palette here. You may name a recorded color or repeat the user's color words when explaining what exists, what they like, or what is kept off the Palette; that is not a recommendation. When they ask you to choose or change a color, follow "Hand-off and parking".

### The interview

1. **Look up what was ruled out.** Before proposing anything, call `find_decisions` with `kind: "design-direction"` and `state: "rejected"`. Never propose, recommend, or offer as an option anything it lists, or anything close to it under another name.
2. **Read the Home.** Read the opening's Constraints, uses, times of use, facings, latitude, and Decisions that keep something. Call `find_items` for what the user owns, and `search_notes` for relevant household needs, likes, dislikes, and things they want to keep or change. Read the main living Room's Room Sheet, or the Room the user says should lead the Direction; read another only when a particular fixed material, Feature, or connection there could change the proposal. Name the few facts that shape your advice. Distinguish what is recorded as staying from what is merely present. Where it matters and nothing records the answer, ask what may change. Missing facts stay unknown; make the first proposals provisional where they depend on them.
3. **Propose first.** The first round opens with two or three Design Directions that could suit this Home, each with a short name, its mood, temperature, contrast, and key materials in one line, and a line on why it fits the house, its light, and the household. Recommend one. Make the alternatives differ in at least two things the user could picture living with: how much is on display, the shapes, the amount of pattern and texture, or how formal the Home feels. Explain the main gain and trade-off of each in plain words. Use style names as references, and say what you take from them. Keep every option plausible for this Home; the unexpected option must fit the same facts. When the user has already said what they like, build the proposals from it, and make one of them a direction they may not have thought of. Then the round's questions: which is closest and what it gets wrong, and what only the user can tell you (how they want to feel coming home, places they've loved, what they can't stand).

   Alongside their reaction to the proposals, ask what most needs to work better in daily life, if the record does not say. Before offering to Settle, pin down the needs that could change the Direction: who uses the Home together, the activities and belongings it must accommodate, how much upkeep they want, and how much change they intend. Ask only what could change your advice, within the round's five-question limit. Turn the answers into a few useful principles; leave detailed budgets and purchases to their own work.
4. **Rounds.** Test the chosen Direction as a whole, asking about the lines still uncertain rather than repeating answered questions. Explain the effect of each recommendation in plain words. Push back when a choice has a specific cost for the user's aims, what stays, or the household, and say what you would do instead. Use latitude, recorded sky obstruction, local conditions supplied by the user or record, and times of use when light changes the answer; a facing alone does not establish brightness. A cool mood, strong contrast, or a mix of styles is not a fault by itself. Explain how the references can work together, and ask which quality should lead only when they compete. Follow "Pushing back" if the user keeps their choice.
5. **Write after every round.**
   - After the first round the user answers, save a Candidate with `save_decision`: whatever lines are known so far, a working title, and a statement. Say so: "Saved as a Candidate: Design Direction 'Warm minimalism'."
   - After each later round, update the same Decision with `save_decision`, passing its slug as `decision`.
   - When the user's view firms up (they favour it, but haven't committed), move it to Leaning with `set_decision_state`, the reason saying what the user said.
   - When the user is weighing two different directions, say which one you would choose and why, from the house and what they've said, and ask the one question that would settle it. Save the alternative as a second Candidate only when the user wants to keep it on the table; Reject it only when the user rules it out.
6. **Offer to stop.** The Direction is ready when all six lines have useful content, the practical needs that could change it have been answered or explicitly left open, and it fits the Constraints and what stays. Read back the whole Direction and explain how it would change two everyday choices in this Home. Name any assumption that still matters. Resolve an assumption that could overturn the Direction before offering to Settle; lesser Gaps can wait. Once ready, every round offers to Settle it and move on.
7. **Commitment.** Follow "Changing a Decision" and "Saying what changed". Apply those rules to the whole Direction the user has reviewed, not just the last answered line.

### Inspiration images

The user may paste inspiration images into the conversation. They are not stored. Say what the images have in common and what that means for the Direction (materials, light, mood, era, contrast, not colors), and say plainly when one pulls against the others or against the house ("the third is polished concrete; your terracotta floors stay"). Ask which qualities the user responds to and which they do not want. Put only the qualities they confirm into the style references. When saving Evidence on the Design Direction, use an entry of kind `session` with this Session's id and a note of the confirmed reading; choose `supports` or `undermines` according to what it says about this Direction. An image alone does not change a Decision's state. If the user's confirmed wish contradicts a Settled Direction, follow "Changing a Decision".

## Rooms

One Room at a time. The first time the work touches a Room, call `get_room_sheet` for it: its Decisions are on its Room Sheet. Before proposing, call `find_decisions` for that Room with `state: "rejected"`, and never re-propose what it lists.

- **Use and direction together.** A Room with no functions, or one whose use the user wants to change, gets a Room-use Decision (kind `room-use`, its content the Room's functions) decided together with its Room Direction: "a calm office" is one conversation. When the use is settled, put the Room-use Decision in the Room Direction's Basis.
- **Fit the Room into the Home.** Use the Overview to check which activities already have a place. For a Room with several functions, propose one Room Direction that explains how they work together and which use leads when they compete. Before settling a new use, check the Room Sheet for access, privacy, daylight, and what stays; ask about missing facts only when they could change the use. Use recorded connections to check continuity with adjoining Rooms, fetching another Sheet only when that relationship is part of the decision. Treat a balcony as an outdoor Room: carry the Home's mood and material character through suitable outdoor materials, not a requirement to repeat every indoor material.
- **Room Direction** (kind `room-direction`, scoped to the Room): one paragraph on how the Room should feel and work, plus, only when the Room differs from the Home, a mood override and a contrast override. The Design Direction is in its Basis automatically.
- **Refine, never contradict.** A Room Direction may narrow or shift emphasis within the Design Direction ("playful" in a kids' room within "warm minimalism"), but never go against one of its lines: a cool, stark Room in a warm, low-contrast Home contradicts it. Check every Room Direction against each line before saving it. When the user wants something that contradicts, say which line it goes against and offer two ways on: adjust the Room, or rethink the Design Direction (which needs "Asking first"). An override expresses an emphasis the Home Direction allows; it is not permission to reverse a settled line. State which Home principle it carries through and what varies. If the Home's wording leaves no room for the requested mood or contrast, offer a Room version that fits or ask whether to rethink the Home Direction. Where the user wants different emphases across Rooms, make that allowance explicit in the Home's principles before Settling it.
- **Rounds and states.** Open with the Room Direction you would give the Room, and its use when that is undecided ("a calm office: it gets the morning sun, and you work from home"), with why, from its Room Sheet. Save the answered proposal and later updates as in the Design Direction interview; apply the Session protocol's state and commitment rules to each Decision.
- **Fulfilling a Room use.** Once a Room-use Decision is Settled, ask whether the Room is already used that way. When the user says it is (now or later in the Session), call `record_fulfilment` with the Decision, adding `roomFunctions` only when the Room is actually used differently from what was decided, and say what changed: "Fulfilled: the Spare room is now an office." The Room's functions change only through this.

## Staying in scope

- Colors, paints, and the Palette belong to Color; things to buy belong to Purchase; recording or correcting a Room belongs to Home Intake. Follow "Hand-off and parking".
- A fact about the user's situation that comes up ("the dog sleeps in the office") is a Constraint only once the user agrees to its wording (see "Asking first"), or else a Note: save it with `save_note` and say so.

## Closing

Close when the user is done (see "Closing"). In `open`, list every Decision of this Session that isn't Settled and every parked question; in `next`, suggest what to settle next, such as a Palette in Color once the Design Direction is Settled.
