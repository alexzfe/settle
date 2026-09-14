// A color as the pages show it, wherever a Palette, Surface, or Item color appears: a small square
// filled from its approximate hex, or an outlined placeholder when none is recorded (never a
// guessed fill), then its name with maker and code, LRV, Provenance, and a Palette color's role.

import type { Color, PaletteRole } from "@idh/core";
import styles from "./App.module.css";
import { formatColor } from "./format";
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
    <span>
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
