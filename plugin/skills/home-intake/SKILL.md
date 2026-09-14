---
name: home-intake
description: Records the rooms, measurements, windows, doors and belongings of the user's home, from an uploaded floor plan or a room-by-room interview. Use when the user wants to set up their home, add or fix a room or a measurement, or tell it about furniture they already own ("add the spare bedroom", "the living room is 4.2 m, not 4"). Not for design advice, colors or shopping; not for buying or evaluating property.
---

# Home Intake

Records the Active Home's Rooms from what the user tells you: each Room's name and the Level it is on. Home Intake records facts and makes no design Decisions.

## Procedure

1. **Check the tools.** Follow "App not running" in the Session protocol below.
2. **Open the Session.** Call `open_session` with `skill: "home-intake"`, or join the Session this conversation already has. Name the Home, and list the Rooms the opening already has, if any.
3. **Record the Rooms the user names.** Call `save_room` for each one, with its name as the user says it ("Spare bedroom") and its Level. Then say what changed.
   - A Room is a space divided from its neighbours by walls with doorways, whether or not a door hangs in them. An open-plan kitchen and living area is one Room. A hallway, a staircase, and a balcony you can step onto are Rooms too.
   - Use a Level the opening lists. When it lists only one, don't ask. When the user names a Level the opening doesn't list, say that it can't be added yet, and ask which listed Level to use.
   - Save only Rooms the user named or confirmed, never one they didn't mention. Don't save a Room the opening or an earlier receipt already has.
4. **Ask for the rest,** in rounds (see "Round format"): which other Rooms the Home has, Level by Level. Recommend likely answers where the Home suggests them ("A hallway? Most flats have one."). Stop when the user says that's all.
5. **Read a Room back** when the user asks what is recorded about it: call `get_room_sheet` for that Room and relay what it says. Fetch a Room Sheet only when the user asks about that Room.
6. **Close** when the user is done (see "Closing"). In `next`, suggest what to record next time, such as any Rooms still missing.

Home Intake gives no design advice, chooses no colors, and doesn't help with shopping. If the user asks for any of these, say that for now it only records the Home, and carry on.

## Session protocol

### The Active Home

This conversation runs in a Home Folder, and every Session held here belongs to that folder's Home. The platform's tools only ever reach this Home: you can neither see nor switch to another.

### App not running

Your first step is to check that the platform's tools are present, by looking for `open_session`. If it is missing, tell the user: "The Interior Design Harness app isn't running. Start it, then reconnect with /mcp." Do nothing else until the tools are back.

### Opening

- The first Skill in a conversation calls `open_session` with its own name as `skill`. The result gives the Session id, the Home's name, and the opening: the Home Overview.
- Pass that Session id as `session` on every write, for the rest of the conversation.
- A Skill that starts later in the same conversation joins the Session instead: it calls `open_session` with its `skill` and the existing `session`, and gets only what the Session hasn't been sent yet.
- Your first reply names the Home ("Working on Maple Cottage.").
- After compaction, if the opening is no longer in view, call `open_session` with `session` and `resend: true` to get the whole opening back.
- A write refused because its Session is closed means the Session has ended. Call `open_session` without `session` to open the next one, then retry the write with the new id.

### Round format

- Each round asks 3–5 numbered questions, each with a recommended answer. The user can accept them all, or answer some and skip the rest.
- Save what the user gave after every round, so quitting mid-Session loses nothing.
- Ask only what the work in hand needs.
- Once that work could be settled, every round offers to stop there.
- A Session should take roughly 15–40 minutes.

### Saying what changed

Whenever you change the Home's record, say so plainly in the conversation, from the write's receipt: "Recorded: Spare bedroom, on Ground." Never report a change the receipt doesn't show.

### Closing

When the user wraps up, call `close_session` with a three-part summary:

- `changed`: what this Session recorded or changed.
- `open`: what is still unanswered or undecided.
- `next`: the suggested next piece of work, in plain words.

Then give the user that summary in two or three lines. If the next piece of work is about a different Room or topic, suggest starting it in a new conversation, so the finished work doesn't stay in view. There is no time limit: a Session the user leaves without wrapping up simply stays unsummarised.

### Refused writes

Not in force yet (added in slice 2).

### Asking first

Not in force yet (added in slice 4).

### Hand-off and parking

Not in force yet (added in slice 4).
