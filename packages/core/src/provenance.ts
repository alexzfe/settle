import type { Color, Measurement, Provenance } from "./operations/schemas.js";

// The Provenance rule, which the server enforces rather than trusting the Skills to: a value is
// never replaced by one of weaker Provenance (measured > blueprint > listed > estimated) unless the
// user says so. A refused write is not stored and says why. The user's say-so travels as a
// non-empty override reason, quoting them, and is logged; it exists because the stronger value can
// be wrong (a mis-typed measurement, a wall that has since changed). Only an Item's sizes and
// colors are ever Listed: the maker's or shop's figures.

const STRENGTH: Record<Provenance, number> = { estimated: 0, listed: 1, blueprint: 2, measured: 3 };

/**
 * What to do with an incoming value: store it ("set"), leave the record as it is ("unchanged",
 * also when a weaker source repeats the same value), refuse it ("refused"), or store it over a
 * stronger one because the user said so ("overridden").
 */
export type Weighing = "set" | "unchanged" | "refused" | "overridden";

export function weigh<V extends { provenance: Provenance }>(
  existing: V | null | undefined,
  incoming: V,
  sameValue: (a: V, b: V) => boolean,
  override: boolean,
): Weighing {
  if (!existing) return "set";
  if (STRENGTH[incoming.provenance] >= STRENGTH[existing.provenance]) {
    return equal(existing, incoming) ? "unchanged" : "set";
  }
  if (sameValue(existing, incoming)) return "unchanged";
  return override ? "overridden" : "refused";
}

export const sameLength = (a: Measurement, b: Measurement): boolean => a.mm === b.mm;

/** The same color: the same name, maker, and code, in any case. */
export const sameColor = (a: Color, b: Color): boolean =>
  [a.name, a.brand, a.code].map(normal).join("|") ===
  [b.name, b.brand, b.code].map(normal).join("|");

const normal = (text: string | undefined) => (text ?? "").trim().toLowerCase();

/** Deep equality of JSON-shaped values, whatever the order of their keys. */
export function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, each]) => each !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, each]) => `${JSON.stringify(key)}:${canonical(each)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
