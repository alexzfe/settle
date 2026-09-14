import type { z } from "zod";
import { CoreError } from "../errors.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { type FieldChange, named, renderItems } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { ItemRow, RoomRow } from "../store.js";
import { active, requireRoom, requireSources, requireWall } from "./lookup.js";
import { type HomeModel, loadHome, roomById, toItem, wallSlug } from "./model.js";
import {
  type FindItemsResult,
  findItemsInput,
  type itemInput,
  type ListItemsResult,
  listItemsInput,
  type ReceiptResult,
  saveItemsInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { given, Writer } from "./writer.js";

type ItemIn = z.output<typeof itemInput>;

export const saveItems = defineOperation({
  name: "save_items",
  description:
    "Records several Items the user owns, or changes them, and returns a receipt with one line " +
    "per change. An Item is something the user would take with them on moving out: furniture, " +
    "decor, an appliance, a lamp, a rug, a plant. Parts of the building that stay (a radiator, a " +
    "fitted wardrobe, a ceiling light point) are Features of a Room, saved with save_room. Save " +
    "only Items the user has confirmed. To add an Item give its name and category; to change one " +
    "give its slug in `item` (find_items and the Room Sheet list them) and only the fields that " +
    "change. An Item with no Room is Unplaced (boxed, or in off-site storage). Identical pieces " +
    "are one Item with a quantity (six dining chairs). An Item that is sold, broken, given away, " +
    "or replaced is Archived with archive: true and a reason, never deleted. Sizes are whole " +
    "millimetres with a Provenance: measured, blueprint, or estimated; colors carry one too. A " +
    "value is never replaced by one of weaker Provenance (measured > blueprint > estimated) " +
    "unless the user says so: that part is refused, the receipt states both values, and only if " +
    "the user agrees do you call again with overrideProvenance quoting their words. Needs the " +
    "open Session's id as `session`.",
  input: saveItemsInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    requireSources(context.store, home, input);
    const receipt = context.write(session.slug, (log) => {
      const model = loadHome(context.store, home);
      const writer = new Writer(context.store, home, log, input.overrideProvenance);
      for (const item of input.items) saveItem(context, model, writer, item);
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

export const findItems = defineOperation({
  name: "find_items",
  description:
    "Lists Items of this Home, one line each: name and slug, category, where it is (its Room " +
    "and Wall, or Unplaced), size, colors, materials, and condition. Values marked ~ are " +
    "Estimated. Filter by Room, by Unplaced, by category, or by text; with no filter it lists " +
    "the whole Inventory. Archived Items (sold, broken, replaced) are left out unless `archived` " +
    "is true. Use it to find an Item outside the Room being worked on, instead of fetching more " +
    "Room Sheets. Changes nothing.",
  input: findItemsInput,
  readOnly: true,
  surface: "agent",
  handler(context, input): FindItemsResult {
    const home = requireHome(context);
    requireSession(context, home, { open: false });
    const model = loadHome(context.store, home);
    const room =
      input.room === undefined ? undefined : requireRoom(model, input.room, { archived: true });
    const words = input.text?.toLowerCase();
    const items = inventoryOrder(model, input.archived === true).filter(
      (item) =>
        (room === undefined || item.roomId === room.id) &&
        (input.unplaced !== true || item.roomId === null) &&
        (input.category === undefined || item.category === input.category) &&
        (words === undefined || searchText(item).includes(words)),
    );
    return { items: items.map((item) => toItem(model, item)) };
  },
  text: ({ items }) => renderItems(items),
});

export const listItems = defineOperation({
  name: "list_items",
  description:
    "The Home's Inventory, by Room with the Unplaced Items last; Archived ones on request.",
  input: listItemsInput,
  readOnly: true,
  surface: "web",
  handler(context, input): ListItemsResult {
    const model = loadHome(context.store, requireHome(context));
    return {
      items: inventoryOrder(model, input.archived === true).map((item) => toItem(model, item)),
    };
  },
});

function saveItem(
  context: OperationContext,
  model: HomeModel,
  writer: Writer,
  input: ItemIn,
): void {
  const existing = input.item === undefined ? undefined : requireItem(model, input.item);
  if (input.room !== undefined && input.unplaced) {
    throw new CoreError("validation", "Give an Item either a `room` or unplaced: true, not both.");
  }
  const named_room = input.room === undefined ? undefined : requireRoom(model, input.room);
  const currentRoom =
    existing?.roomId === null || existing === undefined
      ? undefined
      : roomById(model, existing.roomId);
  const room: RoomRow | undefined = input.unplaced ? undefined : (named_room ?? currentRoom);
  if (input.wall !== undefined && !room) {
    throw new CoreError(
      "validation",
      "An Item's `wall` is a Wall of its Room: give the `room` too.",
    );
  }
  const wall = input.wall === undefined || !room ? undefined : requireWall(model, room, input.wall);
  const values = {
    name: input.name,
    category: input.category,
    quantity: input.quantity,
    positionNote: input.positionNote,
    width: input.width,
    depth: input.depth,
    height: input.height,
    colors: input.colors,
    materials: input.materials,
    condition: input.condition,
    brand: input.brand,
    model: input.model,
    price: input.price,
    link: input.link,
    light: input.light,
  };

  if (!existing) {
    if (!input.name || !input.category) {
      throw new CoreError(
        "validation",
        "To add an Item, give its name and category. To change a recorded one, give its slug " +
          "as `item`.",
      );
    }
    const slug = uniqueSlug(input.name, "item", (taken) =>
      context.store.slugTaken("items", taken, model.home.id),
    );
    const created = writer.create(
      "items",
      "item",
      {
        homeId: model.home.id,
        slug,
        name: input.name,
        category: input.category,
        quantity: input.quantity ?? 1,
        roomId: room?.id ?? null,
        wallId: wall?.id ?? null,
        positionNote: values.positionNote ?? null,
        width: values.width ?? null,
        depth: values.depth ?? null,
        height: values.height ?? null,
        colors: values.colors ?? null,
        materials: values.materials ?? null,
        condition: values.condition ?? null,
        brand: values.brand ?? null,
        model: values.model ?? null,
        price: values.price ?? null,
        link: values.link ?? null,
        light: values.light ?? null,
        archivedAt: null,
        archivedReason: null,
        replacedByItemId: null,
      },
      { ...values, room: room?.slug, wall: wall?.slug },
    );
    model.items.push(created);
    const { name: _, ...shown } = values;
    writer.line(
      named(created),
      room ? `added in ${named(room)}` : "added as Unplaced",
      given({ ...shown, wall: wall?.slug }),
    );
    return;
  }

  const subject = named({ name: input.name ?? existing.name, slug: existing.slug });
  const fields: FieldChange[] = [];
  if ((room?.id ?? null) !== existing.roomId) {
    writer.link(
      "items",
      "item",
      existing,
      { roomId: room?.id ?? null, wallId: wall?.id ?? null },
      "room",
      { old: currentRoom?.slug ?? "unplaced", new: room?.slug ?? "unplaced" },
    );
    fields.push(room ? { field: "room", value: named(room) } : { field: "unplaced", value: true });
    if (wall) fields.push({ field: "wall", value: wall.slug });
  } else if (wall) {
    fields.push(
      ...writer.link("items", "item", existing, { wallId: wall.id }, "wall", {
        old: existing.wallId === null ? undefined : wallSlug(model, existing.wallId),
        new: wall.slug,
      }),
    );
  }
  fields.push(...writer.patch("items", "item", existing, subject, values));
  const done =
    input.archive === undefined
      ? undefined
      : writer.archive(
          "items",
          "item",
          existing,
          input.archive,
          context.now(),
          input.archiveReason,
        );
  writer.line(subject, done, fields);
}

function requireItem(model: HomeModel, slug: string): ItemRow {
  const item = model.items.find((each) => each.slug === slug);
  if (item) return item;
  throw new CoreError(
    "not_found",
    `This Home has no Item "${slug}". find_items lists the Items with their slugs; leave out ` +
      "`item` to add a new one.",
  );
}

/** Items by the order of their Rooms, Unplaced ones last, each Room's in the order recorded. */
function inventoryOrder(model: HomeModel, archived: boolean): ItemRow[] {
  const order = new Map(model.rooms.map((room, index) => [room.id, index]));
  const place = (item: ItemRow) =>
    item.roomId === null ? model.rooms.length : (order.get(item.roomId) ?? model.rooms.length);
  return model.items
    .filter((item) => archived || active(item))
    .sort((a, b) => place(a) - place(b) || a.id - b.id);
}

function searchText(item: ItemRow): string {
  return [
    item.name,
    item.brand,
    item.model,
    item.positionNote,
    item.category,
    ...(item.materials ?? []),
    ...(item.colors ?? []).map((color) => color.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
