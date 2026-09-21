// The find box's matcher and ranking, run in the browser on every keystroke over the whole index.
// Only a row's own name is matched, never its breadcrumb, label, or state: matching the Room in the
// breadcrumb would bring up all of a Room's Items whenever part of the Room's name was typed.

import type { FindRow } from "../api";

/** Lower case with accents stripped, so "bano" finds "Baño". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The typed words, folded. */
export function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** How well a name matched every typed word, the best first; undefined if a word is missing. */
export type Fit = "exact" | "starts" | "inside";

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * How `name` fits the typed `words`, each an unfinished prefix, in any order: "exact" when the
 * whole name is what was typed, "starts" when every word begins a word of the name, "inside" when
 * some word only matches within one, and undefined when any word is not in the name at all.
 */
export function fit(name: string, words: readonly string[]): Fit | undefined {
  if (words.length === 0) return undefined;
  const folded = fold(name);
  if (folded.split(/\s+/).filter(Boolean).join(" ") === words.join(" ")) return "exact";
  let everyAtStart = true;
  for (const word of words) {
    const at = matchAt(folded, word);
    if (at === undefined) return undefined;
    if (at === "inside") everyAtStart = false;
  }
  return everyAtStart ? "starts" : "inside";
}

/** Where `word` first begins a word of `folded`, else whether it appears inside one. */
function matchAt(folded: string, word: string): "start" | "inside" | undefined {
  let found = false;
  for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
    if (at === 0 || !WORD_CHAR.test(folded.charAt(at - 1))) return "start";
    found = true;
  }
  return found ? "inside" : undefined;
}

/**
 * The rows matching `query`, best first: an exact name above everything, then retired rows
 * (Archived, Rejected) always last, then tier 1 above tier 2, then word-start matches above
 * mid-word ones, then the most recently changed. An empty query lists the Rooms, retired last.
 */
export function find(rows: readonly FindRow[], query: string): FindRow[] {
  const words = queryWords(query);
  if (words.length === 0) {
    return rows.filter((row) => row.kind === "room").toSorted(byRetired);
  }
  const matched: { row: FindRow; fit: Fit }[] = [];
  for (const row of rows) {
    const rowFit = fit(row.name, words);
    if (rowFit) matched.push({ row, fit: rowFit });
  }
  return matched
    .toSorted(
      (a, b) =>
        Number(b.fit === "exact") - Number(a.fit === "exact") ||
        byRetired(a.row, b.row) ||
        a.row.tier - b.row.tier ||
        Number(a.fit === "inside") - Number(b.fit === "inside") ||
        Date.parse(b.row.changedAt) - Date.parse(a.row.changedAt) ||
        0,
    )
    .map(({ row }) => row);
}

function byRetired(a: FindRow, b: FindRow): number {
  return Number(a.retired) - Number(b.retired);
}
