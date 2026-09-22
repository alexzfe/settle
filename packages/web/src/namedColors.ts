// A color recorded only as a word, with no approximate hex, still gets a filled square: "silver"
// and "terracotta" are worth seeing at a glance down a list of Items. The fill comes from the word
// alone, so it is a rough likeness, never a recorded fact — whatever shows it says so in its
// tooltip, and a Palette's large chips keep their placeholder, since a paint color is judged from
// the chip itself.

/** The words, at the shade the word alone suggests. Modifiers are applied on top of these. */
const NAMED: Record<string, string> = {
  white: "#f3f2ee",
  "off-white": "#efeae0",
  cream: "#f0e7d5",
  ivory: "#f2ead9",
  beige: "#e0d6c2",
  oatmeal: "#ded3bd",
  sand: "#d9c6a4",
  greige: "#cdc4b6",
  taupe: "#a4988b",
  linen: "#e8e1d4",
  grey: "#9b9b98",
  silver: "#c5c9cb",
  chrome: "#ccd1d5",
  steel: "#8d949b",
  stainless: "#b4bac0",
  charcoal: "#3c3d3f",
  black: "#1c1b1a",
  brown: "#6b4f36",
  tan: "#a9825c",
  camel: "#b18f62",
  caramel: "#a86f3c",
  chocolate: "#4a3526",
  walnut: "#5c4433",
  oak: "#c0a072",
  pine: "#d4b98a",
  teak: "#9c6f43",
  terracotta: "#b5643c",
  rust: "#a6522c",
  clay: "#b07a5e",
  brick: "#9c4f3c",
  red: "#a53c30",
  pink: "#d6a2a2",
  orange: "#c8763a",
  peach: "#e0b193",
  yellow: "#d4b23f",
  mustard: "#c09a2b",
  gold: "#b8963f",
  brass: "#b08d57",
  bronze: "#8c6a45",
  copper: "#a9613c",
  green: "#4f6b4a",
  olive: "#6b6b3f",
  sage: "#9aa88f",
  mint: "#a8c9b4",
  teal: "#3f6b6b",
  blue: "#47607d",
  navy: "#2c3a4e",
  sky: "#9dbcd4",
  denim: "#4a6480",
  purple: "#6b4f7a",
  lilac: "#b9a6c9",
  lavender: "#c2b6d4",
  burgundy: "#6b2f38",
  plum: "#6b3f52",
};

/** How much a word in front moves the color, towards white above 0 and towards black below. */
const MODIFIERS: Record<string, number> = {
  pale: 0.5,
  light: 0.38,
  soft: 0.28,
  warm: 0,
  cool: 0,
  matt: 0,
  matte: 0,
  gloss: 0,
  glossy: 0,
  bright: 0,
  medium: 0,
  mid: 0,
  deep: -0.32,
  dark: -0.38,
  very: 0,
};

/**
 * The name as the lookup reads it: lower case, the first part of "brown (café), matt", British and
 * American grey both, and a hyphen as a space except in "off-white".
 */
function normalise(name: string): string[] {
  const [first = ""] = name.toLowerCase().split(",");
  return first
    .replace(/\([^)]*\)/g, " ")
    .replace(/(?<!off)-/g, " ")
    .replace(/\bgray\b/g, "grey")
    .split(/\s+/)
    .filter(Boolean);
}

/** `hex` moved `amount` of the way towards white (positive) or black (negative). */
function shade(hex: string, amount: number): string {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const towards = amount > 0 ? 255 : 0;
  const moved = channels.map((value) =>
    Math.round(value + (towards - value) * Math.abs(amount))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${moved.join("")}`;
}

/**
 * An approximate color for a color name, or undefined when the name is not a word this knows:
 * "dark grey" is grey moved towards black, "brown (café), matt" is brown, "Setting Plaster" is
 * nothing, since a paint name says nothing about its color.
 */
export function namedColorHex(name: string): string | undefined {
  const words = normalise(name);
  for (const [at, word] of words.entries()) {
    const base = NAMED[word];
    if (base === undefined) continue;
    // Only the words in front of the color word shade it: "dark grey", never "grey, darkened".
    const amount = words.slice(0, at).reduce((total, word) => total + (MODIFIERS[word] ?? 0), 0);
    return amount === 0 ? base : shade(base, Math.max(-0.7, Math.min(0.7, amount)));
  }
  return undefined;
}
