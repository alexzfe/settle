// How recorded values read on screen. Rules from docs/specs/home-model.md: lengths are stored in
// millimetres and shown in metres with two decimals (until the units setting exists), Estimated
// values carry a leading ~, and Measured and Blueprint values read plain.

import type { BlueprintSource, Provenance } from "@idh/core";

export interface Measure {
  mm: number;
  provenance: Provenance;
  /** Where on a Blueprint it is printed; with Blueprint Provenance only. */
  source?: BlueprintSource;
}

export interface ColorText {
  name: string;
  brand?: string;
  code?: string;
  provenance: Provenance;
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  measured: "Measured",
  blueprint: "Blueprint",
  estimated: "Estimated",
};

/** A Provenance, and for a value printed on a Blueprint where: "Blueprint p.2: 12'6"". */
export function provenanceText(provenance: Provenance, source?: BlueprintSource): string {
  if (provenance === "blueprint" && source) {
    return `${PROVENANCE_LABEL.blueprint} p.${source.page}: ${source.printed}`;
  }
  return PROVENANCE_LABEL[provenance];
}

function estimatedMark(provenance: Provenance): string {
  return provenance === "estimated" ? "~" : "";
}

/** Millimetres in metres with two decimals: 3600 is "3.60 m". */
export function metres(mm: number): string {
  // Rounded to whole centimetres first: 3505 mm / 1000 is 3.50499… in floating point.
  return `${(Math.round(mm / 10) / 100).toFixed(2)} m`;
}

/** A length in metres with two decimals, "~" in front when it is Estimated: "~3.60 m". */
export function formatLength(value: Measure): string {
  return `${estimatedMark(value.provenance)}${metres(value.mm)}`;
}

/** A color by name, with its maker and code when known: "~Setting Plaster (Farrow & Ball 231)". */
export function formatColor(color: ColorText): string {
  const maker = [color.brand, color.code].filter(Boolean).join(" ");
  return `${estimatedMark(color.provenance)}${color.name}${maker ? ` (${maker})` : ""}`;
}

/** A timestamp in the reader's locale. */
export function formatTime(at: string): string {
  return new Date(at).toLocaleString();
}

/** A date in the reader's locale. */
export function formatDate(at: string): string {
  return new Date(at).toLocaleDateString();
}

/** A fixed-list value or field name as words: "dim-to-warm", "art_and_mirrors", "sillHeight". */
export function words(value: string): string {
  return value
    .replace(/(?<=\p{Ll})(?=\p{Lu})/gu, " ")
    .replace(/_/g, " ")
    .replace(/(?<=\p{L})-(?=\p{L})/gu, " ")
    .toLowerCase();
}

/** `words`, starting with a capital: "Dim to warm". */
export function sentence(value: string): string {
  const text = words(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An 8-point compass direction: "n" and "NE" read "N" and "NE", "north-east" "North east". */
export function compass(direction: string): string {
  return direction.length <= 2 ? direction.toUpperCase() : sentence(direction);
}

/** A Level with its number: "Ground (Level 0)". */
export function levelTitle(level: { name: string; storey: number }): string {
  return `${level.name} (Level ${level.storey})`;
}

/** A Wall's name within its Room: position 1 is "Wall 1". */
export function wallName(position: number): string {
  return `Wall ${position}`;
}

/** A Wall's name from its slug: "living-room/wall-2" is "Wall 2". */
export function wallNameOf(slug: string): string {
  const position = /\/wall-(\d+)$/.exec(slug)?.[1];
  return position === undefined ? slug : wallName(Number(position));
}

export function isProvenance(value: unknown): value is Provenance {
  return typeof value === "string" && Object.hasOwn(PROVENANCE_LABEL, value);
}

function isMeasure(value: object): value is Measure {
  const { mm, provenance } = value as Record<string, unknown>;
  return typeof mm === "number" && isProvenance(provenance);
}

function isColor(value: object): value is ColorText {
  const { name, provenance } = value as Record<string, unknown>;
  return typeof name === "string" && isProvenance(provenance);
}

/**
 * An old or new value in the change log as text: lengths and colors read as they do on the pages,
 * with their Provenance; lists are joined; a record reads as "field: value" pairs.
 */
export function formatLogValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(formatLogValue).filter(Boolean).join(", ");
  if (isMeasure(value)) {
    return `${formatLength(value)} (${provenanceText(value.provenance, value.source)})`;
  }
  if (isColor(value)) return `${formatColor(value)} (${PROVENANCE_LABEL[value.provenance]})`;
  return Object.entries(value)
    .map(([field, fieldValue]) => [words(field), formatLogValue(fieldValue)])
    .filter(([, text]) => text !== "")
    .map(([field, text]) => `${field}: ${text}`)
    .join("; ");
}
