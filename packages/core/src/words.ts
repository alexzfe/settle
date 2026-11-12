// The words of a search, as search_notes and find_items match them.

/** Lowercase words without accents, so "Café" finds "cafe". */
export function tokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
}
