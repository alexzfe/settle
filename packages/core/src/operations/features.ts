import type { z } from "zod";
import { CoreError } from "../errors.js";
import type { OperationContext } from "../registry.js";
import { featureName, named } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { FeatureRow, RoomRow } from "../store.js";
import { requireWall } from "./lookup.js";
import type { HomeModel } from "./model.js";
import type { featureInput } from "./schemas.js";
import { given, type Writer } from "./writer.js";

// Adding a Feature to a Room: save_room's new Features, and a Feature a Purchase bought.

type FeatureIn = z.output<typeof featureInput>;

/** Adds a Feature to a Room and returns it, with a receipt line. */
export function addFeature(
  context: OperationContext,
  model: HomeModel,
  writer: Writer,
  room: RoomRow,
  input: FeatureIn,
): FeatureRow {
  if (!input.kind) {
    throw new CoreError(
      "validation",
      "To add a Feature, give its `kind`. For something the kinds don't cover, use " +
        '"other" with a description.',
    );
  }
  if (input.kind === "other" && !input.description) {
    throw new CoreError("validation", 'A Feature of kind "other" needs a description.');
  }
  const wall = input.wall === undefined ? undefined : requireWall(model, room, input.wall);
  const values = {
    description: input.description,
    positionNote: input.positionNote,
    width: input.width,
    height: input.height,
    depth: input.depth,
    light: input.light,
  };
  const name = featureName(input.kind, input.description);
  const slug = uniqueSlug(`${room.slug} ${name}`, "feature", (taken) =>
    context.store.slugTaken("features", taken, model.home.id),
  );
  const created = writer.create(
    "features",
    "feature",
    {
      homeId: model.home.id,
      roomId: room.id,
      slug,
      kind: input.kind,
      description: values.description ?? null,
      wallId: wall?.id ?? null,
      positionNote: values.positionNote ?? null,
      width: values.width ?? null,
      height: values.height ?? null,
      depth: values.depth ?? null,
      light: values.light ?? null,
      archivedAt: null,
      archivedReason: null,
      replacedByFeatureId: null,
    },
    { room: room.slug, wall: wall?.slug, kind: input.kind, ...values },
  );
  model.features.push(created);
  writer.line(named({ name, slug }), "added", given({ wall: wall?.slug, ...values }));
  return created;
}
