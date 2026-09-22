import type { z } from "zod";
import { daylightOpenings } from "../daylight.js";
import { CoreError } from "../errors.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { type FieldChange, featureName, named, renderRoomSheet } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { DoorRow, RoomRow, WallRow } from "../store.js";
import { loadDecisions, roomDecisions } from "./decisions.js";
import { addFeature } from "./features.js";
import {
  active,
  findLevel,
  groundLevel,
  list,
  requireRoom,
  requireSources,
  requireWall,
} from "./lookup.js";
import { type HomeModel, loadHome, roomById, roomDetail, toItem, wallSlug } from "./model.js";
import {
  type doorInput,
  type featureInput,
  type GetRoomResult,
  type GetRoomSheetResult,
  getRoomInput,
  getRoomSheetInput,
  type ReceiptResult,
  SURFACE_PARTS,
  type SurfaceInput,
  type SurfacePart,
  saveRoomInput,
  type wallInput,
  type windowInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { saveSurface } from "./surfaces.js";
import { given, sameName, Writer } from "./writer.js";

type SaveRoom = z.output<typeof saveRoomInput>;
type WallIn = z.output<typeof wallInput>;
type WindowIn = z.output<typeof windowInput>;
type DoorIn = z.output<typeof doorInput>;
type FeatureIn = z.output<typeof featureInput>;

export const saveRoom = defineOperation({
  name: "save_room",
  description:
    "Records one Room of this Home, or changes it, with its Walls, Windows, Doors, Features, and " +
    "Surfaces, and returns a receipt: one line per change, any refused part with its reason, and " +
    "the Room's remaining Gaps (what advice still needs). A Room is a named space divided from " +
    "its neighbours by walls with doorways, whether or not a door hangs in them: an open-plan " +
    "kitchen and living area is one Room; a hallway, a staircase, or a balcony you can step onto " +
    "is a Room too; a built-in cupboard is a Feature. Pass `room` (its slug) to change a recorded " +
    "Room; without it, a Room with the same name is updated, never duplicated. Give only what the " +
    "user stated or confirmed: fields and parts left out stay as they are, and a part given with " +
    "archive: true is Archived (kept, out of the current state), never deleted. Walls go " +
    "clockwise from 1 and are named <room>/wall-<position>; Windows, Doors, and Features name " +
    "their Wall by its position, so add the Wall first or in the same call. A Door is shared by " +
    "the two Rooms it joins: naming otherRoom updates the Door that already joins them. Lengths " +
    "are whole millimetres with a Provenance: measured (the user measured it), blueprint " +
    "(printed on a Blueprint), or estimated (by eye, scaled off a drawing, or guessed); colors " +
    "carry one too. A value is never replaced by one of weaker Provenance (measured > blueprint " +
    "> estimated): that part is refused and the receipt states both values, with their " +
    "Provenance; a write with nothing else in it is refused as a whole. Tell the user both values " +
    "in one line and ask; only if they say to replace it, call again with overrideProvenance " +
    "quoting their words. Tell the user what the receipt says changed. Needs the open Session's " +
    "id as `session`; a closed Session is refused.",
  input: saveRoomInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const { store } = context;
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    requireSources(store, home, input);
    const receipt = context.write(session.slug, (log) => {
      const model = loadHome(store, home);
      const writer = new Writer(context, home, log, input.overrideProvenance);
      const parts = new RoomParts(
        context,
        model,
        writer,
        saveRoomRecord(context, model, writer, input),
      );
      for (const wall of input.walls ?? []) parts.wall(wall);
      for (const part of SURFACE_PARTS) {
        const surface = input.surfaces?.[part];
        if (surface) parts.surface(part, undefined, surface);
      }
      for (const window of input.windows ?? []) parts.window(window);
      for (const door of input.doors ?? []) parts.door(door);
      for (const feature of input.features ?? []) parts.feature(feature);

      const after = loadHome(store, home);
      const room = roomById(after, parts.room.id);
      // windowless means no Windows and no glazed Door leading out, so a recorded daylight opening
      // makes it false by definition. Clear it rather than keep a record that contradicts itself:
      // the Room Sheet renders the opening, and a stale flag would be invisible behind it.
      if (room.windowless && daylightOpenings(roomDetail(after, room)).length > 0) {
        writer.patch("rooms", "room", room, named(room), { windowless: false });
        room.windowless = false;
        writer.line(named(room), "no longer windowless: it has a recorded daylight opening");
      }
      if (writer.lines.length === 0 && writer.refused.length === 0) {
        const level = after.levels.find((each) => each.id === room.levelId);
        writer.line(named(room), `already recorded on ${level?.name ?? "?"}, nothing changed`);
      }
      const detail = roomDetail(after, room);
      return writer.receipt(room.archivedAt ? [] : [{ room: detail, gaps: detail.gaps }]);
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

export const getRoomSheet = defineOperation({
  name: "get_room_sheet",
  description:
    "Returns the Room Sheet: everything recorded about one Room of this Home: its functions, " +
    "ceiling height, and times of use; its Walls in clockwise order with their lengths, facings, " +
    "and what lies beyond; its Windows and Doors; its Surfaces (walls, ceiling, floor, " +
    "woodwork); its Features; its lights; one line per Item in it; one line per Decision about " +
    "it that is Candidate, Leaning, or Settled but not yet Fulfilled; and its Gaps. Values marked " +
    "~ are Estimated; an Item's values marked * are Listed, the maker's or shop's figures. Fetch it the first time the Session's work touches a Room, and not again: " +
    "the receipts of later writes keep your picture current. Don't fetch every Room up front; " +
    "the opening lists them all, and find_items finds an Item elsewhere. Values printed on a " +
    "Blueprint render plain; withSources adds after each one its Blueprint, page, and the text " +
    "exactly as printed, for when a question needs them. Changes nothing.",
  input: getRoomSheetInput,
  readOnly: true,
  surface: "agent",
  handler(context, input): GetRoomSheetResult {
    const home = requireHome(context);
    requireSession(context, home, { open: false });
    const model = loadDecisions(context.store, home);
    const room = requireRoom(model, input.room, { archived: true });
    return {
      sheet: renderRoomSheet(roomDetail(model, room), {
        sources: input.withSources === true,
        decisions: roomDecisions(model, room),
      }),
    };
  },
  text: ({ sheet }) => sheet,
});

export const getRoom = defineOperation({
  name: "get_room",
  description:
    "One Room with everything on its Room Sheet, for the Room page: its Candidate, Leaning, and " +
    "Settled-but-not-Fulfilled Decisions too, and its Archived Items after the live ones, marked " +
    "archivedAt, for the page's Show Archived switch.",
  input: getRoomInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetRoomResult {
    const model = loadDecisions(context.store, requireHome(context));
    const room =
      model.rooms.find((each) => each.slug === input.room) ??
      requireRoom(model, input.room, { archived: true });
    const detail = roomDetail(model, room);
    // The Room Sheet never shows Archived Items; the page keeps them behind a switch (Q9).
    const archived = model.items
      .filter((item) => item.roomId === room.id && !active(item))
      .map((item) => toItem(model, item));
    return {
      room: { ...detail, items: [...detail.items, ...archived] },
      decisions: roomDecisions(model, room),
    };
  },
});

/** Creates or changes the Room itself, and returns its row. */
function saveRoomRecord(
  context: OperationContext,
  model: HomeModel,
  writer: Writer,
  input: SaveRoom,
): RoomRow {
  const { home, levels } = model;
  const existing =
    input.room !== undefined
      ? requireRoom(model, input.room, { archived: true })
      : model.rooms.find((room) => active(room) && sameName(room.name, input.name));
  const level =
    input.level === undefined
      ? existing
        ? undefined
        : groundLevel(levels)
      : findLevel(levels, input.level);
  if (input.level !== undefined && !level) {
    throw new CoreError(
      "not_found",
      `This Home has no Level "${input.level}". Its Levels are ${list(levels)}. Pass one of ` +
        "those, leave `level` out for the ground Level, or add the Level with save_home first.",
    );
  }
  const values = {
    functions: input.functions,
    outdoor: input.outdoor,
    ceilingHeight: input.ceilingHeight,
    timesOfUse: input.timesOfUse,
    windowless: input.windowless,
  };

  if (!existing) {
    if (!level) throw new Error(`Home ${home.slug} has no Level`);
    const slug = uniqueSlug(input.name, "room", (taken) =>
      context.store.slugTaken("rooms", taken, home.id),
    );
    const room = writer.create(
      "rooms",
      "room",
      {
        homeId: home.id,
        levelId: level.id,
        slug,
        name: input.name,
        functions: values.functions ?? [],
        outdoor: values.outdoor ?? false,
        ceilingHeight: values.ceilingHeight ?? null,
        timesOfUse: values.timesOfUse ?? [],
        windowless: values.windowless ?? false,
        archivedAt: null,
        archivedReason: null,
      },
      { name: input.name, level: level.slug, ...values },
    );
    model.rooms.push(room);
    writer.line(named(room), `created on ${level.name}`, given(values));
    return room;
  }

  // Matched by name, the Room keeps its recorded spelling; named by slug, it takes the new name.
  const name = input.room !== undefined ? input.name : existing.name;
  const subject = named({ name, slug: existing.slug });
  const heads: string[] = [];
  if (level && level.id !== existing.levelId) {
    const from = levels.find((each) => each.id === existing.levelId);
    writer.link("rooms", "room", existing, { levelId: level.id }, "level", {
      old: from?.slug,
      new: level.slug,
    });
    heads.push(`moved from ${from?.name ?? "?"} to ${level.name}`);
  }
  const fields = writer.patch("rooms", "room", existing, subject, { name, ...values });
  if (input.archive === true && existing.archivedAt === null) {
    const holding = model.items.filter((item) => active(item) && item.roomId === existing.id);
    if (holding.length > 0) {
      throw new CoreError(
        "referenced_cannot_delete",
        `${subject} still holds ${list(holding)}. Move them first with save_items (to another ` +
          "Room, or unplaced: true), then archive the Room.",
      );
    }
  }
  if (input.archive !== undefined) {
    const done = writer.archive(
      "rooms",
      "room",
      existing,
      input.archive,
      context.now(),
      input.archiveReason,
    );
    if (done) heads.push(done);
  }
  writer.line(subject, heads.join("; ") || undefined, fields);
  return existing;
}

/** Saves the parts of one Room: Walls, Surfaces, Windows, Doors, and Features. */
class RoomParts {
  readonly context: OperationContext;
  readonly model: HomeModel;
  readonly writer: Writer;
  readonly room: RoomRow;

  constructor(context: OperationContext, model: HomeModel, writer: Writer, room: RoomRow) {
    this.context = context;
    this.model = model;
    this.writer = writer;
    this.room = room;
  }

  wall(input: WallIn): void {
    const { model, writer, room } = this;
    const beyond = this.#beyond(input.beyond);
    const existing = model.walls.find(
      (wall) => wall.roomId === room.id && wall.position === input.position,
    );
    const values = {
      length: input.length,
      facing: input.facing,
      label: input.label,
      obstruction: input.obstruction,
      deciduous: input.deciduous,
    };
    let wall: WallRow;
    if (!existing) {
      if (input.archive) {
        throw new CoreError(
          "not_found",
          `${named(room)} has no Wall ${input.position} to archive.`,
        );
      }
      const slug = `${room.slug}/wall-${input.position}`;
      wall = writer.create(
        "walls",
        "wall",
        {
          homeId: model.home.id,
          roomId: room.id,
          slug,
          position: input.position,
          length: values.length ?? null,
          facing: values.facing ?? null,
          beyondKind: beyond?.kind ?? "unknown",
          beyondRoomId: beyond?.room?.id ?? null,
          label: values.label ?? null,
          obstruction: values.obstruction ?? null,
          deciduous: values.deciduous ?? null,
          archivedAt: null,
        },
        { position: input.position, ...values, beyond: beyond?.label },
      );
      model.walls.push(wall);
      writer.line(slug, "added", given({ ...values, beyond: beyond?.shown }));
    } else {
      wall = existing;
      const fields: FieldChange[] = [];
      if (beyond) {
        fields.push(
          ...writer.link(
            "walls",
            "wall",
            wall,
            { beyondKind: beyond.kind, beyondRoomId: beyond.room?.id ?? null },
            "beyond",
            { old: this.#beyondLabel(wall), new: beyond.label, shown: beyond.shown },
          ),
        );
      }
      fields.push(...writer.patch("walls", "wall", wall, wall.slug, values));
      if (input.archive) this.#refuseIfHung(wall);
      // Saving a Wall's position again restores it if it was Archived.
      const done = writer.archive(
        "walls",
        "wall",
        wall,
        input.archive === true,
        this.context.now(),
      );
      writer.line(wall.slug, done, fields);
    }
    if (input.surface) this.surface("walls", wall, input.surface);
  }

  surface(part: SurfacePart, wall: WallRow | undefined, input: SurfaceInput): void {
    saveSurface(this.model, this.writer, this.room, part, wall, input);
  }

  window(input: WindowIn): void {
    const { model, writer, room } = this;
    const existing =
      input.window === undefined ? undefined : this.#own(model.windows, input.window, "Window");
    const wall =
      input.wall === undefined || input.wall === "roof"
        ? undefined
        : requireWall(model, room, input.wall);
    const values = {
      roofFacing: input.roofFacing,
      kind: input.kind,
      width: input.width,
      height: input.height,
      sillHeight: input.sillHeight,
      offset: input.offset,
      glass: input.glass,
    };
    if (!existing) {
      if (input.wall === undefined) {
        throw new CoreError(
          "validation",
          `To add a Window to ${named(room)}, give \`wall\`: the position of the Wall it is in, ` +
            'or "roof" for a skylight.',
        );
      }
      const slug = uniqueSlug(`${room.slug} window`, "window", (taken) =>
        this.context.store.slugTaken("windows", taken, model.home.id),
      );
      const kind = values.kind ?? (input.wall === "roof" ? "roof" : null);
      const created = writer.create(
        "windows",
        "window",
        {
          homeId: model.home.id,
          roomId: room.id,
          slug,
          wallId: wall?.id ?? null,
          roofFacing: values.roofFacing ?? null,
          kind,
          width: values.width ?? null,
          height: values.height ?? null,
          sillHeight: values.sillHeight ?? null,
          offset: values.offset ?? null,
          glass: values.glass ?? null,
          archivedAt: null,
        },
        { room: room.slug, wall: wall?.slug ?? "roof", ...values },
      );
      model.windows.push(created);
      writer.line(this.#windowSubject(created.slug, wall?.slug), "added", given(values));
      return;
    }
    const subject = this.#windowSubject(
      existing.slug,
      wall?.slug ??
        (input.wall === "roof" || existing.wallId === null
          ? undefined
          : wallSlug(model, existing.wallId)),
    );
    const fields: FieldChange[] = [];
    if (input.wall !== undefined) {
      fields.push(
        ...writer.link("windows", "window", existing, { wallId: wall?.id ?? null }, "wall", {
          old: existing.wallId === null ? "roof" : wallSlug(model, existing.wallId),
          new: wall?.slug ?? "roof",
        }),
      );
    }
    fields.push(...writer.patch("windows", "window", existing, subject, values));
    const done =
      input.archive === undefined
        ? undefined
        : writer.archive("windows", "window", existing, input.archive, this.context.now());
    writer.line(subject, done, fields);
  }

  door(input: DoorIn): void {
    const { model, writer, room } = this;
    const other = input.otherRoom === undefined ? undefined : requireRoom(model, input.otherRoom);
    if (other?.id === room.id) {
      throw new CoreError(
        "validation",
        `otherRoom names ${named(room)} itself; a Door joins two different Rooms.`,
      );
    }
    if (other && (input.sideB === "outside" || input.sideB === "unknown")) {
      throw new CoreError(
        "validation",
        `A Door with sideB "${input.sideB}" has no otherRoom. Leave out one of the two.`,
      );
    }
    const sideB = other ? (other.outdoor ? "outdoor-room" : "room") : input.sideB;

    let existing: DoorRow | undefined;
    let identified = false;
    if (input.door !== undefined) {
      existing = this.#own(model.doors, input.door, "Door");
    } else if (!input.newDoor) {
      const matches = model.doors.filter((door) =>
        !active(door)
          ? false
          : other
            ? joins(door, room.id, other.id)
            : door.roomAId === room.id &&
              door.roomBId === null &&
              door.sideBKind === (sideB ?? "unknown") &&
              (input.wall === undefined ||
                (door.wallAId !== null &&
                  requireWall(model, room, input.wall).id === door.wallAId)),
      );
      if (matches.length > 1) {
        throw new CoreError(
          "validation",
          `${matches.length} Doors join ${named(room)} and ${other ? named(other) : (sideB ?? "unknown")}: ` +
            `${matches.map((door) => door.slug).join(", ")}. Pass \`door\` with the slug of the ` +
            "one to change, or newDoor: true to add another.",
        );
      }
      existing = matches[0];
      identified = existing !== undefined;
    }

    const values = {
      clearWidth: input.clearWidth,
      height: input.height,
      offset: input.offset,
      glazed: input.glazed,
      noDoor: input.noDoor,
    };
    if (!existing) {
      if ((sideB === "room" || sideB === "outdoor-room") && !other) {
        throw new CoreError(
          "validation",
          `A Door to a ${sideB === "room" ? "Room" : "outdoor Room"} needs otherRoom, the slug of ` +
            "the Room on the other side.",
        );
      }
      const wall = input.wall === undefined ? undefined : requireWall(model, room, input.wall);
      if (!wall && !room.outdoor) {
        throw new CoreError(
          "validation",
          `To add a Door to ${named(room)}, give \`wall\`: the position of the Wall it is in. ` +
            "Add the Wall in `walls` in the same call if it is not recorded yet.",
        );
      }
      const otherWall = this.#otherWall(other, input.otherWall);
      const slug = uniqueSlug(
        `${room.slug} ${other?.slug ?? (sideB === "outside" ? "outside" : "")} door`,
        "door",
        (taken) => this.context.store.slugTaken("doors", taken, model.home.id),
      );
      const created = writer.create(
        "doors",
        "door",
        {
          homeId: model.home.id,
          slug,
          roomAId: room.id,
          wallAId: wall?.id ?? null,
          sideBKind: sideB ?? "unknown",
          roomBId: other?.id ?? null,
          wallBId: otherWall?.id ?? null,
          clearWidth: values.clearWidth ?? null,
          height: values.height ?? null,
          offset: values.offset ?? null,
          glazed: values.glazed ?? null,
          noDoor: values.noDoor ?? null,
          archivedAt: null,
        },
        {
          room: room.slug,
          wall: wall?.slug,
          sideB: sideB ?? "unknown",
          otherRoom: other?.slug,
          otherWall: otherWall?.slug,
          ...values,
        },
      );
      model.doors.push(created);
      writer.line(
        doorSubject(created.slug, other, sideB),
        "added",
        given({ wall: wall?.slug, otherWall: otherWall?.slug, ...values }),
      );
      return;
    }

    const door = existing;
    const sideA = door.roomAId === room.id;
    const roomA = roomById(model, door.roomAId);
    const currentOtherId = sideA ? door.roomBId : door.roomAId;
    const currentOther = currentOtherId === null ? undefined : roomById(model, currentOtherId);
    const target = other ?? currentOther;
    const subject = doorSubject(
      door.slug,
      target,
      target ? undefined : (input.sideB ?? door.sideBKind),
    );
    const fields: FieldChange[] = [];
    const slugOf = (id: number | null) => (id === null ? undefined : wallSlug(model, id));

    if (input.wall !== undefined) {
      const wall = requireWall(model, room, input.wall);
      const key = sideA ? "wallAId" : "wallBId";
      fields.push(
        ...writer.link("doors", "door", door, { [key]: wall.id }, "wall", {
          old: slugOf(door[key]),
          new: wall.slug,
        }),
      );
    }
    if (other && other.id !== currentOtherId) {
      if (!sideA) {
        throw new CoreError(
          "validation",
          `${door.slug} joins ${named(roomA)} to ${named(room)}; it can't be pointed at another ` +
            `Room from here. Save it from ${named(roomA)}, or archive it and add a new Door.`,
        );
      }
      fields.push(
        ...writer.link(
          "doors",
          "door",
          door,
          { roomBId: other.id, sideBKind: sideB, wallBId: null },
          "otherRoom",
          { old: currentOther?.slug ?? door.sideBKind, new: other.slug, shown: named(other) },
        ),
      );
    } else if (!other && input.sideB !== undefined && sideA && input.sideB !== door.sideBKind) {
      if (input.sideB === "room" || input.sideB === "outdoor-room") {
        throw new CoreError("validation", `A Door to a Room needs otherRoom, the Room's slug.`);
      }
      fields.push(
        ...writer.link(
          "doors",
          "door",
          door,
          { roomBId: null, sideBKind: input.sideB, wallBId: null },
          "otherRoom",
          { old: currentOther?.slug ?? door.sideBKind, new: input.sideB },
        ),
      );
    }
    if (input.otherWall !== undefined) {
      const wall = this.#otherWall(target, input.otherWall);
      const key = sideA ? "wallBId" : "wallAId";
      if (wall) {
        fields.push(
          ...writer.link("doors", "door", door, { [key]: wall.id }, "otherWall", {
            old: slugOf(door[key]),
            new: wall.slug,
          }),
        );
      }
    }
    if (values.offset && !sideA) {
      writer.refuse({
        subject,
        field: "offset",
        value: values.offset,
        reason:
          `a Door's offset runs along the Wall of the Room it was first recorded in, ` +
          `${named(roomA)}, so save it from there.`,
      });
      values.offset = undefined;
    }
    fields.push(...writer.patch("doors", "door", door, subject, values));
    const done =
      input.archive === undefined
        ? undefined
        : writer.archive("doors", "door", door, input.archive, this.context.now());
    const between = target
      ? `the existing Door between ${room.name} and ${target.name}`
      : "the existing Door";
    const head = identified
      ? fields.length > 0 || done
        ? `updated ${between}`
        : `${between} is already recorded like this, nothing changed`
      : undefined;
    writer.line(subject, [head, done].filter(Boolean).join("; ") || undefined, fields);
  }

  feature(input: FeatureIn): void {
    const { model, writer, room } = this;
    const existing =
      input.feature === undefined ? undefined : this.#own(model.features, input.feature, "Feature");
    const wall = input.wall === undefined ? undefined : requireWall(model, room, input.wall);
    const values = {
      kind: input.kind,
      description: input.description,
      positionNote: input.positionNote,
      width: input.width,
      height: input.height,
      depth: input.depth,
      light: input.light,
    };
    if (!existing) {
      addFeature(this.context, model, writer, room, input);
      return;
    }
    const subject = named({
      name: featureName(
        input.kind ?? existing.kind,
        input.description ?? existing.description ?? undefined,
      ),
      slug: existing.slug,
    });
    const fields: FieldChange[] = [];
    if (wall) {
      fields.push(
        ...writer.link("features", "feature", existing, { wallId: wall.id }, "wall", {
          old: existing.wallId === null ? undefined : wallSlug(model, existing.wallId),
          new: wall.slug,
        }),
      );
    }
    fields.push(...writer.patch("features", "feature", existing, subject, values));
    const done =
      input.archive === undefined
        ? undefined
        : writer.archive(
            "features",
            "feature",
            existing,
            input.archive,
            this.context.now(),
            input.archiveReason,
          );
    writer.line(subject, done, fields);
  }

  /** A record of this Room by slug. */
  #own<T extends { slug: string; roomId?: number; roomAId?: number; roomBId?: number | null }>(
    rows: T[],
    slug: string,
    noun: string,
  ): T {
    const { room } = this;
    const row = rows.find(
      (each) =>
        each.slug === slug &&
        (each.roomId === room.id || each.roomAId === room.id || each.roomBId === room.id),
    );
    if (row) return row;
    const own = rows.filter(
      (each) => each.roomId === room.id || each.roomAId === room.id || each.roomBId === room.id,
    );
    throw new CoreError(
      "not_found",
      `${named(room)} has no ${noun} "${slug}"` +
        (own.length > 0 ? `; its ${noun}s are ${own.map((each) => each.slug).join(", ")}.` : ".") +
        ` Leave out the slug to add a new ${noun}.`,
    );
  }

  #otherWall(other: RoomRow | undefined, position: number | undefined): WallRow | undefined {
    if (position === undefined) return undefined;
    if (!other) {
      throw new CoreError(
        "validation",
        "otherWall needs otherRoom: the Room that Wall belongs to.",
      );
    }
    return requireWall(this.model, other, position);
  }

  #beyond(
    beyond: string | undefined,
  ): { kind: WallRow["beyondKind"]; room?: RoomRow; label: string; shown: string } | undefined {
    if (beyond === undefined) return undefined;
    if (beyond === "outside" || beyond === "unknown") {
      return { kind: beyond, label: beyond, shown: beyond };
    }
    const room = requireRoom(this.model, beyond);
    if (room.id === this.room.id) {
      throw new CoreError(
        "validation",
        `beyond names ${named(room)} itself: give the Room on the other side of the Wall.`,
      );
    }
    return { kind: "room", room, label: room.slug, shown: named(room) };
  }

  #beyondLabel(wall: WallRow): string {
    return wall.beyondKind === "room" && wall.beyondRoomId !== null
      ? roomById(this.model, wall.beyondRoomId).slug
      : wall.beyondKind;
  }

  /** Archiving a Wall is refused while Windows, Doors, Features, or Items are on it. */
  #refuseIfHung(wall: WallRow): void {
    const { model } = this;
    const on = [
      ...model.windows
        .filter((each) => active(each) && each.wallId === wall.id)
        .map((each) => each.slug),
      ...model.doors
        .filter((each) => active(each) && (each.wallAId === wall.id || each.wallBId === wall.id))
        .map((each) => each.slug),
      ...model.features
        .filter((each) => active(each) && each.wallId === wall.id)
        .map((each) =>
          named({ name: featureName(each.kind, each.description ?? undefined), slug: each.slug }),
        ),
      ...model.items
        .filter((each) => active(each) && each.wallId === wall.id)
        .map((each) => named(each)),
    ];
    if (on.length > 0) {
      throw new CoreError(
        "referenced_cannot_delete",
        `${wall.slug} still has ${on.join(", ")} on it. Move or archive them first, then ` +
          "archive the Wall.",
      );
    }
  }

  #windowSubject(slug: string, wall: string | undefined): string {
    return `Window in ${wall ?? "the roof"} (${slug})`;
  }
}

function joins(door: DoorRow, a: number, b: number): boolean {
  return (door.roomAId === a && door.roomBId === b) || (door.roomAId === b && door.roomBId === a);
}

function doorSubject(slug: string, other: RoomRow | undefined, sideB: string | undefined): string {
  const to = other ? other.name : sideB === "outside" ? "outside" : "an unknown side";
  return `Door to ${to} (${slug})`;
}
