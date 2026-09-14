const MAX_LENGTH = 60;

/**
 * The kebab-case slug for a name: accents dropped, lowercase, every run of other characters one
 * hyphen ("Mia's room" → "mias-room"). `fallback` stands in when nothing of the name survives.
 */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed =
    slug.length > MAX_LENGTH ? slug.slice(0, MAX_LENGTH).replace(/-+[^-]*$/, "") : slug;
  return trimmed || fallback;
}

/**
 * A slug for a new record that no existing record of its kind in the Home has: the name's slug,
 * or that slug with -2, -3… appended. Slugs are assigned once and never changed.
 */
export function uniqueSlug(
  name: string,
  fallback: string,
  isTaken: (slug: string) => boolean,
): string {
  const base = slugify(name, fallback);
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
}
