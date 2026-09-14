// Rebuilds data/cities15000.tsv from the GeoNames dump. Run with Node 26 (it strips types):
//   curl -O https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
//   node packages/core/scripts/build-cities.ts cities15000.txt
// Keeps the name, country code, latitude rounded to 0.1°, and population of each city, and only
// the most populous city of each name within a country, since create_home picks that one anyway.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("Usage: node build-cities.ts <path to cities15000.txt>");
  process.exit(1);
}

interface City {
  name: string;
  country: string;
  latitude: number;
  population: number;
}

const best = new Map<string, City>();
for (const line of readFileSync(source, "utf8").split("\n")) {
  if (!line) continue;
  const columns = line.split("\t");
  const city: City = {
    name: columns[1] ?? "",
    country: columns[8] ?? "",
    latitude: Number(columns[4]),
    population: Number(columns[14]),
  };
  if (!city.name || !city.country || !Number.isFinite(city.latitude)) continue;
  const key = `${city.country}\t${city.name}`;
  const current = best.get(key);
  if (!current || city.population > current.population) best.set(key, city);
}

const rows = [...best.values()]
  .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name))
  .map((city) => `${city.name}\t${city.country}\t${city.latitude.toFixed(1)}\t${city.population}`);

const target = join(import.meta.dirname, "..", "data", "cities15000.tsv");
writeFileSync(target, `${rows.join("\n")}\n`);
console.log(`Wrote ${rows.length} cities to ${target}`);
