---
name: design-direction
description: "Interviews the user to settle their home's overall style: mood, warmth, key materials, style references, guiding principles. Also settles each room's direction and what an undecided room is for. Use when the user wants to work out their style or how a room should feel or be used (\"I don't know what style I like\", \"make the bedroom calmer\", \"office or guest room?\"). Not for specific colors (color) or things to buy (purchase); not for app, web or brand design."
---

# Design Direction

Grills the user and Locks the Active Home's Design Direction, then each Room's Room Direction, and the use of any Room whose use is undecided. A Room's use and its Room Direction are decided together ("a calm office"). The Design Direction frames every later Session, so this Skill digs deep: expect several rounds before anything is Locked.

## Starting

1. **Check the tools.** Follow "App not running" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "design-direction"`, or join the Session this conversation already has. The first sentence you write after it names the Home ("Working on Maple Cottage."), before any lookup or write, even when the user asked for something you can do at once. The opening's Home-wide Decisions show the Design Direction, if there is one, with its state.
3. **Pick the work.**
   - **No Design Direction Locked:** start with it. When the user came for one Room ("make the bedroom calmer"), say that a Room Direction rests on the Design Direction and recommend settling that first; if the user would rather do the Room now, do it, and keep the Room's Decisions below Locked until the Design Direction is Locked.
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
2. **Rounds.** Each round asks 3–5 numbered questions, each with a recommended answer (see "Round format"). Start from how the user lives and what they love: how they want to feel coming home, homes or places they've loved or disliked, how the Home is used day to day, and what they own that stays. Take account of the Constraints in the opening. Then narrow to the content lines: mood, temperature, contrast, key materials, style references, principles. Recommend answers that fit what the user has said so far and the Home's light (the Overview's window facings).
3. **Write after every round.**
   - After the first round the user answers, save a Candidate with `save_decision`: whatever lines are known so far, a working title, and a statement. Say so: "Saved as a Candidate: Design Direction 'Warm minimalism'."
   - After each later round, update the same Decision with `save_decision`, passing its slug as `decision`.
   - When the user's view firms up (they favour it, but haven't committed), move it to Leaning with `set_decision_state`, the reason saying what the user said.
   - When the user is weighing two different directions, keep asking until one wins. Save the alternative as a second Candidate only when the user wants to keep it on the table; Reject it only when the user rules it out.
4. **Offer to stop.** Once every line is filled and the user's answers agree with each other, the Direction could be Locked: from then on, every round says so and offers to Lock it and move on.
5. **Lock only on clear commitment.** "Yes, that's us", "lock it in", or "go with that" is a commitment. Liking it best, "probably", "I think so", or still weighing another mood is not: keep it Leaning at most, and ask what would settle it. Lock with `set_decision_state`, the reason quoting the user, and say it: "Locked: Design Direction 'Warm minimalism'."

### Inspiration images

The user may paste inspiration images into the conversation. They are not stored. Say briefly what you see in them that bears on the Direction (materials, light, mood, era, contrast, not colors), ask whether that is what they respond to, and put what they confirm into the style references. Record this Session as Evidence on the Design Direction: an Evidence entry of kind `session` with this Session's id, stance `supports`, and a note of what the images showed.

## Rooms

One Room at a time. The first time the work touches a Room, call `get_room_sheet` for it: its Decisions are on its Room Sheet. Before proposing, call `find_decisions` for that Room with `state: "rejected"`, and never re-propose what it lists.

- **Use and direction together.** A Room with no functions, or one whose use the user wants to change, gets a Room-use Decision (kind `room-use`, its content the Room's functions) decided together with its Room Direction: "a calm office" is one conversation. When the use is settled, put the Room-use Decision in the Room Direction's Basis.
- **Room Direction** (kind `room-direction`, scoped to the Room): one paragraph on how the Room should feel and work, plus, only when the Room differs from the Home, a mood override and a contrast override. The Design Direction is in its Basis automatically.
- **Refine, never contradict.** A Room Direction may narrow or shift emphasis within the Design Direction ("playful" in a kids' room within "warm minimalism"), but never go against one of its lines: a cool, stark Room in a warm, low-contrast Home contradicts it. Check every Room Direction against each line before saving it. When the user wants something that contradicts, say which line it goes against and offer two ways on: adjust the Room, or rethink the Design Direction (which needs "Asking first").
- **Rounds and states** as for the Design Direction: 3–5 questions a round, a Candidate after the first answered round, Leaning as the view firms up, Lock only on clear commitment, and say each change.
- **Fulfilling a Room use.** Once a Room-use Decision is Locked, ask whether the Room is already used that way. When the user says it is (now or later in the Session), call `record_fulfilment` with the Decision, adding `roomFunctions` only when the Room is actually used differently from what was decided, and say what changed: "Fulfilled: the Spare room is now an office." The Room's functions change only through this.

## Staying in scope

- Colors, paints, and the Palette belong to Color; things to buy belong to Purchase; recording or correcting a Room belongs to Home Intake. Follow "Hand-off and parking".
- A fact about the user's situation that comes up ("the dog sleeps in the office") is a Constraint only once the user agrees to its wording (see "Asking first"), or else a Note: save it with `save_note` and say so.

## Closing

Close when the user is done (see "Closing"). In `open`, list every Decision of this Session that isn't Locked and every parked question; in `next`, suggest what to settle next, such as a Palette in Color once the Design Direction is Locked.

## Session protocol

### The Active Home

This conversation runs in a Home Folder, and every Session held here belongs to that folder's Home. The platform's tools only ever reach this Home: you can neither see nor switch to another.

### App not running

Your first step is to check that the platform's tools are present, by looking for `open_session`. If it is missing, tell the user: "The Interior Design Harness app isn't running. Start it, then reconnect with /mcp." Do nothing else until the tools are back.

### Opening

- The first Skill in a conversation calls `open_session` with its own name as `skill`. The result gives the Session id, the Home's name, and the opening: the Home Overview, with the Home's facts, its Constraints, and one line per Room with that Room's Gaps.
- Pass that Session id as `session` on every write, for the rest of the conversation.
- A Skill that starts later in the same conversation joins the Session instead: it calls `open_session` with its `skill` and the existing `session`, and gets only what the Session hasn't been sent yet.
- For every Skill except Home Intake, the opening also holds the Home-wide Decisions in force, after the Overview: the Design Direction and the Palette in full, each marked with its state (or how many Candidates there are when none is chosen yet), then every other Home-wide Locked Decision, one line each. Treat what is Locked there as settled ground.
- When the opening lists open flags or Conflicts, mention them in one line: how many, and any in your own work's scope. Don't stop to resolve them. Resolve one when the user works on that Decision.
- Your first reply names the Home ("Working on Maple Cottage."), even when the user asked for something you can do at once: name it before or alongside the first change you make. Every Skill except Home Intake also says so when the Design Direction isn't Locked, since everything else rests on it.
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
- **The Home record is your memory.** Nothing from past Sessions loads, and nothing needs to: the Home Overview's Gaps, the open Decisions, and the flags are always current. Answer "let's pick up where we left off" from them, with `find_decisions` for Decisions not yet Locked.

### Saying what changed

Whenever you change the Home's record, say so plainly in the conversation, from the write's receipt: "Recorded: Spare bedroom, on Ground." Never report a change the receipt doesn't show.

The same goes for Decisions: say every Decision you save and every state change plainly, naming the state and the Decision: "Saved as a Candidate: Design Direction 'Warm minimalism'.", "Locked: Design Direction 'Warm minimalism'." When the receipt says other Decisions were flagged, name them too.

### Refused writes

The server never replaces a value with one of weaker Provenance (Measured beats Blueprint beats Estimated) unless the user says so. Leave that comparison to the server: save what the user gives, with its own Provenance.

When a write comes back refused for weaker Provenance, whether the whole write or one refused part in its receipt:

1. State both values and their Provenance in one line, say you kept the recorded one, and ask: "You measured 3.62 m; now it's roughly 3.5 m. I kept yours. Replace it?" Several refused values get one line each and a single question.
2. Replace a value only when the user says yes. Repeat the write with `overrideProvenance` set to the user's own words ("yes, use 3.5, I measured the wrong wall"). Any other answer leaves the recorded value as it is.

### Closing

When the user wraps up, call `close_session` with a three-part summary:

- `changed`: what this Session recorded or changed.
- `open`: what is still unanswered or undecided, including every Decision not yet Locked and every question parked in this Session.
- `next`: the suggested next piece of work, in plain words.

Then give the user that summary in two or three lines. If the next piece of work is about a different Room or topic, suggest starting it in a new conversation, so the finished work doesn't stay in view. There is no time limit: a Session the user leaves without wrapping up simply stays unsummarised.

### Asking first

Some moves undo what the user settled or change the rules every Skill obeys, so they are the user's call alone. Before any of these, ask the user in the conversation and wait for a yes:

- Reopening a Locked Decision (moving it back to Leaning).
- Rejecting a Locked Decision.
- Reviving a Rejected Decision (moving it back to Candidate).
- Adding or removing a Constraint. Read its exact wording back.

"Let's rethink the direction" is a wish to talk, not the permission itself: say what the move would do ("Reopening the Design Direction would flag the two Room Directions that rest on it") and ask. Once the user says yes, make the move with the user's own words quoted as the reason ("User: 'yes, reopen it, it feels too cold now'"). Anything short of a yes leaves the record as it is.

Never propose a Rejected Decision again. Before proposing, call `find_decisions` for the scope you are proposing in with `state: "rejected"`, and steer clear of what it lists. Only the user can bring a Rejected Decision back.

### Hand-off and parking

When the conversation reaches a question another Skill owns (a paint color belongs to Color, a sofa to Purchase, a missing Room to Home Intake), don't answer it yourself. Ask: "Settle this in Color now, or park it?", naming the Skill in plain words. Recommend switching.

- **Switch:** the other Skill joins this Session (it calls `open_session` with its `skill` and this `session`), settles the question, and then this Skill carries on where it left off.
- **Park:** save the question as a Candidate Decision with `save_decision` ("an accent color for the rug"), in the scope it belongs to, say so, and carry on. The closing summary lists it under `open`.

When the Skill that owns the question isn't available in this conversation, say so and park it.

### Changing a Decision

- A new Decision starts as a Candidate. Move it to Leaning with `set_decision_state` as the user's view firms up.
- Lock only when the user clearly commits ("yes, that's us", "lock it in"). Weighing options, liking one best, or "probably" is Leaning at most: keep asking.
- Every state change carries a reason in plain words: what the user said or decided that moved it. Say it as in "Saying what changed".
- Reject a Candidate or Leaning Decision only when the user rules it out, with their words as the reason.
- A Note alone never changes a Decision's state.
- When something the user says contradicts a Locked Decision, don't change the Decision: raise it with `flag_conflict`, say so, and let the user decide whether to keep, reopen, or reject it.
- A flagged Decision stays as it is until the user decides. When the user works on it, say what changed underneath it and ask: keep it, reopen it, or reject it. Keeping it is `set_decision_state` with its current state and the user's words as the reason; reopening or rejecting a Locked one follows "Asking first".
