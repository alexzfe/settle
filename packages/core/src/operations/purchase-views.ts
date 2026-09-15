import { optional } from "../optional.js";
import { fieldLabel, isMeasurement, length } from "../render.js";
import {
  type DecisionRow,
  type GuideRow,
  type ListingRow,
  MEASUREMENT_KEYS,
  type RequirementRow,
} from "../store.js";
import type { DecisionModel } from "./decisions.js";
import { reasonRecord, recordName } from "./reasons.js";
import type {
  CheckResult,
  Deviation,
  Guides,
  Listing,
  ListingCheck,
  QuickGuide,
  QuickGuideLine,
} from "./schemas.js";

// A Purchase's Quick Guide, Guides, Listings, and Deviations, as results carry them. The Quick
// Guide is assembled here from the Requirements and the AI's own lines, never stored whole, so it
// can't go stale when a Requirement changes (docs/specs/skill-set.md#purchase).

/** A Decision's Requirements not Archived, by position. */
export function activeRequirements(model: DecisionModel, decision: DecisionRow): RequirementRow[] {
  return model.requirements
    .filter((each) => each.decisionId === decision.id && each.archivedAt === null)
    .sort((a, b) => a.position - b.position);
}

export function guideOf(model: DecisionModel, decision: DecisionRow): GuideRow | undefined {
  return model.guides.find((each) => each.decisionId === decision.id);
}

/**
 * The "Measure first" lines: one for every value a must Requirement rests on that is Estimated,
 * or not recorded at all when the reason names a length field. A reason naming a field rests on
 * that field only; one naming none rests on every length of its record. Each value once, in the
 * Requirements' order.
 */
export function measureFirst(model: DecisionModel, decision: DecisionRow): string[] {
  const lines: string[] = [];
  for (const requirement of activeRequirements(model, decision)) {
    if (requirement.strength !== "must") continue;
    const record = reasonRecord(model, requirement.reasonKind, requirement.reasonId);
    if (!record) continue;
    const row = record.row as Record<string, unknown>;
    const fields =
      requirement.reasonField !== null
        ? [requirement.reasonField]
        : Object.keys(row).filter((key) => MEASUREMENT_KEYS.has(key));
    const what = requirement.reasonKind === "home" ? "" : `${recordName(record)} `;
    for (const field of fields) {
      const value = row[field];
      const line = isMeasurement(value)
        ? value.provenance === "estimated"
          ? `Measure first: ${what}${fieldLabel(field)} (${length(value)})`
          : undefined
        : value == null && requirement.reasonField !== null && MEASUREMENT_KEYS.has(field)
          ? `Measure first: ${what}${fieldLabel(field)} (not recorded)`
          : undefined;
      if (line && !lines.includes(line)) lines.push(line);
    }
  }
  return lines;
}

/** The phone page on this computer: "/guide/wool-rug?home=fixture-home". */
export function guidePath(model: DecisionModel, decision: DecisionRow): string {
  return `/guide/${encodeURIComponent(decision.slug)}?home=${encodeURIComponent(model.home.slug)}`;
}

/**
 * The Quick Guide: "Measure first" lines at the top, then the musts, then the prefers, each by
 * position, then the AI's own lines.
 */
export function toQuickGuide(model: DecisionModel, decision: DecisionRow): QuickGuide {
  const requirements = activeRequirements(model, decision);
  const byStrength = (strength: "must" | "prefer"): QuickGuideLine[] =>
    requirements
      .filter((each) => each.strength === strength)
      .map((each) => ({ kind: strength, text: each.text, requirement: each.position }));
  return {
    lines: [
      ...measureFirst(model, decision).map((text) => ({ kind: "measure-first" as const, text })),
      ...byStrength("must"),
      ...byStrength("prefer"),
      ...(guideOf(model, decision)?.quickLines ?? []).map((text) => ({
        kind: "line" as const,
        text,
      })),
    ],
    path: guidePath(model, decision),
  };
}

/** Whether a Purchase's Full Guide is out of date: a Requirement changed after it was written. */
export function outOfDate(guide: GuideRow | undefined): boolean {
  return guide?.writtenAt != null && guide.requirementsChangedAt !== null;
}

/** A Purchase's saved Guides, the Full Guide's Markdown only with `includeFullGuide`. */
export function toGuides(
  guide: GuideRow | undefined,
  { includeFullGuide = false, lanUrl }: { includeFullGuide?: boolean; lanUrl?: string } = {},
): Guides | undefined {
  if (!guide) return undefined;
  const written = guide.fullMarkdown !== null && guide.writtenAt !== null;
  return {
    quickLines: guide.quickLines,
    ...optional({
      fullGuide: written
        ? {
            writtenAt: guide.writtenAt as string,
            ...optional({ requirementsChangedAt: guide.requirementsChangedAt }),
            outOfDate: outOfDate(guide),
            ...optional({ markdown: includeFullGuide ? guide.fullMarkdown : undefined }),
          }
        : undefined,
      lanUrl: lanUrl && `${lanUrl}/guide/${guide.lanToken}`,
    }),
  };
}

/** A Purchase's Listings, in the order they were recorded, each checked against its Requirements. */
export function toListings(model: DecisionModel, decision: DecisionRow): Listing[] {
  const requirements = activeRequirements(model, decision);
  return model.listings
    .filter((each) => each.decisionId === decision.id)
    .map((listing) => toListing(model, listing, requirements));
}

function toListing(
  model: DecisionModel,
  listing: ListingRow,
  requirements: RequirementRow[],
): Listing {
  const checks: ListingCheck[] = requirements.map((requirement) => {
    const check = model.listingChecks.find(
      (each) => each.listingId === listing.id && each.requirementId === requirement.id,
    );
    return {
      requirement: requirement.position,
      text: requirement.text,
      strength: requirement.strength,
      result: check?.result ?? "unknown",
      ...optional({ note: check?.note, unchecked: check ? undefined : true }),
    };
  });
  const count = (result: CheckResult) => checks.filter((each) => each.result === result).length;
  return {
    slug: listing.slug,
    name: listing.name,
    ...optional({
      url: listing.url,
      price: listing.price,
      dimensions: listing.dimensions,
      photo: listing.photoPath,
    }),
    recordedAt: listing.recordedAt,
    checks,
    counts: { pass: count("pass"), fail: count("fail"), unknown: count("unknown") },
    failedMusts: checks
      .filter((each) => each.strength === "must" && each.result === "fail")
      .map((each) => each.requirement),
  };
}

/** The Deviations recorded when a Purchase was Fulfilled. */
export function toDeviations(model: DecisionModel, decision: DecisionRow): Deviation[] {
  return model.deviations
    .filter((each) => each.decisionId === decision.id)
    .map((deviation) => {
      const requirement = model.requirements.find((each) => each.id === deviation.requirementId);
      return {
        slug: deviation.slug,
        requirement: requirement?.position ?? 0,
        requirementText: requirement?.text ?? "?",
        strength: requirement?.strength ?? "must",
        text: deviation.text,
        recordedAt: deviation.recordedAt,
      };
    });
}
