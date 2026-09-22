// Recorded values as the pages show them, and lines of parts that leave out whatever is not
// recorded. Colors are shown by Swatch.tsx.
//
// A value has two forms (handoff ui-overhaul.md Q9). The full form, for a page that examines one
// record, names its Provenance: "~0.95 m estimate", "2.40 m Blueprint", "1.53 m Listed". The list
// form, for lists and tables (pass `compact`), marks only an Estimated value, with a "~" in front
// ("~95 cm"), and shows Measured, Blueprint and Listed plain. Where every Provenance should be
// written out, Measured too, pass `named` (the Item page).

import type { BlueprintSource, Light, Provenance } from "@settle/core";
import { Children, Fragment, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import {
  formatDate,
  formatDimensions,
  formatLength,
  type LengthUnit,
  type Measure,
  provenanceText,
} from "./format";
import values from "./Values.module.css";

/** What the "estimate" tag's tooltip says. */
export const ESTIMATE_NOTE =
  "Estimated by eye: from a Photo, scaled off a drawing, or guessed. Measure it to be sure.";

/** What the "Measured" tag's tooltip says. */
export const MEASURED_NOTE = "Measured: taken with a tape, so it can be relied on.";

/** What the "Listed" tag's tooltip says. */
export const LISTED_NOTE =
  "From the Listing: the maker's or shop's figure, not checked here. Measure it to be sure.";

/**
 * A value's Provenance, kept quiet: a Measured value reads plain (nothing is shown, unless `named`
 * asks for a "Measured" chip), an Estimated one gets a small "estimate" tag with a tooltip, a
 * Listed one a "Listed" chip saying it came from the Listing, and a value printed on a Blueprint a
 * chip that links to the page it is printed on, with the text as printed: "Blueprint p.2: 12'6"".
 */
export function ProvenanceTag({
  provenance,
  source,
  named = false,
}: {
  provenance: Provenance;
  source?: BlueprintSource | undefined;
  named?: boolean;
}) {
  const { home = "" } = useParams();
  if (provenance === "measured") {
    return named ? (
      <span className={`${values.tag} ${values.measured}`} title={MEASURED_NOTE}>
        Measured
      </span>
    ) : null;
  }
  if (provenance === "estimated") {
    return (
      <span className={`${values.tag} ${values.estimate}`} title={ESTIMATE_NOTE}>
        estimate
      </span>
    );
  }
  if (provenance === "listed") return <ListedTag />;
  if (source) {
    return (
      <Link
        className={`${values.tag} ${values.blueprint}`}
        to={`/homes/${home}/blueprints/${source.blueprint}/${source.page}`}
        title="Open the Blueprint page it is printed on"
      >
        {provenanceText(provenance, source)}
      </Link>
    );
  }
  return <span className={`${values.tag} ${values.blueprint}`}>{provenanceText(provenance)}</span>;
}

/** The "Listed" chip, for a Listed value or a register field copied from the Listing. */
export function ListedTag() {
  return (
    <span className={`${values.tag} ${values.listed}`} title={LISTED_NOTE}>
      Listed
    </span>
  );
}

/** The list form's tooltip: the estimate note when any of `values` is Estimated. */
function estimateTitle(values: readonly (Measure | undefined)[]): string | undefined {
  return values.some((value) => value?.provenance === "estimated") ? ESTIMATE_NOTE : undefined;
}

/**
 * A length with its Provenance: "~3.60 m estimate", or "3.60 m" when Measured. `compact` gives the
 * list form: "~3.60 m", and "3.60 m" whatever else its Provenance.
 */
export function Length({
  value,
  unit,
  compact = false,
  named = false,
}: {
  value: Measure;
  unit?: LengthUnit;
  compact?: boolean;
  named?: boolean;
}) {
  if (compact) {
    return (
      <span className={values.length} title={estimateTitle([value])}>
        {formatLength(value, unit)}
      </span>
    );
  }
  return (
    <span className={values.length}>
      {formatLength(value, unit)}
      {(named || value.provenance !== "measured") && (
        <>
          {" "}
          <ProvenanceTag provenance={value.provenance} source={value.source} named={named} />
        </>
      )}
    </span>
  );
}

/**
 * Labelled lengths such as width × depth × height, leaving out the missing ones, and undefined
 * when none is recorded, so a line of Parts leaves it out too. When they share a Provenance it is
 * tagged once, at the end, unless they come from a Blueprint: each tag then shows where it is
 * printed. `compact` gives the list form, `formatDimensions`: "210 × ~95 × 80 cm"; `named` tags
 * Measured values too.
 */
export function dimensions(
  parts: [label: string, value: Measure | undefined][],
  unit?: LengthUnit,
  { compact = false, named = false }: { compact?: boolean; named?: boolean } = {},
): ReactNode {
  if (compact) {
    const text = formatDimensions(parts, unit);
    if (text === undefined) return undefined;
    return (
      <span className={values.length} title={estimateTitle(parts.map(([, value]) => value))}>
        {text}
      </span>
    );
  }
  const present = parts.filter((part): part is [string, Measure] => part[1] !== undefined);
  const [first] = present;
  if (!first) return undefined;
  const shared = present.every(
    ([, value]) => value.provenance === first[1].provenance && value.source === undefined,
  );
  if (shared) {
    // Each side keeps its number and unit on one line; at phone width the line breaks between
    // sides, and the tag drops under them, instead of running out of the card.
    const sides = present.map(([label, value]) => `${label} ${formatLength(value, unit)}`);
    return (
      <span className={values.lengths}>
        {sides.map((side, index) => (
          <Fragment key={side}>
            {index > 0 && " × "}
            <span className={values.length}>{side}</span>
          </Fragment>
        ))}
        {(named || first[1].provenance !== "measured") && (
          <>
            {" "}
            <ProvenanceTag provenance={first[1].provenance} named={named} />
          </>
        )}
      </span>
    );
  }
  return (
    <Parts separator=" × ">
      {present.map(([label, value]) => (
        <span key={label}>
          {label} <Length value={value} unit={unit} named={named} />
        </span>
      ))}
    </Parts>
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
