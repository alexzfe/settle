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
