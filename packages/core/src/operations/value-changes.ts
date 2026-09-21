import type { Change } from "../registry.js";
import { featureName } from "../render.js";
import type { FeatureKind, RequirementReasonKind } from "./schemas.js";
import { REQUIREMENT_REASON_KINDS } from "./schemas.js";
import type { Writer } from "./writer.js";

// The value_changed flag (docs/specs/home-model.md#rules-the-home-model-owns): when a value a
// Requirement's reason points at changes, the platform flags the Purchase Decision. A reason
// naming a field is flagged by a change to that field only; one naming none by any change to its
// record. Archiving or restoring the record flags every reason on it, field or none. A Decision's
// record changes, for a reason naming no field, when its title, statement, or content does: its
// state changes already flag the Decisions resting on it. Likewise an Item's changes, except its
// register (docs/handoff/item-page.md): when and where it was bought, the price paid, its warranty,
// serial number, and manual say nothing about the thing a Requirement rests on, so typing a
// warranty date on the Item page doesn't flag every Purchase citing the Item. A reason naming one
// of those fields is still flagged by it.

const DECISION_FIELDS: ReadonlySet<string> = new Set(["title", "statement", "content"]);
const ITEM_REGISTER_FIELDS: ReadonlySet<string> = new Set([
  "boughtOn",
  "boughtFrom",
  "pricePaid",
  "warrantyUntil",
  "serialNumber",
  "manualLink",
]);

/** Whether a change to `field` of a record of `kind` flags a reason naming no field. */
const touchesRecord = (kind: string, field: string): boolean =>
  kind === "decision"
    ? DECISION_FIELDS.has(field)
    : !(kind === "item" && ITEM_REGISTER_FIELDS.has(field));

const isReasonKind = (kind: string): kind is RequirementReasonKind =>
  (REQUIREMENT_REASON_KINDS as readonly string[]).includes(kind);

/**
 * Flags every open Purchase with a Requirement not Archived whose reason points at a record one of
 * `changes` changed, once per record while its flag stays open. A Rejected or Fulfilled Purchase
 * is left alone, and so is a Decision's own change. Each flag becomes a line of the receipt.
 */
export function flagValueChanges(writer: Writer, changes: Change[], now: string): void {
  const changed = changes.filter(
    (change): change is Change & { field: string } =>
      change.field !== undefined && isReasonKind(change.recordKind),
  );
  if (changed.length === 0) return;
  const { store, home } = writer;
  const decisions = store.list("decisions", home.id);
  const flags = store.list("flags", home.id);
  const requirements = store
    .list("requirements", home.id)
    .filter((each) => each.archivedAt === null)
    .sort((a, b) => a.decisionId - b.decisionId || a.position - b.position);
  for (const requirement of requirements) {
    const decision = decisions.find((each) => each.id === requirement.decisionId);
    if (
      !decision ||
      decision.archivedAt !== null ||
      decision.state === "rejected" ||
      decision.fulfilledAt !== null
    ) {
      continue;
    }
    const change = changed.find(
      (each) =>
        each.recordKind === requirement.reasonKind &&
        each.record.id === requirement.reasonId &&
        !(each.recordKind === "decision" && each.record.id === decision.id) &&
        (each.field === "archivedAt" ||
          (requirement.reasonField !== null
            ? each.field === requirement.reasonField
            : touchesRecord(each.recordKind, each.field))),
    );
    if (!change) continue;
    const own = flags.filter((each) => each.decisionId === decision.id);
    const open = own.some(
      (each) =>
        each.clearedAt === null &&
        each.sourceKind === requirement.reasonKind &&
        each.sourceId === requirement.reasonId,
    );
    if (open) continue;
    const flag = writer.create(
      "flags",
      "flag",
      {
        homeId: home.id,
        decisionId: decision.id,
        slug: `${decision.slug}/flag-${own.length + 1}`,
        cause: "value_changed",
        sourceKind: requirement.reasonKind,
        sourceId: requirement.reasonId,
        sourceField: change.field,
        raisedAt: now,
        clearedAt: null,
        resolution: null,
        reason: null,
      },
      {
        decision: decision.slug,
        cause: "value_changed",
        source: change.record.slug,
        field: change.field,
      },
    );
    flags.push(flag);
    writer.flagged.push({
      decision: { name: decision.title, slug: decision.slug },
      source: { name: recordLabel(change.record), slug: change.record.slug },
      cause: "value_changed",
      field: change.field,
      requirement: requirement.position,
    });
  }
}

/** A changed record's readable name, from the row the change was logged with. */
function recordLabel(record: Change["record"]): string {
  const row = record as unknown as Record<string, unknown>;
  if (typeof row.kind === "string" && "replacedByFeatureId" in row) {
    return featureName(row.kind as FeatureKind, (row.description as string | null) ?? undefined);
  }
  for (const key of ["title", "name", "text"]) {
    if (typeof row[key] === "string") return row[key];
  }
  return record.slug;
}
