import type { z } from "zod";
import { CoreError } from "../errors.js";
import { featureName, named } from "../render.js";
import type { DecisionModel } from "./decisions.js";
import type { RequirementReasonKind, requirementReasonInput } from "./schemas.js";

// What a Requirement's reason points at: a Decision, a Constraint, a Note, or a recorded part of
// the Home (docs/specs/home-model.md#rules-the-home-model-owns), and optionally one field of it.

type ReasonIn = z.output<typeof requirementReasonInput>;

export interface ReasonRecord {
  id: number;
  slug: string;
  name: string;
  row: object;
}

/** The records a Requirement's reason of `kind` can point at, with a readable name each. */
export function reasonRecords(model: DecisionModel, kind: RequirementReasonKind): ReasonRecord[] {
  const bySlug = (rows: { id: number; slug: string }[]) =>
    rows.map((row) => ({ id: row.id, slug: row.slug, name: row.slug, row }));
  switch (kind) {
    case "home":
      return [{ id: model.home.id, slug: model.home.slug, name: model.home.name, row: model.home }];
    case "decision":
      return model.decisions.map((row) => ({ id: row.id, slug: row.slug, name: row.title, row }));
    case "constraint":
      return model.constraints.map((row) => ({ id: row.id, slug: row.slug, name: row.text, row }));
    case "note":
      return model.notes.map((row) => ({ id: row.id, slug: row.slug, name: row.text, row }));
    case "room":
      return model.rooms.map((row) => ({ id: row.id, slug: row.slug, name: row.name, row }));
    case "item":
      return model.items.map((row) => ({ id: row.id, slug: row.slug, name: row.name, row }));
    case "feature":
      return model.features.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: featureName(row.kind, row.description ?? undefined),
        row,
      }));
    case "wall":
      return bySlug(model.walls);
    case "window":
      return bySlug(model.windows);
    case "door":
      return bySlug(model.doors);
    case "surface":
      return bySlug(model.surfaces);
  }
}

/** The record a stored reason points at, if it is still in the Home. */
export function reasonRecord(
  model: DecisionModel,
  kind: RequirementReasonKind,
  id: number,
): ReasonRecord | undefined {
  return reasonRecords(model, kind).find((each) => each.id === id);
}

/** A reason as given, checked: the record must exist in this Home, and the field on it. */
export function resolveReason(
  model: DecisionModel,
  reason: ReasonIn,
): { kind: RequirementReasonKind; id: number; field: string | null } {
  const records = reasonRecords(model, reason.kind);
  if (reason.kind !== "home" && reason.id === undefined) {
    throw new CoreError(
      "validation",
      `A Requirement's ${reason.kind} reason needs its id: the ${reason.kind}'s slug.`,
    );
  }
  const record =
    reason.kind === "home"
      ? reason.id === undefined || reason.id === model.home.slug
        ? records[0]
        : undefined
      : records.find((each) => each.slug === reason.id);
  if (!record) {
    throw new CoreError(
      "not_found",
      `This Home has no ${reason.kind} "${reason.id}" for a Requirement's reason to point at.`,
    );
  }
  if (reason.field !== undefined && !(reason.field in record.row)) {
    throw new CoreError(
      "validation",
      `The ${reason.kind} ${record.slug} has no field "${reason.field}". Name one it records, ` +
        'e.g. "length" of a Wall, or leave field out when the whole record matters.',
    );
  }
  return { kind: reason.kind, id: record.id, field: reason.field ?? null };
}

/** A record a reason points at, as a line shows it: its slug, or its name and slug. */
export function recordName(record: ReasonRecord | undefined): string {
  if (record === undefined) return "?";
  return record.name === record.slug ? record.slug : named(record);
}

/** A Requirement's reason as a receipt shows it: "Wall living-room/wall-2, length". */
export function reasonLabel(
  model: DecisionModel,
  reason: { reasonKind: RequirementReasonKind; reasonId: number; reasonField: string | null },
): string {
  const what = recordName(reasonRecord(model, reason.reasonKind, reason.reasonId));
  const noun = reason.reasonKind.charAt(0).toUpperCase() + reason.reasonKind.slice(1);
  return `${noun} ${what}${reason.reasonField ? `, ${reason.reasonField}` : ""}`;
}
