import { CoreError } from "../errors.js";
import type { RecordKind } from "../events.js";
import { equal, sameColor, sameLength, weigh } from "../provenance.js";
import type { Change } from "../registry.js";
import {
  type FieldChange,
  isColor,
  isMeasurement,
  type Receipt,
  type ReceiptLine,
  type RefusedPart,
  renderReceipt,
  renderRefused,
} from "../render.js";
import type { HomeRow, HomeTables, Store } from "../store.js";
import type { Color } from "./schemas.js";

type Rows = HomeTables & { homes: HomeRow };
type Row = { id: number; slug: string };

/**
 * One Agent write, field by field: it applies the Provenance rule to every length and color,
 * logs every change, and collects the receipt's lines and refused parts.
 */
export class Writer {
  readonly lines: ReceiptLine[] = [];
  readonly refused: RefusedPart[] = [];
  /** Whether anything was stored. */
  changed = false;
  readonly #store: Store;
  readonly #home: HomeRow;
  readonly #log: (change: Change) => void;
  readonly #override: string | undefined;

  constructor(
    store: Store,
    home: HomeRow,
    log: (change: Change) => void,
    override: string | undefined,
  ) {
    this.#store = store;
    this.#home = home;
    this.#log = log;
    this.#override = override;
  }

  /** Adds a row and logs it as created, with `logged` as what the change log shows. */
  create<T extends keyof Rows>(
    table: T,
    recordKind: RecordKind,
    row: Omit<Rows[T], "id">,
    logged: Record<string, unknown>,
  ): Rows[T] {
    const created = this.#store.insert(table, row);
    this.#log({ home: this.#home, recordKind, record: created as Row, new: withoutEmpty(logged) });
    this.changed = true;
    return created;
  }

  /**
   * Stores the given fields of a row that differ from what it holds, and returns them as
   * receipt changes. A length or color that would replace a stronger one is refused, unless the
   * write carries overrideProvenance, and becomes a refused part of `subject`.
   */
  patch<T extends keyof Rows>(
    table: T,
    recordKind: RecordKind,
    row: Rows[T],
    subject: string,
    values: Partial<Rows[T]>,
  ): FieldChange[] {
    const changes: FieldChange[] = [];
    const update: Record<string, unknown> = {};
    const current = row as unknown as Record<string, unknown>;
    for (const [field, incoming] of Object.entries(values)) {
      if (incoming === undefined) continue;
      const old = current[field] ?? undefined;
      let next: unknown = incoming;
      let override = false;
      if (isMeasurement(incoming) || isColor(incoming)) {
        const weighing = isMeasurement(incoming)
          ? weigh(
              isMeasurement(old) ? old : null,
              incoming,
              sameLength,
              this.#override !== undefined,
            )
          : weigh(isColor(old) ? old : null, incoming, sameColor, this.#override !== undefined);
        if (weighing === "unchanged") continue;
        if (weighing === "refused") {
          this.refused.push({ subject, field, value: incoming, kept: old });
          continue;
        }
        override = weighing === "overridden";
      } else if (field === "colors") {
        next = this.#colors(subject, (old as Color[] | undefined) ?? [], incoming as Color[]);
        if (equal(old ?? [], next)) continue;
      } else if (equal(old ?? null, incoming)) {
        continue;
      }
      update[field] = next;
      this.#log({
        home: this.#home,
        recordKind,
        record: row as unknown as Row,
        field,
        old,
        new: next,
        ...(override && this.#override ? { reason: this.#override } : {}),
      });
      changes.push({ field, value: next, was: old, override });
    }
    if (Object.keys(update).length > 0) {
      this.#store.update(table, row.id, update as Partial<Rows[T]>);
      this.changed = true;
    }
    return changes;
  }

  /**
   * Points a row's links (Level, Room, or Wall ids) somewhere else when the labels differ,
   * logging and reporting the change by its labels (slugs) rather than by database ids.
   */
  link<T extends keyof Rows>(
    table: T,
    recordKind: RecordKind,
    row: Rows[T],
    patch: Partial<Rows[T]>,
    field: string,
    labels: { old?: string; new?: string; shown?: string },
  ): FieldChange[] {
    if (labels.old === labels.new) return [];
    this.#store.update(table, row.id, patch);
    this.#log({
      home: this.#home,
      recordKind,
      record: row as unknown as Row,
      field,
      old: labels.old,
      new: labels.new ?? null,
    });
    this.changed = true;
    return [{ field, value: labels.shown ?? labels.new ?? "none" }];
  }

  /** Archives a row, or with `archive` false restores it; returns what happened, if anything. */
  archive<T extends keyof Rows>(
    table: T,
    recordKind: RecordKind,
    row: Rows[T] & { archivedAt: string | null },
    archive: boolean,
    at: string,
    reason?: string,
  ): "archived" | "restored" | undefined {
    if (archive === (row.archivedAt !== null)) return undefined;
    const withReason = "archivedReason" in row;
    const patch = archive
      ? { archivedAt: at, ...(withReason ? { archivedReason: reason ?? null } : {}) }
      : { archivedAt: null, ...(withReason ? { archivedReason: null } : {}) };
    this.#store.update(table, row.id, patch as unknown as Partial<Rows[T]>);
    this.#log({
      home: this.#home,
      recordKind,
      record: row as unknown as Row,
      field: "archivedAt",
      old: row.archivedAt ?? undefined,
      new: archive ? at : null,
      ...(reason ? { reason } : {}),
    });
    this.changed = true;
    return archive ? "archived" : "restored";
  }

  /** Logs a change the operation made itself, such as removing a Level. */
  logged(change: Omit<Change, "home">): void {
    this.#log({ home: this.#home, ...change });
    this.changed = true;
  }

  line(subject: string, head: string | undefined, fields: FieldChange[] = []): void {
    if (head || fields.length > 0) this.lines.push({ subject, head, fields });
  }

  refuse(part: RefusedPart): void {
    this.refused.push(part);
  }

  /**
   * The rendered receipt. A write whose every proposed change was refused stores nothing and is
   * refused as a whole with weaker_provenance, so the Agent can't miss it.
   */
  receipt(gaps: Receipt["gaps"] = []): string {
    if (!this.changed && this.refused.length > 0) {
      throw new CoreError("weaker_provenance", this.refused.map(renderRefused).join("\n"));
    }
    return renderReceipt({ lines: this.lines, refused: this.refused, gaps });
  }

  /** An Item's colors, where a color named like a stronger recorded one can't replace it. */
  #colors(subject: string, old: Color[], incoming: Color[]): Color[] {
    return incoming.map((color) => {
      const match = old.find((each) => sameName(each.name, color.name));
      if (!match) return color;
      const weighing = weigh(match, color, sameColor, this.#override !== undefined);
      if (weighing === "refused") {
        this.refused.push({ subject, field: "color", value: color, kept: match });
        return match;
      }
      return weighing === "unchanged" ? match : color;
    });
  }
}

export function sameName(a: string, b: string): boolean {
  const normal = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  return normal(a) === normal(b);
}

/** The creation fields of a new record, for its receipt line: those with a value. */
export function given(values: Record<string, unknown>): FieldChange[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .map(([field, value]) => ({ field, value }));
}

function withoutEmpty(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null),
  );
}
