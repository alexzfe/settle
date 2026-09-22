// A color as the pages show it, wherever a Palette, Surface, or Item color appears: an 18px square
// filled from its approximate hex, or an empty stone outline when none is recorded (never a
// guessed fill, never a dashed box), then its name with maker and code, LRV, Provenance, and a
// Palette color's role.
// A Palette shows as PaletteChips, large chips sized by role, and an LRV as an LrvBar.

import type { Color, PaletteRole } from "@settle/core";
import { formatColor } from "./format";
import chips from "./Swatch.module.css";
import { ESTIMATE_NOTE, ProvenanceTag } from "./Values";

/**
 * The square alone, 18px. Decorative: the name beside it says the color; its title gives the hex.
 * With no hex recorded it is an empty outline in stone.
 */
export function SwatchSquare({
  hex,
  title = "No screen color recorded",
}: {
  hex?: string | undefined;
  /** What an empty outline's tooltip says. */
  title?: string;
}) {
  if (!hex) {
    return <span className={`${chips.swatch} ${chips.unrecorded}`} title={title} aria-hidden />;
  }
  return (
    <span
      className={chips.swatch}
      style={{ backgroundColor: hex }}
      title={`Approximately ${hex}`}
      aria-hidden
    />
  );
}

/**
 * "■ ~Setting Plaster (Farrow & Ball 231), LRV 62 estimate, base": the square, the color, its
 * Provenance unless `provenance` is false (as in a row of swatches), and its role when it has one.
 * `compact` gives the list form: an Estimated color keeps only the "~" beside its name, and no
 * Provenance is named ("■ ~Oatmeal"); `named` writes out a Measured one too.
 */
export function Swatch({
  color,
  provenance = true,
  compact = false,
  named = false,
}: {
  color: Color & { role?: PaletteRole };
  provenance?: boolean;
  compact?: boolean;
  named?: boolean;
}) {
  const estimated = color.provenance === "estimated";
  return (
    <span className={chips.swatchText}>
      <SwatchSquare hex={color.hex} />
      <span title={compact && estimated ? ESTIMATE_NOTE : undefined}>{formatColor(color)}</span>
      {color.lrv !== undefined && `, LRV ${color.lrv}`}
      {provenance && !compact && (
        <>
          {" "}
          <ProvenanceTag provenance={color.provenance} named={named} />
        </>
      )}
      {color.role && `, ${color.role}`}
    </span>
  );
}

export type ChipSize = "wide" | "medium" | "narrow";

/** How wide a Palette color's chip is: base widest, accent narrow, anything else medium. */
export function chipSize(role: string | undefined): ChipSize {
  if (role === "base") return "wide";
  if (role === "accent") return "narrow";
  return "medium";
}

/**
 * A Palette as a row of large chips, sized by role, each filled from its hex (an empty stone
 * outline without one) over a label: the name, maker and code, then role, LRV, and Provenance.
 */
export function PaletteChips({ colors }: { colors: readonly (Color & { role?: PaletteRole })[] }) {
  return (
    <figure className={chips.palette}>
      <ul className={chips.chips}>
        {colors.map((color, index) => {
          const maker = [color.brand, color.code].filter(Boolean).join(" ");
          return (
            <li
              // Two colors may share a name, so the position keeps keys apart.
              key={`${index}-${color.name}`}
              className={`${chips.chip} ${chips[chipSize(color.role)]}`}
            >
              {color.hex ? (
                <span
                  className={chips.fill}
                  style={{ backgroundColor: color.hex }}
                  title={`Approximately ${color.hex}`}
                  aria-hidden
                />
              ) : (
                <span
                  className={`${chips.fill} ${chips.placeholder}`}
                  title="No screen color recorded"
                >
                  No screen color recorded
                </span>
              )}
              <span className={chips.label}>
                <span className={chips.name}>{color.name}</span>
                {maker && <span className={chips.maker}>{maker}</span>}
                <span className={chips.meta}>
                  {color.role && <span>{color.role}</span>}
                  {color.lrv !== undefined && <span>LRV {color.lrv}</span>}
                  <ProvenanceTag provenance={color.provenance} />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <figcaption className={chips.note}>
        Screen colors are approximate. Check a sample pot on the wall.
      </figcaption>
    </figure>
  );
}

/** An LRV in plain words: under 20 dark, to 50 mid, to 80 light, above that very bright. */
export function lrvWord(lrv: number): string {
  if (lrv < 20) return "dark, soaks up light";
  if (lrv <= 50) return "mid";
  if (lrv <= 80) return "light";
  return "very bright";
}

/** A thin black-to-white bar with a tick at the LRV, and the LRV in words: "LRV 62 · light". */
export function LrvBar({ lrv }: { lrv: number }) {
  const at = Math.min(100, Math.max(0, lrv));
  return (
    <span className={chips.lrv}>
      <span className={chips.lrvBar} role="img" aria-label={`LRV ${lrv} of 100: ${lrvWord(lrv)}`}>
        <span className={chips.lrvTick} style={{ left: `${at}%` }} />
      </span>
      <span className={chips.lrvText} aria-hidden>
        LRV {lrv} · {lrvWord(lrv)}
      </span>
    </span>
  );
}
