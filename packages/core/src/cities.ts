import { readFileSync } from "node:fs";
import { join } from "node:path";

// One level up from both src/ and dist/. Rows: name, country code, latitude (0.1°), population.
const CITIES_FILE = join(import.meta.dirname, "..", "data", "cities15000.tsv");

// Names people type for a country that are not the English name of its ISO code.
const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  usa: "US",
  "united states of america": "US",
};

interface City {
  latitude: number;
  population: number;
}

let loaded: { cities: Map<string, City>; countries: Map<string, string> } | undefined;

/**
 * The latitude of `city` in `country` from the bundled GeoNames cities15000 table, rounded to
 * 0.1°, or undefined when the table has no such city. `country` is an ISO code ("GB") or an
 * English name ("United Kingdom"); names match without regard to case or accents, and of
 * several cities with one name the most populous wins.
 */
export function cityLatitude(country: string, city: string): number | undefined {
  const table = load();
  const code = countryCode(country);
  if (!code) return undefined;
  return table.cities.get(`${code}\t${fold(city)}`)?.latitude;
}

/** The ISO 3166 code for a country code or English country name the city table knows. */
export function countryCode(country: string): string | undefined {
  const table = load();
  const trimmed = country.trim();
  if (/^[a-z]{2}$/i.test(trimmed) && table.countries.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  const folded = fold(trimmed);
  return COUNTRY_ALIASES[folded] ?? table.countries.get(folded);
}

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function load(): NonNullable<typeof loaded> {
  if (loaded) return loaded;
  const cities = new Map<string, City>();
  const codes = new Set<string>();
  for (const line of readFileSync(CITIES_FILE, "utf8").split("\n")) {
    const [name, code, latitude, population] = line.split("\t");
    if (!name || !code || !latitude) continue;
    codes.add(code);
    const key = `${code}\t${fold(name)}`;
    const city = { latitude: Number(latitude), population: Number(population) };
    const current = cities.get(key);
    if (!current || city.population > current.population) cities.set(key, city);
  }
  // Codes map to themselves (for the code check) and English names map to codes.
  const countries = new Map<string, string>();
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  for (const code of codes) {
    countries.set(code, code);
    const name = names.of(code);
    if (name) countries.set(fold(name), code);
  }
  loaded = { cities, countries };
  return loaded;
}
