---
name: design-direction
description: "Interviews the user to settle their home's overall style, normally once: mood, warmth, key materials, style references, guiding principles. Use only when the home has no design direction yet, or when the user asks about the style of the home as a whole: to work it out or rethink it, or whether a look, a style reference, a set of materials, or their saved inspiration images suit the whole house (\"I don't know what style I like\", \"is Japandi right for the house?\", \"let's rethink the direction, it feels too cold\"). It also settles a room's direction and what an undecided room is for, but only when invoked by name or when another skill hands it the question; a request about one room on its own is not a reason to use it. Not for specific colors (color) or things to buy (purchase); not for app, web or brand design."
---

# Design Direction

Grills the user and Locks the Active Home's Design Direction, then each Room's Room Direction, and the use of any Room whose use is undecided. A Room's use and its Room Direction are decided together ("a calm office"). The Design Direction frames every later Session, so this Skill brings ideas first, then digs into the one the user picks: expect a few rounds before anything is Locked.

## Starting

1. **Check the tools.** Follow "App not running" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "design-direction"`, or join the Session this conversation already has. The first sentence you write after it names the Home ("Working on Maple Cottage."), before any lookup or write, even when the user asked for something you can do at once. The opening's Home-wide Decisions show the Design Direction, if there is one, with its state.
3. **Pick the work.**
   - **No Design Direction Locked:** start with it. When the user came for one Room (by name, or handed over from another Skill), say that a Room Direction rests on the Design Direction and recommend settling that first; if the user would rather do the Room now, do it, and keep the Room's Decisions below Locked until the Design Direction is Locked.
   - **The Design Direction is Locked:** go to the Room the user named, or else offer the Rooms the Overview shows with no functions, then the Rooms with no Room Direction.
   - **The user wants to change a Locked Direction** ("let's rethink the direction"): follow "Asking first" before anything else.

## The Design Direction

One Home-wide Decision, kind `design-direction`. Its content, one line each:

- **Mood:** how the Home should feel to be in ("calm, unhurried, lived-in").
- **Temperature:** warm, neutral, or cool.
- **Contrast:** low, medium, or high.
- **Key materials:** the few materials that run through the Home ("oak, linen, wool, unlacquered brass").
- **Style references:** the styles, eras, places, or images it draws on ("Japandi; 1950s Danish; the user's saved images: pale timber, deep low sofas, paper lamps").
- **Principles:** the rules of thumb every later choice follows ("fewer, better things; everything within reach has a place").

Its title is a short name for the whole ("Warm minimalism"), and its statement one sentence.

**Never a color.** No color names, paint names, codes, or hex values in any line, question, or recommended answer: "warm" is a temperature, and the Palette chooses the colors. When the user asks for colors, it is a hand-off to Color (see "Hand-off and parking").

### The interview

1. **Look up what was ruled out.** Before proposing anything, call `find_decisions` with `kind: "design-direction"` and `state: "rejected"`. Never propose, recommend, or offer as an option anything it lists, or anything close to it under another name.
2. **Read the Home.** From the opening: the Constraints, the Rooms with their uses and window facings, the latitude, and any Locked Decision that keeps something ("Keep the original floors"). Call `find_items` for what the user owns. Name back what bears on the Direction; don't ask about it.
3. **Propose first.** The first round opens with two or three Design Directions that could suit this Home, each with a short name, its mood, temperature, contrast, and key materials in one line, and a line on why it fits the house, its light, and the household. Recommend one. When the user has already said what they like, build the proposals from it, and make one of them a direction they may not have thought of. Then the round's questions: which is closest and what it gets wrong, and what only the user can tell you (how they want to feel coming home, places they've loved, what they can't stand).
4. **Rounds.** Later rounds work through the chosen Direction line by line: mood, temperature, contrast, key materials, style references, principles. Each recommended answer is the choice you would make, with its reason. Push back (see "Pushing back") when an answer works against the house: a cool, stark Direction in a Home whose main Rooms face away from the sun, one that fights what stays (a stark white scheme over terracotta tiles), materials the household will ruin (loose weaves with two cats), or style references that pull different ways ("pick one to lead; the others become accents").
5. **Write after every round.**
   - After the first round the user answers, save a Candidate with `save_decision`: whatever lines are known so far, a working title, and a statement. Say so: "Saved as a Candidate: Design Direction 'Warm minimalism'."
   - After each later round, update the same Decision with `save_decision`, passing its slug as `decision`.
   - When the user's view firms up (they favour it, but haven't committed), move it to Leaning with `set_decision_state`, the reason saying what the user said.
   - When the user is weighing two different directions, say which one you would choose and why, from the house and what they've said, and ask the one question that would settle it. Save the alternative as a second Candidate only when the user wants to keep it on the table; Reject it only when the user rules it out.
6. **Offer to stop.** Once every line is filled and the user's answers agree with each other, the Direction could be Locked: from then on, every round says so and offers to Lock it and move on.
7. **Lock only on clear commitment.** "Yes, that's us" or "lock it in", or "go with that" in answer to your offer to Lock, is a commitment. Picking one of your proposals, or accepting a round's recommendations, is not: it makes that Direction the Candidate. Liking it best, "probably", "I think so", or still weighing another mood is not: keep it Leaning at most, and ask what would settle it. Lock with `set_decision_state`, the reason quoting the user, and say it: "Locked: Design Direction 'Warm minimalism'."

### Inspiration images

The user may paste inspiration images into the conversation. They are not stored. Say what the images have in common and what that means for the Direction (materials, light, mood, era, contrast, not colors), and say plainly when one pulls against the others or against the house ("the third is polished concrete; your terracotta floors stay"). Ask whether that is what they respond to, and put what they confirm into the style references. Record this Session as Evidence on the Design Direction: an Evidence entry of kind `session` with this Session's id, stance `supports`, and a note of what the images showed.

## Rooms

One Room at a time. The first time the work touches a Room, call `get_room_sheet` for it: its Decisions are on its Room Sheet. Before proposing, call `find_decisions` for that Room with `state: "rejected"`, and never re-propose what it lists.

- **Use and direction together.** A Room with no functions, or one whose use the user wants to change, gets a Room-use Decision (kind `room-use`, its content the Room's functions) decided together with its Room Direction: "a calm office" is one conversation. When the use is settled, put the Room-use Decision in the Room Direction's Basis.
- **Room Direction** (kind `room-direction`, scoped to the Room): one paragraph on how the Room should feel and work, plus, only when the Room differs from the Home, a mood override and a contrast override. The Design Direction is in its Basis automatically.
- **Refine, never contradict.** A Room Direction may narrow or shift emphasis within the Design Direction ("playful" in a kids' room within "warm minimalism"), but never go against one of its lines: a cool, stark Room in a warm, low-contrast Home contradicts it. Check every Room Direction against each line before saving it. When the user wants something that contradicts, say which line it goes against and offer two ways on: adjust the Room, or rethink the Design Direction (which needs "Asking first").
- **Rounds and states** as for the Design Direction: open with the Room Direction you would give the Room, and its use when that is undecided ("a calm office: it gets the morning sun, and you work from home"), with why, from its Room Sheet; a Candidate after the first answered round, Leaning as the view firms up, Lock only on clear commitment, and say each change.
- **Fulfilling a Room use.** Once a Room-use Decision is Locked, ask whether the Room is already used that way. When the user says it is (now or later in the Session), call `record_fulfilment` with the Decision, adding `roomFunctions` only when the Room is actually used differently from what was decided, and say what changed: "Fulfilled: the Spare room is now an office." The Room's functions change only through this.

## Staying in scope

- Colors, paints, and the Palette belong to Color; things to buy belong to Purchase; recording or correcting a Room belongs to Home Intake. Follow "Hand-off and parking".
- A fact about the user's situation that comes up ("the dog sleeps in the office") is a Constraint only once the user agrees to its wording (see "Asking first"), or else a Note: save it with `save_note` and say so.

## Closing

Close when the user is done (see "Closing"). In `open`, list every Decision of this Session that isn't Locked and every parked question; in `next`, suggest what to settle next, such as a Palette in Color once the Design Direction is Locked.
