// A color as the pages show it, wherever a Palette, Surface, or Item color appears: a small square
// filled from its approximate hex, or an outlined placeholder when none is recorded (never a
// guessed fill), then its name with maker and code, LRV, Provenance, and a Palette color's role.
// A Palette shows as PaletteChips, large chips sized by role, and an LRV as an LrvBar.

import type { Color, PaletteRole } from "@idh/core";
import styles from "./App.module.css";
import { formatColor } from "./format";
import chips from "./Swatch.module.css";
import { ProvenanceTag } from "./Values";

/** The square alone. Decorative: the name beside it says the color; its title gives the hex. */
export function SwatchSquare({ hex }: { hex?: string | undefined }) {
  if (!hex) {
    return (
      <span
        className={`${styles.swatch} ${styles.swatchPlaceholder}`}
        title="No screen color recorded"
        aria-hidden
      />
    );
  }
  return (
    <span
      className={styles.swatch}
      style={{ backgroundColor: hex }}
      title={`Approximately ${hex}`}
      aria-hidden
    />
  );
}

/**
 * "■ ~Setting Plaster (Farrow & Ball 231), LRV 62 Estimated, base": the square, the color, its
 * Provenance unless `provenance` is false (as in a row of swatches), and its role when it has one.
 */
export function Swatch({
  color,
  provenance = true,
}: {
  color: Color & { role?: PaletteRole };
  provenance?: boolean;
}) {
  return (
    <span className={styles.swatchText}>
      <SwatchSquare hex={color.hex} />
      {formatColor(color)}
      {color.lrv !== undefined && `, LRV ${color.lrv}`}
      {provenance && (
        <>
          {" "}
          <ProvenanceTag provenance={color.provenance} />
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
 * A Palette as a row of large chips, sized by role, each filled from its hex (a dashed placeholder
 * without one) over a label: the name, maker and code, then role, LRV, and Provenance.
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
