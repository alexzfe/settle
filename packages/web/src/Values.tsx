// Recorded values as the pages show them: lengths in metres with a Provenance tag, colors with a
// swatch, and lines of parts that leave out whatever is not recorded.

import type { Color as ColorValue, Light, Provenance } from "@idh/core";
import { Children, type ReactNode } from "react";
import styles from "./App.module.css";
import { formatColor, formatDate, formatLength, type Measure, PROVENANCE_LABEL } from "./format";

export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return <span className={styles.tag}>{PROVENANCE_LABEL[provenance]}</span>;
}

/** A length with its Provenance: "~3.60 m" tagged Estimated. */
export function Length({ value }: { value: Measure }) {
  return (
    <span>
      {formatLength(value)} <ProvenanceTag provenance={value.provenance} />
    </span>
  );
}

/**
 * Labelled lengths such as width × depth × height, leaving out the missing ones, and undefined
 * when none is recorded, so a line of Parts leaves it out too. When they share a Provenance it is
 * tagged once, at the end.
 */
export function dimensions(parts: [label: string, value: Measure | undefined][]): ReactNode {
  const present = parts.filter((part): part is [string, Measure] => part[1] !== undefined);
  const [first] = present;
  if (!first) return undefined;
  const shared = present.every(([, value]) => value.provenance === first[1].provenance);
  if (shared) {
    const text = present.map(([label, value]) => `${label} ${formatLength(value)}`).join(" × ");
    return (
      <span>
        {text} <ProvenanceTag provenance={first[1].provenance} />
      </span>
    );
  }
  return (
    <Parts separator=" × ">
      {present.map(([label, value]) => (
        <span key={label}>
          {label} <Length value={value} />
        </span>
      ))}
    </Parts>
  );
}

/** A color by name, with a swatch from its approximate hex, its LRV, and its Provenance. */
export function Color({ color }: { color: ColorValue }) {
  return (
    <span>
      {color.hex && (
        <span className={styles.swatch} style={{ backgroundColor: color.hex }} aria-hidden />
      )}
      {formatColor(color)}
      {color.lrv !== undefined && `, LRV ${color.lrv}`}{" "}
      <ProvenanceTag provenance={color.provenance} />
    </span>
  );
}

const DIMMING: Record<NonNullable<Light["dimming"]>, string> = {
  none: "not dimmable",
  standard: "dimmable",
  "dim-to-warm": "dim to warm",
  tunable: "tunable",
};

/**
 * Light attributes in one phrase, "ambient, 2700 K, 800 lm, dim to warm, CRI 90", or undefined
 * when none is recorded.
 */
export function lightText(light: Light): string | undefined {
  const { role, colorTemperature: temperature, brightness, dimming, cri } = light;
  const parts = [
    role,
    typeof temperature === "number" ? `${temperature} K` : temperature,
    brightness !== undefined && `${brightness} lm`,
    dimming && DIMMING[dimming],
    cri !== undefined && `CRI ${cri}`,
  ].filter(Boolean);
  return parts.length === 0 ? undefined : parts.join(", ");
}

/** When and why a record was Archived. */
export function ArchivedNote({ at, reason }: { at: string; reason?: string }) {
  return (
    <span className={styles.muted}>
      Archived {formatDate(at)}
      {reason ? `: ${reason}` : ""}
    </span>
  );
}

/** One term and its value in a facts list, left out when nothing is recorded for it. */
export function Fact({ term, children }: { term: string; children: ReactNode }) {
  if (children === undefined || children === null || children === "" || children === false) {
    return null;
  }
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * Its children joined by `separator`, leaving out the empty ones (false, null, undefined, ""). A
 * child that is a component always counts, so pass optional parts as values, not components.
 */
export function Parts({ children, separator = ", " }: { children: ReactNode; separator?: string }) {
  const parts = Children.toArray(children).filter((part) => part !== "");
  return <>{parts.flatMap((part, index) => (index === 0 ? [part] : [separator, part]))}</>;
}
