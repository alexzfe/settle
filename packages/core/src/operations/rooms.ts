import { z } from "zod";
import { CoreError } from "../errors.js";
import { defineOperation } from "../registry.js";
import { type ReceiptLine, renderReceipt, renderRoomSheet } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { LevelRow, RoomRow } from "../store.js";
import { requireHome, requireSession, sessionInput } from "./scope.js";

export const saveRoom = defineOperation({
  name: "save_room",
  description:
    "Records one Room of this Home, with its name and the Level it is on, and returns a " +
    "receipt with one line per change. A Room is a named space divided from its neighbours by " +
    "walls with doorways, whether or not a door hangs in them: an open-plan kitchen and living " +
    "area is one Room, and a hallway, a staircase, or a balcony you can step onto is a Room too; " +
    "a built-in cupboard is not. Call it once for each Room the user names or confirms. A Room " +
    "whose name is already recorded is updated (moved to the given Level), never duplicated. " +
    "`level` is a Level the opening lists, by name or slug; leave it out for the ground Level. " +
    "Tell the user what the receipt says changed. Needs the open Session's id as `session`; a " +
    "closed Session is refused.",
  input: z.object({
    session: sessionInput,
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(`The Room's name as the user says it, e.g. "Living room" or "Mia's room".`),
    level: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('The Level the Room is on, by name or slug ("Ground" or "ground").'),
  }),
  readOnly: false,
  surface: "agent",
  handler(context, input) {
    const { store } = context;
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const levels = store.levels(home.id);
    const level = input.level === undefined ? groundLevel(levels) : findLevel(levels, input.level);
    if (!level) {
      throw new CoreError(
        "not_found",
        `This Home has no Level "${input.level}". Its Levels are ${list(levels)}. Pass one of ` +
          "those, or leave `level` out for the ground Level. Levels can't be added yet.",
      );
    }
    const existing = store.rooms(home.id).find((room) => sameName(room.name, input.name));

    const line = context.write(session.slug, (log): ReceiptLine => {
      if (!existing) {
        const slug = uniqueSlug(input.name, "room", (taken) =>
          store.slugTaken("rooms", taken, home.id),
        );
        const room = store.insertRoom({
          homeId: home.id,
          levelId: level.id,
          slug,
          name: input.name,
        });
        log({
          home,
          recordKind: "room",
          record: room,
          new: { name: room.name, level: level.slug },
        });
        return { change: "room_created", room, level: level.name };
      }
      if (existing.levelId === level.id) {
        return { change: "room_unchanged", room: existing, level: level.name };
      }
      const from = levels.find((candidate) => candidate.id === existing.levelId);
      store.setRoomLevel(existing.id, level.id);
      log({
        home,
        recordKind: "room",
        record: existing,
        field: "level",
        old: from?.slug,
        new: level.slug,
      });
      return { change: "room_moved", room: existing, from: from?.name ?? "?", to: level.name };
    });
    return { receipt: renderReceipt([line]) };
  },
  text: ({ receipt }) => receipt,
});

export const getRoomSheet = defineOperation({
  name: "get_room_sheet",
  description:
    "Returns the Room Sheet: everything recorded about one Room of this Home. Fetch it the " +
    "first time the Session's work touches a Room, or when the user asks what is recorded about " +
    "it; don't fetch every Room up front, since the opening already lists them all. For now a " +
    "Room holds only its name and Level; its Walls, Windows, Doors, Features, Surfaces, and " +
    "Items join the sheet later. Changes nothing.",
  input: z.object({
    session: sessionInput,
    room: z
      .string()
      .trim()
      .min(1)
      .describe('The Room\'s slug as the opening lists it ("living-room"); its name also works.'),
  }),
  readOnly: true,
  surface: "agent",
  handler(context, input) {
    const { store } = context;
    const home = requireHome(context);
    requireSession(context, home, { open: false });
    const rooms = store.rooms(home.id);
    const room = findRoom(rooms, input.room);
    if (!room) {
      throw new CoreError(
        "not_found",
        rooms.length === 0
          ? `This Home has no Room "${input.room}": it has no Rooms recorded yet.`
          : `This Home has no Room "${input.room}". Its Rooms are ${list(rooms)}.`,
      );
    }
    const level = store.levels(home.id).find((candidate) => candidate.id === room.levelId);
    if (!level) throw new Error(`Room ${room.slug} is on a Level its Home does not have`);
    return { sheet: renderRoomSheet({ room, level }) };
  },
  text: ({ sheet }) => sheet,
});

/** Storey 0, which create_home always adds; the lowest Level if it was ever missing. */
function groundLevel(levels: LevelRow[]): LevelRow | undefined {
  return levels.find((level) => level.storey === 0) ?? levels[0];
}

function findLevel(levels: LevelRow[], wanted: string): LevelRow | undefined {
  return levels.find((level) => level.slug === wanted || sameName(level.name, wanted));
}

function findRoom(rooms: RoomRow[], wanted: string): RoomRow | undefined {
  return (
    rooms.find((room) => room.slug === wanted) ?? rooms.find((room) => sameName(room.name, wanted))
  );
}

function sameName(a: string, b: string): boolean {
  const normal = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  return normal(a) === normal(b);
}

function list(records: { name: string; slug: string }[]): string {
  return records.map((record) => `${record.name} (${record.slug})`).join(", ");
}
